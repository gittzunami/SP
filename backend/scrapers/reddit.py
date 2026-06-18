"""
reddit.py
=========
Reddit scraper — uses Reddit's free public .json endpoints.
No API key or Apify required.

Keyword matching: ALL words in the keyword phrase must appear in the
post title or body (case-insensitive). Off-topic posts are skipped.

Proxy: Uses scrape.do to rotate datacenter proxies and bypass IP bans.
Configure in .env:
    SCRAPEDO_KEY=your_token_here
"""

from __future__ import annotations

import logging
import os
import re
import time
import urllib.parse
from datetime import datetime, timezone
from typing import List

import requests

from models import RedditConfig

logger   = logging.getLogger("scraper.reddit")
BASE_URL = "https://www.reddit.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TrendSense-Scraper/2.0; research use)",
}

# ── scrape.do Setup ───────────────────────────────────────────────────────────
# Set in .env:
#   SCRAPEDO_KEY=your_token_here
#
# Cost: 1 credit per request (datacenter, no JS rendering needed for .json endpoints)
# Docs: https://scrape.do/documentation/

_SCRAPEDO_KEY = os.getenv("SCRAPEDO_KEY", "").strip()
_SCRAPE_DO_API   = "https://api.scrape.do/"

if _SCRAPEDO_KEY:
    logger.info("Reddit: scrape.do proxy enabled")
else:
    logger.warning(
        "Reddit: SCRAPEDO_KEY not set — running without proxy (risk of IP ban). "
        "Add SCRAPEDO_KEY=your_token to your .env file."
    )


# ── Stop Words ────────────────────────────────────────────────────────────────

STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of",
    "with","by","from","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","it","its","this","that","these","those",
    "as","up","out","about",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_request_url(target_url: str, params: dict = None) -> str:
    """
    Build the final request URL.

    If scrape.do token is available, wraps the target URL through
    scrape.do's API endpoint. Otherwise falls back to direct request.

    scrape.do usage:
        GET https://api.scrape.do/?token=TOKEN&url=ENCODED_TARGET_URL

    No render=true needed — Reddit .json endpoints are plain HTTP JSON,
    no JavaScript execution required. This keeps cost at 1 credit/request.
    """
    # First, build the full target URL with query params
    if params:
        prepared = requests.Request("GET", target_url, params=params).prepare()
        full_target = prepared.url
    else:
        full_target = target_url

    if not _SCRAPEDO_KEY:
        # Fallback: direct request (may get IP-banned by Reddit)
        return full_target

    encoded_target = urllib.parse.quote(full_target, safe="")
    return f"{_SCRAPE_DO_API}?token={_SCRAPEDO_KEY}&url={encoded_target}"


def _get_json(url: str, params: dict = None) -> dict:
    """
    Fetch a Reddit .json endpoint via scrape.do proxy.

    scrape.do handles proxy rotation internally — no manual rotation needed.
    Retries up to 3 times on transient failures (429, 5xx, timeouts).
    """
    max_attempts = 3

    for attempt in range(max_attempts):
        request_url = _build_request_url(url, params if attempt == 0 else None)

        # On retries after the first, params are already baked into the URL
        # by _build_request_url on attempt 0, so pass params=None to requests
        # to avoid double-encoding. We rebuild the URL fresh each attempt.
        if attempt > 0:
            request_url = _build_request_url(url, params)

        try:
            time.sleep(1.0)
            r = requests.get(
                request_url,
                headers=HEADERS,
                timeout=60,   # scrape.do may take longer than a direct request
            )

            if r.status_code == 429:
                wait = 10 * (attempt + 1)
                logger.warning(
                    "Reddit: rate-limited (429) on attempt %d/%d — sleeping %ds",
                    attempt + 1, max_attempts, wait,
                )
                time.sleep(wait)
                continue

            if r.status_code == 403:
                logger.warning(
                    "Reddit: 403 blocked on attempt %d/%d — retrying via scrape.do",
                    attempt + 1, max_attempts,
                )
                time.sleep(2)
                continue

            r.raise_for_status()
            return r.json()

        except requests.exceptions.Timeout:
            logger.warning(
                "Reddit: timeout on attempt %d/%d for %s",
                attempt + 1, max_attempts, url,
            )
            time.sleep(3)

        except requests.exceptions.JSONDecodeError as e:
            logger.warning("Reddit: JSON decode error on attempt %d/%d — %s", attempt + 1, max_attempts, e)
            return {}

        except requests.exceptions.RequestException as e:
            logger.warning(
                "Reddit: request error on attempt %d/%d — %s",
                attempt + 1, max_attempts, e,
            )
            time.sleep(3)

    logger.warning("Reddit: all %d attempts failed for %s", max_attempts, url)
    return {}


def _matches_keyword(keyword: str, title: str, body: str) -> bool:
    """All meaningful words must appear in title or body (case-insensitive)."""
    words_all = keyword.lower().split()
    words     = [w for w in words_all if w not in STOP_WORDS] or words_all
    title_    = title.lower()
    body_     = body.lower()
    if all(w in title_ for w in words):
        return True
    return all(w in body_ for w in words)


# ── Search posts ──────────────────────────────────────────────────────────────

def _search_posts(cfg: RedditConfig) -> List[dict]:
    posts = []
    after = None

    base_url = (
        f"{BASE_URL}/r/{'+'.join(cfg.subreddits)}/search.json"
        if cfg.subreddits else
        f"{BASE_URL}/search.json"
    )

    fetch_target = min(cfg.max_posts * 3, 300)

    while len(posts) < cfg.max_posts:
        params = {
            "q":           cfg.keyword,
            "sort":        cfg.sort,
            "t":           cfg.time_filter,
            "limit":       min(25, fetch_target - len(posts)),
            "restrict_sr": "true" if cfg.subreddits else "false",
        }
        if after:
            params["after"] = after

        data     = _get_json(base_url, params)
        children = data.get("data", {}).get("children", [])
        after    = data.get("data", {}).get("after")

        if not children:
            break

        for child in children:
            p   = child.get("data", {})
            pid = p.get("id", "")
            if not pid:
                continue

            title = p.get("title",    "").strip()
            body  = p.get("selftext", "").strip()

            if not _matches_keyword(cfg.keyword, title, body):
                logger.debug("Reddit: skipping off-topic — %s", title[:60])
                continue

            posts.append({
                "id":           pid,
                "url":          f"https://www.reddit.com{p.get('permalink', '')}",
                "title":        title,
                "body":         body,
                "created_at":   datetime.fromtimestamp(
                                    int(p.get("created_utc", 0)), tz=timezone.utc
                                ).isoformat(),
                "subreddit":    p.get("subreddit",       ""),
                "author":       p.get("author",          ""),
                "score":        p.get("score",            0),
                "upvote_ratio": p.get("upvote_ratio",    0.0),
                "num_comments": p.get("num_comments",     0),
                "flair":        p.get("link_flair_text", ""),
                "is_nsfw":      p.get("over_18",         False),
                "url_content":  p.get("url",             ""),
                "comments":     [],
            })
            if len(posts) >= cfg.max_posts:
                break

        if not after:
            break

    return posts


# ── Fetch comments ────────────────────────────────────────────────────────────

def _fetch_comments(permalink: str, max_comments: int) -> List[dict]:
    url  = f"{BASE_URL}{permalink}.json"
    data = _get_json(url, {"limit": max_comments, "depth": 5})
    if not data or not isinstance(data, list) or len(data) < 2:
        return []
    return _parse_tree(data[1].get("data", {}).get("children", []), max_comments)


def _parse_tree(children: list, max_comments: int, depth: int = 0) -> List[dict]:
    result = []
    for child in children:
        if len(result) >= max_comments:
            break
        if child.get("kind") != "t1":
            continue
        c = child.get("data", {})
        comment = {
            "id":         c.get("id",     ""),
            "body":       c.get("body",   "").strip(),
            "author":     c.get("author", ""),
            "score":      c.get("score",   0),
            "created_at": datetime.fromtimestamp(
                              int(c.get("created_utc", 0)), tz=timezone.utc
                          ).isoformat(),
            "depth":      depth,
            "replies":    [],
        }
        replies_raw = c.get("replies", {})
        if isinstance(replies_raw, dict):
            sub = replies_raw.get("data", {}).get("children", [])
            if sub:
                comment["replies"] = _parse_tree(sub, max_comments, depth + 1)
        result.append(comment)
    return result


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: RedditConfig) -> dict:
    scope = f"r/{'+'.join(cfg.subreddits)}" if cfg.subreddits else "all of Reddit"
    logger.info(
        "Reddit [Public JSON via scrape.do]: searching %s for %r | proxy=%s",
        scope, cfg.keyword, "on" if _SCRAPEDO_KEY else "off (no token)",
    )

    posts = _search_posts(cfg)
    logger.info("Reddit: %d matching posts found", len(posts))

    if cfg.max_comments > 0:
        for i, post in enumerate(posts):
            logger.info(
                "Reddit: [%02d/%02d] fetching comments — %s",
                i + 1, len(posts), post["title"][:55],
            )
            if post["num_comments"] > 0:
                permalink        = re.sub(r"https://www\.reddit\.com", "", post["url"])
                post["comments"] = _fetch_comments(permalink, cfg.max_comments)

    return {
        "keyword":        cfg.keyword,
        "subreddits":     cfg.subreddits or ["all"],
        "sort":           cfg.sort,
        "time_filter":    cfg.time_filter,
        "scraped_at":     datetime.now(tz=timezone.utc).isoformat(),
        "total_posts":    len(posts),
        "total_comments": sum(len(p["comments"]) for p in posts),
        "total_replies":  sum(len(c["replies"]) for p in posts for c in p["comments"]),
        "posts":          posts,
    }
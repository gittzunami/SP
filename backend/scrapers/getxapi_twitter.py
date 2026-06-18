"""
scrapers/getxapi_twitter.py
===========================
Twitter / X scraper powered by GetXAPI.com

Cost model (getxapi.com/pricing, verified May 2026):
  $0.001  per API call
  ~20     tweets per call (approx, actual 10–20)
  $0.05   per 1,000 tweets (base rate)
  +3%     safety margin applied

API key: set GETXAPI_KEY in .env — free at https://www.getxapi.com
"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import List

import requests

logger = logging.getLogger("scraper.twitter")

COST_PER_CALL  = 0.001   # USD per API call (exact, published rate)
COST_MARGIN    = 0.03    # 3% safety buffer

STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to",
    "for", "of", "with", "by", "from", "is", "are", "was", "were",
    "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "it", "its",
    "this", "that", "these", "those", "as", "up", "out", "about",
}


def _get_key() -> str:
    key = os.environ.get("GETXAPI_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "GETXAPI_KEY not set. Get a free key at https://www.getxapi.com "
            "and add GETXAPI_KEY=your_key to your .env file."
        )
    return key


def _build_query(keyword: str, lang: str) -> tuple[str, list[str]]:
    raw_words  = re.findall(r"[a-zA-Z0-9']+", keyword.lower())
    meaningful = [w for w in raw_words if w not in STOP_WORDS] or raw_words
    lang_op    = f" lang:{lang}" if lang else ""
    query      = " ".join(meaningful) + lang_op + " -is:retweet"
    return query, meaningful


def _all_words_present(keyword: str, text: str) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    return fuzzy_match(keyword, text)


def _normalise(tweet: dict) -> dict:
    author = tweet.get("author") or {}
    media  = tweet.get("media") or []
    media_url = next(
        (m.get("url") or m.get("fullUrl", "") for m in media if m.get("url") or m.get("fullUrl")),
        None,
    )
    return {
        "tweet_id":   str(tweet.get("id", "")),
        "text":       tweet.get("text", ""),
        "lang":       tweet.get("lang", ""),
        "created_at": tweet.get("createdAt", ""),
        "url":        tweet.get("url", ""),
        "likes":      int(tweet.get("likeCount",     0) or 0),
        "retweets":   int(tweet.get("retweetCount",  0) or 0),
        "replies":    int(tweet.get("replyCount",    0) or 0),
        "quotes":     int(tweet.get("quoteCount",    0) or 0),
        "views":      int(tweet.get("viewCount",     0) or 0),
        "bookmarks":  int(tweet.get("bookmarkCount", 0) or 0),
        "author": {
            "username":      author.get("userName",       ""),
            "name":          author.get("name",           ""),
            "bio":           author.get("description",    ""),
            "followers":     int(author.get("followers",  0) or 0),
            "following":     int(author.get("following",  0) or 0),
            "verified":      bool(author.get("isBlueVerified", False)),
            "location":      author.get("location",       ""),
            "profile_image": author.get("profilePicture", ""),
        },
        "is_retweet": bool(tweet.get("isRetweet", False)),
        "hashtags":   [h.get("text", "") for h in (tweet.get("entities", {}).get("hashtags") or [])],
        "media_url":  media_url,
    }


def _fetch_page(api_key: str, query: str, cursor: str = "") -> dict:
    params = {"q": query, "product": "Latest"}
    if cursor:
        params["cursor"] = cursor

    try:
        resp = requests.get(
            "https://api.getxapi.com/twitter/tweet/advanced_search",
            headers={"Authorization": f"Bearer {api_key}"},
            params=params,
            timeout=30,
        )
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||GetXAPI unreachable — api.getxapi.com: {exc}"
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||GetXAPI timed out — api.getxapi.com: {exc}"
        ) from exc

    if resp.status_code == 401:
        raise RuntimeError("GetXAPI: Invalid API key — check GETXAPI_KEY in .env")
    if resp.status_code == 402:
        raise RuntimeError("GetXAPI: Out of credits — top up at getxapi.com/dashboard")
    if resp.status_code == 429:
        logger.warning("GetXAPI rate limited — waiting 20s")
        time.sleep(20)
        return _fetch_page(api_key, query, cursor)
    if resp.status_code >= 500:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||GetXAPI server error {resp.status_code}"
        )

    resp.raise_for_status()
    return resp.json()


def _scrape_keyword(api_key: str, keyword: str, max_tweets: int, lang: str) -> tuple[list, int]:
    """Scrape one keyword. Returns (tweets, calls_made)."""
    query, all_words = _build_query(keyword, lang)
    logger.info("GetXAPI query: %s | fuzzy keyword: %s", query, keyword)

    collected:  list = []
    cursor:     str  = ""
    calls_made: int  = 0

    while len(collected) < max_tweets:
        data        = _fetch_page(api_key, query, cursor)
        calls_made += 1
        raw_tweets  = data.get("tweets") or []

        if not raw_tweets:
            logger.info("  No tweets returned on page %d", calls_made)
            break

        for raw in raw_tweets:
            if _all_words_present(keyword, raw.get("text", "")):
                collected.append(_normalise(raw))
                if len(collected) >= max_tweets:
                    break

        logger.info("  %d matched so far (%d API calls)", len(collected), calls_made)

        if len(collected) >= max_tweets:
            break

        has_more = data.get("has_more", False)
        cursor   = data.get("next_cursor", "")
        if not has_more or not cursor:
            logger.info("  No more pages.")
            break

        time.sleep(0.5)

    return collected, calls_made


def run_twitter(keywords: List[str], max_tweets: int = 20,
                lang: str = "en", task_id: str = "") -> dict:
    """
    Entry point called by _run_scraper in main.py.

    Returns payload compatible with the rest of the pipeline:
      { keywords, scraped_at, total_tweets, tweets, _getxapi_run_stats }
    """
    start   = time.time()
    api_key = _get_key()

    if not keywords:
        raise ValueError("At least one keyword is required")

    # Distribute max_tweets evenly across keywords
    per_kw = max(1, max_tweets // len(keywords))

    all_tweets:  list = []
    total_calls: int  = 0
    seen_ids:    set  = set()

    for kw in keywords:
        tweets, calls = _scrape_keyword(api_key, kw.strip(), per_kw, lang)
        total_calls  += calls
        for t in tweets:
            if t["tweet_id"] and t["tweet_id"] not in seen_ids:
                seen_ids.add(t["tweet_id"])
                all_tweets.append(t)

    logger.info(
        "Twitter [%s]: %d tweets via %d API calls (cost ~$%.5f)",
        task_id[:8] if task_id else "—",
        len(all_tweets),
        total_calls,
        total_calls * COST_PER_CALL * (1 + COST_MARGIN),
    )

    return {
        "keywords":          keywords,
        "scraped_at":        datetime.now(tz=timezone.utc).isoformat(),
        "total_tweets":      len(all_tweets),
        "response_time_sec": round(time.time() - start, 2),
        "tweets":            all_tweets,
        "_getxapi_run_stats": {
            "calls_made":       total_calls,
            "tweets_collected": len(all_tweets),
            "cost_per_call":    COST_PER_CALL,
            "margin_pct":       COST_MARGIN * 100,
        },
    }

"""
edugeek.py
==========
EduGeek scraper — powered by ScrapingBee (premium UK proxies + JS rendering).
API key loaded from SCRAPINGBEE_KEY in .env.
Credit cost: 25 per page fetch (premium_proxy + render_js).

Keyword matching: ALL words in the keyword phrase must appear in the
post title or body (case-insensitive). Off-topic posts are skipped.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import List, Optional, Set
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup
from scrapingbee import ScrapingBeeClient

from models import EduGeekConfig

logger   = logging.getLogger("scraper.edugeek")
BASE_URL = "https://www.edugeek.net"


# ── Helpers ───────────────────────────────────────────────────────────────────

STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of",
    "with","by","from","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","it","its","this","that","these","those",
    "as","up","out","about",
}


def _text(el) -> str:
    return el.get_text(strip=True) if el else ""


def _matches_keyword(keyword: str, title: str, body: str) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    return fuzzy_match(keyword, title, body)


def _get_page(client: ScrapingBeeClient, url: str) -> Optional[BeautifulSoup]:
    try:
        time.sleep(1.0)
        resp = client.get(url, params={
            "render_js":       True,
            "premium_proxy":   True,
            "country_code":    "gb",
            "block_resources": True,
            "wait":            3000,
        })
        if resp.status_code == 200:
            return BeautifulSoup(resp.content, "html.parser")
        if resp.status_code == 401:
            raise RuntimeError(
                "ScrapingBee: Invalid API key or credits exhausted (401) — "
                "check your SCRAPINGBEE_KEY and account balance at scrapingbee.com/dashboard"
            )
        if resp.status_code in (402, 403):
            raise RuntimeError(
                f"ScrapingBee: Out of credits ({resp.status_code}) — "
                "top up your ScrapingBee account at scrapingbee.com/dashboard"
            )
        if resp.status_code == 429:
            raise RuntimeError(
                "ScrapingBee: Rate limited (429) — too many requests. Wait a few minutes and retry."
            )
        logger.warning("EduGeek: HTTP %d — %s", resp.status_code, url)
        return None
    except RuntimeError:
        raise
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||ScrapingBee unreachable: {exc}"
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||ScrapingBee timed out: {exc}"
        ) from exc
    except Exception as e:
        logger.error("EduGeek: page fetch error: %s", e)
        return None


# ── Generic search (paginates) ────────────────────────────────────────────────

def _search(
    client:       ScrapingBeeClient,
    keyword:      str,
    content_type: str,
    max_items:    int,
    seen_ids:     Set[str],
    node:         str = None,
) -> List[dict]:
    results = []
    page    = 1

    while len(results) < max_items:
        params = {
            "q":             keyword,
            "type":          content_type,
            "search_and_or": "or",
            "sortby":        "date",
            "page":          page,
        }
        if node:
            params["nodes"] = node
        url  = f"{BASE_URL}/search/?" + urlencode(params)
        soup = _get_page(client, url)
        if not soup:
            break

        items = soup.select(
            "li[data-role='activityItem'], .ipsStreamItem, li.ipsDataItem"
        )
        if not items:
            logger.info("EduGeek: no items on page %d for %s", page, content_type)
            break

        for item in items:
            a = item.select_one(
                "h2 a, h3 a, .ipsStreamItem_title a, a[data-linktype='link']"
            )
            if not a:
                continue
            href = a.get("href", "")
            if not href.startswith("http"):
                href = BASE_URL + href
            title = _text(a)
            id_m  = re.search(r"/(\d+)[-/]", href)
            rid   = id_m.group(1) if id_m else href
            if rid in seen_ids:
                continue
            t_el  = item.find("time")
            date  = t_el["datetime"] if t_el and t_el.get("datetime") else ""
            auth  = _text(item.select_one(
                "[data-role='authorName'] a, .ipsStreamItem_author a"
            ))
            results.append({
                "id": rid, "url": href, "title": title,
                "author": auth, "date": date,
            })
            seen_ids.add(rid)
            if len(results) >= max_items:
                break

        if not soup.select_one(
            "a[rel='next'], li.ipsPagination_next:not(.ipsPagination_inactive) a"
        ):
            break
        page += 1

    return results


# ── Content scraper (OP + replies) ────────────────────────────────────────────

def _scrape_posts(client, url: str, max_replies: int):
    soup = _get_page(client, url)
    if not soup:
        return {}, []
    posts = []
    for el in soup.select(
        "article[id^='elPostWrapper'], .cPost, .ipsComment"
    ):
        pid  = (
            el.get("id", "")
              .replace("elPostWrapper_", "")
              .replace("elComment_", "")
        )
        auth = _text(el.select_one(
            "[data-role='authorName'] a, .cAuthorPane_author a"
        ))
        t    = el.find("time")
        date = t["datetime"] if t and t.get("datetime") else ""
        body = _text(el.select_one(
            ".cPost_contentWrap, [data-role='commentContent'], "
            ".ipsComment_content, .ipsType_richText"
        ))
        rep  = _text(el.select_one(".ipsReputation_count"))
        posts.append({
            "id": pid, "author": auth, "date": date, "body": body, "rep": rep,
        })
        if len(posts) >= max_replies + 1:
            break
    if not posts:
        return {}, []
    return posts[0], posts[1: max_replies + 1]


# ── Per-category scrapers ─────────────────────────────────────────────────────

def _forums(client, cfg, seen_ids):
    logger.info("EduGeek [Forums]: '%s'", cfg.keyword)
    threads = _search(client, cfg.keyword, "forums_topic", cfg.max_items, seen_ids)
    results = []
    for i, t in enumerate(threads):
        op, replies = _scrape_posts(client, t["url"], cfg.max_replies)

        title = t["title"]
        body  = op.get("body", "") if op else ""

        if not _matches_keyword(cfg.keyword, title, body):
            logger.debug("EduGeek [Forums]: skipping off-topic — %s", title[:60])
            continue

        results.append({
            "type":       "forum_thread",
            "id":         t["id"],
            "url":        t["url"],
            "title":      title,
            "created_at": op.get("date", t["date"]) if op else t["date"],
            "author": {
                "username": op.get("author", t["author"]) if op else t["author"],
                "rep":      op.get("rep", "") if op else "",
            },
            "body":    body,
            "replies": [
                {
                    "id":     r["id"],
                    "author": r["author"],
                    "date":   r["date"],
                    "body":   r["body"],
                }
                for r in replies
            ],
            "stats": {"reply_count": len(replies)},
        })
        logger.info(
            "EduGeek [Forums]: [%02d/%02d] %s — %d replies",
            i + 1, len(threads), title[:50], len(replies),
        )
    return results


def _blogs(client, cfg, seen_ids):
    logger.info("EduGeek [Blogs]: '%s'", cfg.keyword)
    items   = _search(client, cfg.keyword, "core_blogs_entry", cfg.max_items, seen_ids)
    results = []
    for i, r in enumerate(items):
        op, comments = _scrape_posts(client, r["url"], cfg.max_replies)
        body = op.get("body", "") if op else ""
        if not _matches_keyword(cfg.keyword, r["title"], body):
            logger.debug("EduGeek [Blogs]: skipping off-topic — %s", r["title"][:60])
            continue
        results.append({
            "type":       "blog",
            "id":         r["id"],
            "url":        r["url"],
            "title":      r["title"],
            "author":     r["author"],
            "created_at": r["date"],
            "body":       body,
            "replies":    [
                {"author": c["author"], "date": c["date"], "body": c["body"]}
                for c in comments
            ],
        })
        logger.info("EduGeek [Blogs]: [%02d/%02d] %s", i + 1, len(items), r["title"][:50])
    return results


def _jobs(client, cfg, seen_ids):
    logger.info("EduGeek [Jobs]: '%s'", cfg.keyword)
    items = _search(
        client, cfg.keyword, "forums_topic", cfg.max_items, seen_ids, node="136"
    )
    if not items:
        items = _search(client, cfg.keyword, "forums_topic", cfg.max_items, seen_ids)
    results = []
    for i, r in enumerate(items):
        op, replies = _scrape_posts(client, r["url"], cfg.max_replies)
        body = op.get("body", "") if op else ""
        if not _matches_keyword(cfg.keyword, r["title"], body):
            logger.debug("EduGeek [Jobs]: skipping off-topic — %s", r["title"][:60])
            continue
        results.append({
            "type":       "job",
            "id":         r["id"],
            "url":        r["url"],
            "title":      r["title"],
            "author":     r["author"],
            "created_at": r["date"],
            "body":       body,
            "replies":    [
                {"author": c["author"], "date": c["date"], "body": c["body"]}
                for c in replies
            ],
        })
        logger.info("EduGeek [Jobs]: [%02d/%02d] %s", i + 1, len(items), r["title"][:50])
    return results


def _groups(client, cfg, seen_ids):
    logger.info("EduGeek [Groups]: '%s'", cfg.keyword)
    items   = _search(client, cfg.keyword, "core_clubs", cfg.max_items, seen_ids)
    results = []
    for i, r in enumerate(items):
        soup  = _get_page(client, r["url"])
        about = _text(soup.select_one(".cGroup_about, .ipsType_richText")) if soup else ""
        if not _matches_keyword(cfg.keyword, r["title"], about):
            logger.debug("EduGeek [Groups]: skipping off-topic — %s", r["title"][:60])
            continue
        posts = []
        if soup:
            for el in soup.select(".ipsStreamItem"):
                pa = _text(el.select_one("[data-role='authorName'] a"))
                pt = el.find("time")
                pd = pt["datetime"] if pt and pt.get("datetime") else ""
                pb = _text(el.select_one(".ipsStreamItem_snippet"))
                posts.append({"author": pa, "date": pd, "body": pb})
        results.append({
            "type":    "group",
            "id":      r["id"],
            "url":     r["url"],
            "title":   r["title"],
            "body":    about,
            "replies": posts,
        })
        logger.info("EduGeek [Groups]: [%02d/%02d] %s", i + 1, len(items), r["title"][:50])
    return results


def _articles(client, cfg, seen_ids):
    logger.info("EduGeek [Articles]: '%s'", cfg.keyword)
    items   = _search(client, cfg.keyword, "cms_records1", cfg.max_items, seen_ids)
    results = []
    for i, r in enumerate(items):
        op, comments = _scrape_posts(client, r["url"], cfg.max_replies)
        body = op.get("body", "") if op else ""
        if not _matches_keyword(cfg.keyword, r["title"], body):
            logger.debug("EduGeek [Articles]: skipping off-topic — %s", r["title"][:60])
            continue
        results.append({
            "type":       "article",
            "id":         r["id"],
            "url":        r["url"],
            "title":      r["title"],
            "author":     r["author"],
            "created_at": r["date"],
            "body":       body,
            "replies":    [
                {"author": c["author"], "date": c["date"], "body": c["body"]}
                for c in comments
            ],
        })
        logger.info(
            "EduGeek [Articles]: [%02d/%02d] %s", i + 1, len(items), r["title"][:50]
        )
    return results


_SCRAPERS = {
    "forums":   _forums,
    "blogs":    _blogs,
    "jobs":     _jobs,
    "groups":   _groups,
    "articles": _articles,
}


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: EduGeekConfig) -> dict:
    client    = ScrapingBeeClient(api_key=cfg.api_key)
    seen_ids: Set[str] = set()

    requested = (
        list(_SCRAPERS.keys())
        if "all" in cfg.categories
        else [c for c in cfg.categories if c != "all"]
    )

    categories_out: dict = {}
    for cat in requested:
        categories_out[cat] = _SCRAPERS[cat](client, cfg, seen_ids)

    total = sum(len(v) for v in categories_out.values())

    payload = {
        "keyword":         cfg.keyword,
        "scraped_at":      datetime.now(tz=timezone.utc).isoformat(),
        "total_items":     total,
        "category_counts": {k: len(v) for k, v in categories_out.items()},
        "categories":      categories_out,
    }

    logger.info("EduGeek: %d matching items ready for DB", total)
    return payload
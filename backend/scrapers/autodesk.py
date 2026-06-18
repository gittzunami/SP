"""
autodesk.py
===========
Autodesk Community scraper — Khoros LiQL API.
No API key needed — forums.autodesk.com is fully public.

Searches all content types:
  forum  → Forum Discussions
  qanda  → Q&A Boards
  tkb    → Knowledge Base Articles
  blog   → Blog Posts
  idea   → Ideas

Keyword matching: ALL words in the keyword phrase must appear in
the post subject or body (case-insensitive). Off-topic posts are skipped.

Enrichment via extra API calls (with in-run caching):
  - board_title     → GET /boards/{board_id}
  - author stats    → LiQL SELECT FROM users WHERE id = '{author_id}'
  - post kudos      → LiQL SELECT FROM messages WHERE id = '{post_id}'
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import requests

from models import AutodeskConfig

logger   = logging.getLogger("scraper.autodesk")
BASE_URL = "https://forums.autodesk.com/api/2.0"

HEADERS = {
    "Accept":          "application/json",
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

LANGUAGE_FILTER     = "AND language = 'English'"
ALL_CONTENT_TYPES   = ["forum", "qanda", "tkb", "blog", "idea"]
CONTENT_TYPE_LABELS = {
    "forum": "Forum Discussions",
    "qanda": "Q&A Boards",
    "tkb":   "Knowledge Base Articles",
    "blog":  "Blog Posts",
    "idea":  "Ideas",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of",
    "with","by","from","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","it","its","this","that","these","those",
    "as","up","out","about",
}


def _matches_keyword(keyword: str, subject: str, body: str) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    # Strip HTML before matching
    clean = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))
    return fuzzy_match(keyword, clean(subject), clean(body))


# ── Core LiQL runner ──────────────────────────────────────────────────────────

def _liql(query: str, label: str = "") -> List[dict]:
    try:
        time.sleep(0.4)
        resp = requests.get(
            f"{BASE_URL}/search",
            params={"q": query},
            headers=HEADERS,
            timeout=30,
        )
        if resp.status_code != 200:
            logger.warning("LiQL HTTP %d [%s]: %s", resp.status_code, label, resp.text[:200])
            return []
        data = resp.json()
        if data.get("status") == "error":
            msg = data.get("message", "")
            dev = data.get("data", {}).get("developer_message", "")
            logger.warning("LiQL error [%s]: %s — %s", label, msg, dev)
            return []
        return data.get("data", {}).get("items", [])
    except Exception as e:
        logger.error("LiQL request error [%s]: %s", label, e)
        return []


def _rest_get(path: str, label: str = "") -> dict:
    try:
        time.sleep(0.3)
        resp = requests.get(
            f"{BASE_URL}{path}",
            headers=HEADERS,
            timeout=30,
        )
        if resp.status_code != 200:
            logger.warning("REST HTTP %d [%s]", resp.status_code, label)
            return {}
        return resp.json().get("data", {})
    except Exception as e:
        logger.error("REST request error [%s]: %s", label, e)
        return {}


# ── Enrichment fetchers (with in-run caching) ─────────────────────────────────

def _fetch_board_title(board_id: str, cache: Dict[str, str]) -> str:
    if not board_id:
        return ""
    if board_id in cache:
        return cache[board_id]
    data          = _rest_get(f"/boards/{board_id}", f"board:{board_id}")
    title         = data.get("title", "") or ""
    cache[board_id] = title
    return title


def _fetch_author_data(author_id: str, cache: Dict[str, dict]) -> dict:
    if not author_id:
        return {}
    if author_id in cache:
        return cache[author_id]
    # Explicit field selection — SELECT * skips aggregated stats in Khoros LiQL
    items = _liql(
        f"SELECT id, login, rank, kudos_received_sum_weight, "
        f"messages_count, solutions_count, registration_time "
        f"FROM users WHERE id = '{author_id}'",
        f"author:{author_id}",
    )
    if not items:
        cache[author_id] = {}
        return {}
    u    = items[0]
    rank = u.get("rank", {}) or {}
    result = {
        "rank":       rank.get("name", "") if isinstance(rank, dict) else "",
        "kudos":      u.get("kudos_received_sum_weight", 0) or 0,
        "messages":   u.get("messages_count",            0) or 0,
        "solutions":  u.get("solutions_count",           0) or 0,
        "registered": u.get("registration_time",         "") or "",
    }
    cache[author_id] = result
    return result



# ── Content-type search ───────────────────────────────────────────────────────

def _search_by_type(keyword: str, style: str, limit: int, offset: int = 0) -> List[dict]:
    kw    = keyword.replace("'", "\\'")
    limit = min(limit, 25)

    for query, label in [
        (
            f"SELECT * FROM messages "
            f"WHERE (subject MATCHES '{kw}' OR body MATCHES '{kw}') "
            f"AND conversation.style = '{style}' AND depth = 0 "
            f"{LANGUAGE_FILTER} "
            f"ORDER BY post_time DESC LIMIT {limit} OFFSET {offset}",
            f"{style}:subject_or_body",
        ),
        (
            f"SELECT * FROM messages "
            f"WHERE subject MATCHES '{kw}' "
            f"AND conversation.style = '{style}' AND depth = 0 "
            f"{LANGUAGE_FILTER} "
            f"ORDER BY post_time DESC LIMIT {limit} OFFSET {offset}",
            f"{style}:subject",
        ),
        (
            f"SELECT * FROM messages "
            f"WHERE tags.text IN ('{kw}') "
            f"AND conversation.style = '{style}' AND depth = 0 "
            f"{LANGUAGE_FILTER} "
            f"ORDER BY post_time DESC LIMIT {limit} OFFSET {offset}",
            f"{style}:tags",
        ),
    ]:
        items = _liql(query, label)
        if items:
            return items

    return []


def _fetch_replies(message_id: str, limit: int) -> List[dict]:
    query = (
        f"SELECT * FROM messages "
        f"WHERE parent.id = '{message_id}' "
        f"{LANGUAGE_FILTER} "
        f"ORDER BY post_time ASC "
        f"LIMIT {min(limit, 25)}"
    )
    return _liql(query, f"replies:{message_id}")


# ── Parse a raw message ───────────────────────────────────────────────────────

def _parse_message(
    raw:          dict,
    content_type: str                       = "",
    board_cache:  Optional[Dict[str, str]]  = None,
    author_cache: Optional[Dict[str, dict]] = None,
) -> dict:
    author = raw.get("author",       {}) or {}
    board  = raw.get("board",        {}) or {}
    rank   = author.get("rank",      {}) or {}
    conv   = raw.get("conversation", {}) or {}

    post_id   = str(raw.get("id", ""))
    board_id  = board.get("id", "")
    author_id = str(author.get("id", ""))

    base_rank             = rank.get("name", "") if isinstance(rank, dict) else ""
    base_author_kudos     = author.get("kudos_received_sum_weight", 0) or 0
    base_author_messages  = author.get("messages_count",            0) or 0
    base_author_solutions = author.get("solutions_count",           0) or 0
    base_board_title      = board.get("title", "") or ""

    board_title  = base_board_title
    author_stats = {}

    if board_cache is not None and not board_title and board_id:
        board_title = _fetch_board_title(board_id, board_cache)

    if author_cache is not None and author_id:
        author_stats = _fetch_author_data(author_id, author_cache)

    return {
        "id":           post_id,
        "url":          raw.get("view_href", ""),
        "content_type": content_type or (conv.get("style", "") if isinstance(conv, dict) else ""),
        "subject":      raw.get("subject", "").strip(),
        "body":         raw.get("body",    "").strip(),
        "created_at":   raw.get("post_time", ""),
        "is_solved":    conv.get("solved", False) if isinstance(conv, dict) else False,
        "reply_count":  raw.get("replies_count", 0),
        "board": {
            "id":    board_id,
            "title": board_title,
        },
        "author": {
            "id":         author_id,
            "username":   author.get("login", ""),
            "rank":       author_stats.get("rank",       base_rank),
            "kudos":      author_stats.get("kudos",      base_author_kudos),
            "messages":   author_stats.get("messages",   base_author_messages),
            "solutions":  author_stats.get("solutions",  base_author_solutions),
            "registered": author_stats.get("registered") or author.get("registration_time", ""),
        },
        "replies": [],
    }


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: AutodeskConfig) -> dict:
    requested_types = (
        ALL_CONTENT_TYPES
        if "all" in cfg.content_types
        else [t for t in cfg.content_types if t != "all"]
    )

    logger.info(
        "Autodesk: searching '%s' across %s (round-robin)",
        cfg.keyword,
        [CONTENT_TYPE_LABELS[t] for t in requested_types],
    )

    board_cache:  Dict[str, str]  = {}
    author_cache: Dict[str, dict] = {}
    seen_ids:     set             = set()

    # ── Step 1: build a pool of candidates per content type ───────────────────
    pools: Dict[str, List[dict]] = {}

    for style in requested_types:
        label            = CONTENT_TYPE_LABELS[style]
        type_posts: List[dict] = []
        offset           = 0
        off_topic        = 0
        consecutive_miss = 0

        logger.info("Autodesk: --- %s (pool fetch) ---", label)

        while len(type_posts) < cfg.max_posts:
            raw_items = _search_by_type(cfg.keyword, style, 25, offset)

            if not raw_items:
                logger.info("Autodesk [%s]: no more results", label)
                break

            found_this_page = 0
            for raw in raw_items:
                pid = str(raw.get("id", ""))
                if not pid or pid in seen_ids:
                    continue

                subject = raw.get("subject", "").strip()
                body    = re.sub(r"<[^>]+>", " ", raw.get("body", "") or "")

                if not _matches_keyword(cfg.keyword, subject, body):
                    off_topic += 1
                    continue

                type_posts.append(_parse_message(
                    raw, style,
                    board_cache  = board_cache,
                    author_cache = author_cache,
                ))
                seen_ids.add(pid)
                found_this_page += 1

                if len(type_posts) >= cfg.max_posts:
                    break

            if found_this_page == 0:
                consecutive_miss += 1
                if consecutive_miss >= 3:
                    logger.info("Autodesk [%s]: 3 pages with no matches — stopping pool fetch", label)
                    break
            else:
                consecutive_miss = 0

            if len(raw_items) < 25:
                break

            offset += 25

        pools[style] = type_posts
        logger.info(
            "Autodesk [%s]: pool=%d%s",
            label, len(type_posts),
            f" | {off_topic} off-topic skipped" if off_topic else "",
        )

    # ── Step 2: round-robin interleave pools ──────────────────────────────────
    posts:   List[dict]     = []
    indices: Dict[str, int] = {s: 0 for s in requested_types}

    while len(posts) < cfg.max_posts:
        added_any = False
        for style in requested_types:
            if len(posts) >= cfg.max_posts:
                break
            pool = pools.get(style, [])
            idx  = indices[style]
            if idx < len(pool):
                posts.append(pool[idx])
                indices[style] += 1
                added_any = True
        if not added_any:
            break  # all pools exhausted

    logger.info(
        "Autodesk: round-robin assembled %d posts from pools %s",
        len(posts),
        {s: indices[s] for s in requested_types},
    )

    logger.info("Autodesk: %d posts collected — fetching replies", len(posts))

    if cfg.max_replies > 0:
        for i, post in enumerate(posts):
            logger.info(
                "Autodesk: [%02d/%02d] [%s] %s",
                i + 1, len(posts), post["content_type"], post["subject"][:55],
            )
            for raw_reply in _fetch_replies(post["id"], cfg.max_replies):
                post["replies"].append(_parse_message(
                    raw_reply, "",
                    board_cache  = board_cache,
                    author_cache = author_cache,
                ))
            logger.info(
                "Autodesk:         %d replies | solved: %s",
                len(post["replies"]), post["is_solved"],
            )

    logger.info(
        "Autodesk: enrichment done — %d boards | %d authors fetched",
        len(board_cache), len(author_cache),
    )

    payload = {
        "keyword":       cfg.keyword,
        "source":        "forums.autodesk.com",
        "content_types": [CONTENT_TYPE_LABELS[t] for t in requested_types],
        "scraped_at":    datetime.now(tz=timezone.utc).isoformat(),
        "total_posts":   len(posts),
        "total_replies": sum(len(p["replies"]) for p in posts),
        "posts":         posts,
    }

    logger.info("Autodesk: %d matching posts ready for DB", len(posts))
    return payload
"""
scrapers/tiktok.py
TikTok scraper — powered by ScrapeCreators API.
API key is pre-filled in models.py; no changes needed here.

v2: Stores directly in PostgreSQL — no JSON file output.
"""

from __future__ import annotations

import logging, time
from datetime import datetime, timezone
from typing import List, Optional

import requests

from models import TikTokConfig

logger   = logging.getLogger("scraper.tiktok")
BASE_URL = "https://api.scrapecreators.com"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _headers(api_key: str) -> dict:
    return {"x-api-key": api_key, "Content-Type": "application/json"}


# ── Search posts ──────────────────────────────────────────────────────────────

def _search_posts(cfg: TikTokConfig) -> List[dict]:
    posts  = []
    cursor = None
    tag    = cfg.keyword.strip("#").replace(" ", "").lower()
    logger.info("TikTok: searching #%s", tag)

    while len(posts) < cfg.max_posts:
        params: dict = {"hashtag": tag}
        if cursor:
            params["cursor"] = cursor
        try:
            resp = requests.get(
                f"{BASE_URL}/v1/tiktok/search/hashtag",
                headers=_headers(cfg.api_key),
                params=params,
                timeout=30,
            )
            if resp.status_code != 200:
                logger.error("TikTok search %d: %s", resp.status_code, resp.text[:300])
                break
            data     = resp.json()
            batch    = data.get("aweme_list", [])
            if not batch:
                logger.info("TikTok: no more results")
                break
            posts.extend(batch)
            logger.info("TikTok: got %d (running total %d)", len(batch), len(posts))
            cursor   = data.get("cursor")
            has_more = data.get("has_more", False)
            if not cursor or not has_more:
                break
            time.sleep(0.5)
        except Exception as e:
            logger.error("TikTok request failed: %s", e)
            break

    return posts[:cfg.max_posts]


def _parse_post(raw: dict) -> Optional[dict]:
    if not raw:
        return None
    try:
        author     = raw.get("author",     {}) or {}
        statistics = raw.get("statistics", {}) or {}
        music      = raw.get("music",      {}) or {}
        video      = raw.get("video",      {}) or {}
        vid_id     = str(raw.get("aweme_id", "") or raw.get("id", ""))
        video_url  = (
            raw.get("share_url", "")
            or f"https://www.tiktok.com/@{author.get('unique_id','')}/video/{vid_id}"
        )
        return {
            "id":         vid_id,
            "url":        video_url,
            "title":      raw.get("desc", "").strip(),
            "created_at": datetime.fromtimestamp(int(raw.get("create_time", 0)), tz=timezone.utc).isoformat(),
            "author": {
                "username":  author.get("unique_id",       ""),
                "nickname":  author.get("nickname",        ""),
                "verified":  author.get("custom_verify",   "") != "",
                "followers": author.get("follower_count",   0),
                "following": author.get("following_count",  0),
                "likes":     author.get("total_favorited",  0),
                "bio":       author.get("signature",        ""),
            },
            "stats": {
                "plays":    statistics.get("play_count",    0),
                "likes":    statistics.get("digg_count",    0),
                "comments": statistics.get("comment_count", 0),
                "shares":   statistics.get("share_count",   0),
                "saves":    statistics.get("collect_count", 0),
            },
            "video":    {"duration_sec": video.get("duration", 0)},
            "music":    {"title": music.get("title", ""), "artist": music.get("author", "")},
            "hashtags": [c.get("cha_name", "") for c in raw.get("cha_list", []) if c.get("cha_name")],
            "comments": [],
        }
    except Exception as e:
        logger.warning("TikTok parse error: %s", e)
        return None


def _fetch_comments(cfg: TikTokConfig, video_url: str) -> List[dict]:
    comments = []
    cursor   = None

    while len(comments) < cfg.max_comments:
        params: dict = {"url": video_url}
        if cursor:
            params["cursor"] = cursor
        try:
            resp = requests.get(
                f"{BASE_URL}/v1/tiktok/video/comments",
                headers=_headers(cfg.api_key),
                params=params,
                timeout=30,
            )
            if resp.status_code != 200:
                break
            data  = resp.json()
            batch = data.get("comments", [])
            if not batch:
                break
            for c in batch:
                u = c.get("user", {})
                comments.append({
                    "id":          c.get("cid", ""),
                    "text":        c.get("text", "").strip(),
                    "likes":       c.get("digg_count", 0),
                    "created_at":  datetime.fromtimestamp(int(c.get("create_time", 0)), tz=timezone.utc).isoformat(),
                    "reply_count": c.get("reply_comment_total", 0),
                    "author": {
                        "username": u.get("unique_id", ""),
                        "nickname": u.get("nickname",  ""),
                    },
                })
                if len(comments) >= cfg.max_comments:
                    break
            cursor   = data.get("cursor")
            has_more = data.get("has_more", False)
            if not cursor or not has_more:
                break
            time.sleep(0.3)
        except Exception as e:
            logger.error("TikTok comments error: %s", e)
            break

    return comments


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: TikTokConfig) -> dict:
    raw_posts = _search_posts(cfg)
    posts: List[dict] = []

    seen_ids: set = set()
    for raw in raw_posts:
        vid_id = str(raw.get("aweme_id", "") or raw.get("id", ""))
        if not vid_id or vid_id in seen_ids:
            continue
        parsed = _parse_post(raw)
        if parsed:
            posts.append(parsed)
            seen_ids.add(vid_id)
        if len(posts) >= cfg.max_posts:
            break

    logger.info("TikTok: %d posts collected", len(posts))

    if cfg.max_comments > 0:
        for i, post in enumerate(posts):
            logger.info("TikTok: [%02d/%02d] comments — @%s", i + 1, len(posts), post["author"]["username"])
            if post["stats"]["comments"] > 0:
                post["comments"] = _fetch_comments(cfg, post["url"])

    payload = {
        "keyword":        cfg.keyword,
        "scraped_at":     datetime.now(tz=timezone.utc).isoformat(),
        "total_posts":    len(posts),
        "total_comments": sum(len(p["comments"]) for p in posts),
        "posts":          posts,
    }

    logger.info("TikTok: %d posts ready for DB", len(posts))
    return payload
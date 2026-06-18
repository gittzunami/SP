"""
facebook.py
===========
Scrapes Facebook group posts via ScrapeCreators API and filters by keyword.
Requires: SCRAPECREATORS_KEY in .env
Cost:     set FACEBOOK_COST_RATE=6/1000 in .env ("$6 per 1000 results")
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import List

logger    = logging.getLogger("scraper.facebook")
_ENDPOINT = "https://api.scrapecreators.com/v1/facebook/group/posts"
_TOKEN    = os.getenv("SCRAPECREATORS_KEY", "")

STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of",
    "with","by","from","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","it","its","this","that","these","those",
    "as","up","out","about",
}


def _keyword_match(text: str, keyword: str) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    return fuzzy_match(keyword, text)


def _parse_api_error(resp) -> str:
    """Extract the most useful error message from a ScrapeCreators error response."""
    try:
        body = resp.json()
        return (
            body.get("message")
            or body.get("error")
            or body.get("detail")
            or resp.text[:300]
        )
    except Exception:
        return resp.text[:300] or f"HTTP {resp.status_code}"


def _check_response(resp, attempt: int = 1):
    """
    Raise a clear RuntimeError for known ScrapeCreators failure codes.
    Returns True if the caller should retry (429 after sleep), False otherwise.
    """
    import requests as _requests

    sc = resp.status_code

    if sc == 200:
        return False   # all good

    if sc == 401:
        raise RuntimeError(
            "ScrapeCreators: Invalid API key — check SCRAPECREATORS_KEY in .env"
        )
    if sc == 402:
        raise RuntimeError(
            "ScrapeCreators: Insufficient credits — top up at scrapecreators.com"
        )
    if sc == 403:
        raise RuntimeError(
            "ScrapeCreators: Access forbidden — the group may be private or "
            "your plan does not include Facebook Groups"
        )
    if sc == 404:
        raise RuntimeError(
            "ScrapeCreators: Group not found — check the group_url is correct "
            "and the group is publicly accessible"
        )
    if sc == 422:
        detail = _parse_api_error(resp)
        raise RuntimeError(f"ScrapeCreators: Invalid request — {detail}")
    if sc == 429:
        wait = 30 * attempt          # back-off: 30 s, 60 s, 90 s …
        logger.warning("ScrapeCreators rate-limited — waiting %d s (attempt %d)", wait, attempt)
        time.sleep(wait)
        return True                  # signal caller to retry
    if sc >= 500:
        detail = _parse_api_error(resp)
        raise RuntimeError(
            f"ScrapeCreators server error ({sc}) — service may be down, "
            f"try again later. Detail: {detail}"
        )

    # Any other unexpected code
    detail = _parse_api_error(resp)
    raise RuntimeError(f"ScrapeCreators API error {sc}: {detail}")


def _extract_text(post: dict) -> str:
    """Try every field name ScrapeCreators might use for post content."""
    for field in ("text", "message", "post_text", "content", "body",
                  "description", "story", "post_message", "caption"):
        val = post.get(field)
        if val and isinstance(val, str):
            return val
    return ""


def _extract_comment_text(c: dict) -> str:
    for field in ("text", "message", "content", "body", "comment_text"):
        val = c.get(field)
        if val and isinstance(val, str):
            return val
    return ""


def _parse_post_dt(post: dict):
    """Return timezone-aware datetime for a post, or None if unparseable."""
    raw = (post.get("publishTime") or post.get("created_at")
           or post.get("timestamp") or post.get("created_time") or "")
    if not raw:
        return None
    try:
        # Unix timestamp (int or numeric string)
        ts = int(str(raw).strip())
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (ValueError, TypeError):
        pass
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def run(cfg) -> dict:
    """Entry point called by _run_scraper in main.py."""
    import requests as _requests

    token = getattr(cfg, "api_key", "") or _TOKEN
    if not token:
        raise RuntimeError(
            "ScrapeCreators API key not configured — set SCRAPECREATORS_KEY in .env"
        )
    if not cfg.group_url:
        raise RuntimeError(
            "group_url is required — provide a Facebook group URL"
        )

    # Parse the date cutoff once
    since_dt = None
    since_date = getattr(cfg, "since_date", None)
    if since_date:
        try:
            since_dt = datetime.fromisoformat(since_date)
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)
        except Exception:
            logger.warning("Facebook: could not parse since_date=%r — ignoring", since_date)

    logger.info(
        "Facebook [ScrapeCreators]: group=%r | keyword=%r | max_posts=%d | since=%s",
        cfg.group_url, cfg.keyword, cfg.max_posts,
        since_dt.date().isoformat() if since_dt else "none",
    )

    kw_words = [w for w in cfg.keyword.lower().split() if w not in STOP_WORDS] or [cfg.keyword.lower()]
    logger.info("Facebook: active filter words: %s", kw_words)

    headers      = {"x-api-key": token}
    matched:     List[dict] = []
    api_fetched  = 0          # total posts pulled from API (billing basis)
    cursor       = None
    page_num     = 0
    first_page   = True
    date_cutoff_hit = False

    # Keep paginating until we have enough matched posts or hit the date boundary
    while len(matched) < cfg.max_posts:
        page_num += 1
        params: dict = {"url": cfg.group_url}
        if cursor:
            params["cursor"] = cursor

        logger.info("Facebook: fetching page %d (matched %d/%d) …",
                    page_num, len(matched), cfg.max_posts)

        # ── HTTP request (retries on DNS/connection failures) ─────────────
        _retry_attempt  = 0
        _conn_attempt   = 0
        _MAX_CONN_RETRY = 3
        _CONN_BACKOFF   = [5, 15, 30]   # seconds between connection retries
        while True:
            try:
                resp = _requests.get(_ENDPOINT, headers=headers, params=params, timeout=60)
            except _requests.exceptions.ConnectionError as exc:
                _conn_attempt += 1
                if _conn_attempt >= _MAX_CONN_RETRY:
                    raise RuntimeError(
                        "Cannot reach ScrapeCreators — check your internet connection / Server unreachable."
                        f"|||{exc}"
                    ) from exc
                wait = _CONN_BACKOFF[_conn_attempt - 1]
                logger.warning(
                    "Facebook: connection error (attempt %d/%d), retrying in %ds: %s",
                    _conn_attempt, _MAX_CONN_RETRY, wait, str(exc)[:200],
                )
                time.sleep(wait)
                continue
            except _requests.exceptions.Timeout:
                raise RuntimeError(
                    "ScrapeCreators request timed out — try again later."
                    "|||Request to api.scrapecreators.com timed out after 60 s"
                )
            except _requests.exceptions.RequestException as exc:
                raise RuntimeError(f"Facebook API request failed: {exc}") from exc

            _conn_attempt = 0   # reset on successful connection
            logger.info("Facebook: page %d — HTTP %d", page_num, resp.status_code)

            _retry_attempt += 1
            should_retry = _check_response(resp, attempt=_retry_attempt)
            if not should_retry:
                break
            if _retry_attempt >= 3:
                raise RuntimeError(
                    "ScrapeCreators rate-limited — too many retries, try again later"
                )

        # ── Parse body ────────────────────────────────────────────────────
        try:
            raw = resp.json()
        except Exception:
            raise RuntimeError(
                f"ScrapeCreators returned non-JSON response: {resp.text[:200]}"
            )

        if raw.get("error") or raw.get("status") == "error":
            detail = raw.get("message") or raw.get("error") or "unknown error"
            raise RuntimeError(f"ScrapeCreators API error: {detail}")

        batch = raw.get("posts", []) or []
        logger.info("Facebook: page %d returned %d post(s) | cursor=%s",
                    page_num, len(batch), "yes" if raw.get("cursor") else "none")

        if not batch:
            logger.info("Facebook: empty batch — no more posts in this group")
            break

        # Log field structure on first page so we can debug field names
        if first_page and batch:
            first_page = False
            logger.info("Facebook: first post keys = %s", list(batch[0].keys()))
            logger.info("Facebook: first post sample = %s",
                        str({k: str(v)[:80] for k, v in batch[0].items()
                             if isinstance(v, (str, int, float, bool)) or v is None})[:400])

        # ── Per-post filtering (inline, same page) ─────────────────────────
        for post in batch:
            api_fetched += 1

            # Date check — Facebook returns posts newest-first.
            # Once we see a post older than since_dt, all remaining posts
            # will also be older, so we can stop entirely.
            if since_dt:
                post_dt = _parse_post_dt(post)
                if post_dt and post_dt < since_dt:
                    logger.info(
                        "Facebook: post id=%s dated %s is before cutoff %s — stopping",
                        post.get("id", "?"),
                        post_dt.date().isoformat(),
                        since_dt.date().isoformat(),
                    )
                    date_cutoff_hit = True
                    break   # stop processing this batch

            post_text     = _extract_text(post)
            post_comments = post.get("comments", []) or []

            post_match = _keyword_match(post_text, cfg.keyword)
            matched_comments = [
                {
                    "comment_id": str(c.get("id", "")),
                    "text":       _extract_comment_text(c),
                    "author":     c.get("author") or c.get("author_name") or "",
                    "created_at": c.get("created_at") or c.get("timestamp") or "",
                }
                for c in post_comments
                if _keyword_match(_extract_comment_text(c), cfg.keyword)
            ]

            if not post_match and not matched_comments:
                logger.info(
                    "Facebook: post id=%s skipped — text=%r (str keys=%s)",
                    post.get("id", "?"), post_text[:100],
                    [k for k in post.keys() if isinstance(post.get(k), str)][:8],
                )
                continue

            post_dt = _parse_post_dt(post)
            created_at = post_dt.isoformat() if post_dt else datetime.now(tz=timezone.utc).isoformat()

            logger.info(
                "Facebook: ✓ post id=%s matched (post=%s, comments=%d) author=%r",
                post.get("id", "?"), post_match, len(matched_comments),
                post.get("author") or post.get("author_name") or "unknown",
            )

            # author can be a dict {"name": ..., "id": ...} or a plain string
            _author_raw = post.get("author") or {}
            if isinstance(_author_raw, dict):
                author_name = _author_raw.get("name") or _author_raw.get("short_name") or ""
                author_id   = str(_author_raw.get("id") or "")
            else:
                author_name = str(_author_raw)
                author_id   = str(post.get("author_id") or post.get("user_id") or "")

            _video_details   = post.get("videoDetails")
            _reaction_counts = post.get("reaction_counts")

            matched.append({
                "post_id":          str(post.get("id") or post.get("post_id") or ""),
                "text":             post_text,
                "url":              post.get("url") or post.get("post_url") or "",
                "permalink":        post.get("permalink") or "",
                "group_url":        cfg.group_url,
                "image_url":        post.get("image") or "",
                "video_view_count": int(post.get("videoViewCount") or 0) if str(post.get("videoViewCount") or "").isdigit() else 0,
                "video_details":    _video_details if isinstance(_video_details, str) else (str(_video_details) if _video_details else ""),
                "reaction_counts":  _reaction_counts if isinstance(_reaction_counts, str) else (str(_reaction_counts) if _reaction_counts else ""),
                "author":           author_name,
                "author_id":        author_id,
                "likes_count":      int(post.get("reactionCount") or post.get("likes_count") or post.get("likes") or 0),
                "comments_count":   int(post.get("commentCount") or post.get("comments_count") or post.get("comments") or 0),
                "created_at":       created_at,
                "matched_comments": matched_comments,
            })

            if len(matched) >= cfg.max_posts:
                logger.info("Facebook: reached max_posts=%d — stopping", cfg.max_posts)
                break

        # Stop paginating if date cutoff was hit or max matched already reached
        if date_cutoff_hit or len(matched) >= cfg.max_posts:
            break

        cursor = raw.get("cursor")
        if not cursor:
            logger.info("Facebook: no cursor — reached end of group feed")
            break

    stop_reason = (
        "max_posts reached" if len(matched) >= cfg.max_posts
        else "date cutoff reached" if date_cutoff_hit
        else "no more pages"
    )
    logger.info(
        "Facebook: done — %d matched | %d fetched from API | stop reason: %s",
        len(matched), api_fetched, stop_reason,
    )

    return {
        "keyword":            cfg.keyword,
        "group_url":          cfg.group_url,
        "total_posts":        len(matched),
        "_api_fetched_count": api_fetched,
        "scraped_at":         datetime.now(tz=timezone.utc).isoformat(),
        "posts":              matched,
    }

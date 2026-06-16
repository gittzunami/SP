"""
scrapers/scrappa_google_news.py
================================
Google News scraper — powered by Scrappa.co

Pricing: SCRAPPA_COST_PER_1K_REQUESTS (default $0.30/1K) + 5% margin = $0.315/1K
API key: SCRAPPA_API_KEY in .env — free tier: 500 credits/month
Sign up: https://scrappa.co/dashboard/register

Keyword matching: all meaningful words (stop-words excluded) must appear
in the article title, snippet, or related story titles.

Webhook: articles are NOT saved to DB directly — they are sent to
Power Automate for approval. DB save happens after approval via
POST /webhook/google-news/response { "approved": true }.

Cost recording is intentionally NOT done here.
It is done in _run_scraper (main.py) AFTER this function returns,
using a clean DB transaction independent of the webhook flow.
"""

from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import List

import requests

logger = logging.getLogger("scraper.google_news")

BASE_URL         = "https://scrappa.co/api/google/news"
MAX_PAGES        = 50
MAX_CONSEC_EMPTY = 3
PAGE_SIZE        = 25
DEFAULT_SORT     = 1    # 1 = latest
DEFAULT_COUNTRY  = ""   # worldwide
DEFAULT_LANGUAGE = "en"

STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of",
    "with","by","from","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","it","its","this","that","these","those",
    "as","up","out","about",
}


def _get_api_key() -> str:
    key = os.environ.get("SCRAPPA_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "SCRAPPA_API_KEY not set. Get a free key at https://scrappa.co/dashboard/register "
            "and add SCRAPPA_API_KEY=your_key to your .env file."
        )
    return key


def _build_query(keyword: str) -> tuple[str, list[str]]:
    raw        = re.findall(r"[a-zA-Z0-9']+", keyword.lower())
    meaningful = [w for w in raw if w not in STOP_WORDS] or raw
    return " ".join(meaningful), meaningful


def _all_words_present(keyword: str, *fields) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    return fuzzy_match(keyword, *fields)


def _fetch_page(api_key: str, q: str, lang: str, country: str, page: int, sort: int) -> dict:
    headers = {"x-api-key": api_key}
    params  = {"q": q, "hl": lang, "page": page, "so": sort, "num": PAGE_SIZE}
    if country:
        params["gl"] = country

    try:
        resp = requests.get(BASE_URL, headers=headers, params=params, timeout=30)
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrappa unreachable: {exc}"
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrappa timed out: {exc}"
        ) from exc

    if resp.status_code == 401:
        raise RuntimeError("Scrappa: Invalid API key — check SCRAPPA_API_KEY in .env")
    if resp.status_code == 402:
        raise RuntimeError("Scrappa: Out of credits — top up at scrappa.co/dashboard")
    if resp.status_code == 403:
        raise RuntimeError("Scrappa: Access denied (403) — your API key may lack required permissions")
    if resp.status_code == 429:
        logger.warning("Scrappa rate limited — waiting 20s")
        time.sleep(20)
        return _fetch_page(api_key, q, lang, country, page, sort)
    if resp.status_code >= 500:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrappa server error {resp.status_code}"
        )
    if resp.status_code == 404:
        raise RuntimeError("Scrappa: Endpoint not found (404) — the API URL may have changed")

    resp.raise_for_status()
    return resp.json()


def _normalise(raw: dict, global_pos: int, keyword: str, scraped_at: str) -> dict:
    source = raw.get("source") or {}
    if isinstance(source, str):
        source_name = source_title = source
    else:
        source_name  = source.get("name",  "")
        source_title = source.get("title", "")

    stories = []
    for s in (raw.get("stories") or []):
        s_src = s.get("source") or {}
        stories.append({
            "title":  s.get("title", ""),
            "url":    s.get("link", "") or s.get("url", ""),
            "source": s_src.get("name", "") if isinstance(s_src, dict) else str(s_src),
            "date":   s.get("iso_date", "") or s.get("date", ""),
        })

    url       = raw.get("link", "") or raw.get("url", "")
    snippet   = raw.get("snippet", "")
    thumbnail = raw.get("thumbnail", "")
    iso_date  = raw.get("iso_date", "") or raw.get("date", "")

    return {
        "position":        global_pos,
        "type":            raw.get("type", "article"),
        "title":           raw.get("title", ""),
        "url":             url,
        "google_news_url": url,       # db_writer reads this first
        "snippet":         snippet,
        "description":     snippet,   # db_writer alias
        "source_name":     source_name,
        "source_title":    source_title,
        "date":            raw.get("date", ""),
        "iso_date":        iso_date,
        "published_at":    iso_date,  # db_writer alias
        "thumbnail":       thumbnail,
        "thumbnail_small": raw.get("thumbnail_small", ""),
        "image_url":       thumbnail, # db_writer alias
        "related_stories": stories,
        "related_count":   len(stories),
        "search_query":    keyword,   # db_writer field
        "scraped_at":      scraped_at,
    }


def _scrape_keyword(
    api_key:    str,
    keyword:    str,
    max_r:      int,
    lang:       str,
    country:    str,
    sort:       int,
    scraped_at: str,
) -> tuple[list, int]:
    api_q, _ = _build_query(keyword)
    logger.info("Scrappa query: %r | fuzzy keyword: %s", api_q, keyword)

    collected        = []
    page             = 1
    n_requests       = 0
    global_pos       = 0
    consecutive_zero = 0

    while len(collected) < max_r and page <= MAX_PAGES:
        logger.info("  Fetching page %d …", page)
        data        = _fetch_page(api_key, api_q, lang, country, page, sort)
        n_requests += 1

        articles = data.get("news_results") or []
        if not articles:
            consecutive_zero += 1
            if consecutive_zero >= MAX_CONSEC_EMPTY:
                logger.info("  %d consecutive empty pages — stopping.", MAX_CONSEC_EMPTY)
                break
            page += 1
            time.sleep(0.5)
            continue
        else:
            consecutive_zero = 0

        new_count = 0
        for raw in articles:
            global_pos  += 1
            stories_text = " ".join(s.get("title", "") for s in (raw.get("stories") or []))
            if _all_words_present(keyword, raw.get("title", ""), raw.get("snippet", ""), stories_text):
                collected.append(_normalise(raw, global_pos, keyword, scraped_at))
                new_count += 1
                if len(collected) >= max_r:
                    break

        logger.info(
            "  Page %d: %d raw → +%d matched | total %d / %d",
            page, len(articles), new_count, len(collected), max_r,
        )

        if len(collected) >= max_r:
            break

        page += 1
        time.sleep(0.5)

    return collected, n_requests


def run_google_news(keywords: List[str], max_results: int = 50,
                    task_id: str = "", db=None) -> dict:
    """
    Entry point called by _run_scraper in main.py.
    Same interface as the old apify_google_news.run_google_news,
    extended with max_results.
    """
    api_key    = _get_api_key()
    scraped_at = datetime.now(tz=timezone.utc).isoformat()

    lang    = DEFAULT_LANGUAGE
    country = DEFAULT_COUNTRY
    sort    = DEFAULT_SORT

    per_kw = max(1, max_results // max(len(keywords), 1))

    all_articles:  list = []
    total_requests: int = 0
    seen_urls:      set = set()

    for kw in keywords:
        logger.info("Google News [Scrappa]: keyword=%r max=%d", kw, per_kw)
        articles, reqs = _scrape_keyword(
            api_key, kw.strip(), per_kw, lang, country, sort, scraped_at
        )
        total_requests += reqs
        for a in articles:
            url = a.get("google_news_url") or a.get("url") or ""
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_articles.append(a)
            elif not url:
                all_articles.append(a)

    logger.info(
        "Google News [Scrappa]: %d articles from %d API requests",
        len(all_articles), total_requests,
    )

    payload = {
        "keywords":         keywords,
        "scraped_at":       scraped_at,
        "total_articles":   len(all_articles),
        "articles":         all_articles,
        "_webhook_pending": True,
        "_scrappa_run_stats": {
            "requests_made":  total_requests,
            "articles_found": len(all_articles),
        },
    }

    # ── Send to webhook for approval ──────────────────────────────────────────
    # Articles are NOT saved to DB here — saved after approval via webhook.
    if db is not None and all_articles:
        try:
            from newsletter_service import send_to_webhook
            keyword_str = ", ".join(keywords[:3])
            job = send_to_webhook(db, task_id, keyword_str, all_articles)
            payload["newsletter_job_id"]  = job.get("job_id")
            payload["webhook_status"]     = job.get("status")
            payload["newsletters_created"] = job.get("newsletters_created", 0)
            logger.info(
                "Google News: webhook triggered — job_id=%s status=%s newsletters=%d",
                job.get("job_id"), job.get("status"), payload["newsletters_created"],
            )
        except Exception as exc:
            logger.error("Google News: webhook trigger failed: %s", exc)
            payload["webhook_error"] = str(exc)
    elif not all_articles:
        logger.warning("Google News: no articles returned — skipping webhook")
    else:
        logger.warning("Google News: no DB session — skipping webhook")

    return payload

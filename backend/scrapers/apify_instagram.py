"""
scrapers/apify_instagram.py
Instagram scraper — powered by Apify.
Actor ID is read from .env so it can be changed without touching code.

Cost recording is intentionally NOT done here.
It is done in _run_scraper (main.py) AFTER this function returns,
using the INSTAGRAM_COST_RATE env var (or usageTotalUsd fallback)
so the real charge is always captured in a clean, independent transaction.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import List

from apify_client import ApifyClient
from models import APIFY_API_TOKEN

logger   = logging.getLogger("scraper.instagram")
ACTOR_ID = os.environ.get("APIFY_ACTOR_INSTAGRAM", "apify~instagram-scraper")


def run_instagram(keywords: List[str], results_limit: int = 20,
                  task_id: str = "") -> dict:
    start  = time.time()
    client = ApifyClient(APIFY_API_TOKEN)

    direct_urls: List[str] = []
    hashtags:    List[str] = []

    for kw in keywords:
        kw = kw.strip()
        if kw.startswith("#"):
            hashtags.append(kw.lstrip("#"))
        else:
            direct_urls.append(f"https://www.instagram.com/{kw}/")

    run_input: dict = {"resultsLimit": results_limit}
    if direct_urls:
        run_input["directUrls"] = direct_urls
    if hashtags:
        run_input["hashtags"] = hashtags

    logger.info("Instagram [%s]: searching %s (limit %d) using actor %s",
                task_id, keywords, results_limit, ACTOR_ID)

    run   = client.actor(ACTOR_ID).call(run_input=run_input)
    posts = client.dataset(run["defaultDatasetId"]).list_items().items

    # Expose Apify run metadata so _run_scraper can record the cost
    # independently, in its own clean DB transaction.
    _stats = (run or {}).get("stats", {}) or {}
    payload = {
        "keywords":          keywords,
        "scraped_at":        datetime.now(tz=timezone.utc).isoformat(),
        "total_posts":       len(posts),
        "response_time_sec": round(time.time() - start, 2),
        "posts":             posts,
        "_apify_run_stats":  {
            "usageTotalUsd": float((run or {}).get("usageTotalUsd", 0) or 0),
            "computeUnits":  float(_stats.get("computeUnits", 0) or 0),
            "items_count":   len(posts),
        },
    }

    logger.info("Instagram: %d posts ready for DB", len(posts))
    return payload
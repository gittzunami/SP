"""
stackexchange.py
================
StackExchange scraper — official free API (v2.3).
API key loaded from STACKAPPS_KEY in .env → 10,000 req/day.

Keyword matching: ALL words in the keyword phrase must appear in
the question title, body, or tags (case-insensitive).

Batch strategy (avoids 400 / 429 errors):
  Phase 1 — search questions     : ceil(N / 100) calls
  Phase 2 — batch fetch answers  : ceil(N / answer_batch_size) calls
  Phase 3 — batch fetch comments : ceil(N / 100) calls

  answer_batch_size = floor(100 / max_answers_per_q)
    → 50 ans/q  =  2 questions per call
    → 10 ans/q  = 10 questions per call
    →  5 ans/q  = 20 questions per call

  Example: 1000 questions, 50 answers each
    → 500 answer calls + 10 comment calls = 510 total  (was 2000+)
    → ~2.5 min with 0.3s inter-call sleep
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import List

import requests

from models import StackExchangeConfig

logger   = logging.getLogger("scraper.stackexchange")
BASE_URL = "https://api.stackexchange.com/2.3"

COMMENTS_BATCH    = 100   # always safe — comments are light
INTER_BATCH_SLEEP = 0.3   # seconds between every batch call


# ── Helpers ───────────────────────────────────────────────────────────────────

STOP_WORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of",
    "with","by","from","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could",
    "should","may","might","it","its","this","that","these","those",
    "as","up","out","about",
}


def _chunks(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def _api_get(key: str, path: str, params: dict) -> dict:
    if key:
        params["key"] = key
    try:
        resp = requests.get(BASE_URL + path, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if data.get("backoff"):
            wait = int(data["backoff"]) + 1
            logger.warning("StackExchange backoff — sleeping %ds", wait)
            time.sleep(wait)
        quota = data.get("quota_remaining")
        if quota is not None and quota < 50:
            logger.warning("StackExchange: only %d requests remaining today", quota)
        return data
    except Exception as e:
        logger.error("StackExchange API error: %s", e)
        return {}


def _matches_keyword(keyword: str, title: str, body: str, tags: list) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    tag_str = " ".join(tags) if tags else ""
    return fuzzy_match(keyword, title, body, tag_str)


# ── Phase 1: search ───────────────────────────────────────────────────────────

def _search_questions(cfg: StackExchangeConfig, site: str, page: int):
    params: dict = {
        "q":        cfg.keyword,
        "order":    "desc",
        "sort":     "creation",
        "site":     site,
        "page":     page,
        "pagesize": 100,
        "filter":   "withbody",
    }
    if cfg.since_date:
        try:
            dt = datetime.fromisoformat(cfg.since_date.replace("Z", "+00:00"))
            params["fromdate"] = int(dt.timestamp())
        except Exception:
            logger.warning("StackExchange: could not parse since_date=%r", cfg.since_date)
    data = _api_get(cfg.api_key, "/search/advanced", params)
    return data.get("items", []), data.get("has_more", False)


# ── Phase 2: batch answers ────────────────────────────────────────────────────

def _batch_fetch_answers(
    cfg: StackExchangeConfig,
    site: str,
    question_ids: list,
    max_per_q: int,
) -> dict:
    """
    Fetch up to max_per_q answers for each question_id in the batch.
    Returns dict: str(question_id) → [parsed answer, ...]
    Paginates within the batch until every question is satisfied or has_more=False.
    """
    ids_str    = ";".join(str(qid) for qid in question_ids)
    result_map: dict = {str(qid): [] for qid in question_ids}
    page = 1

    while True:
        data  = _api_get(cfg.api_key, f"/questions/{ids_str}/answers", {
            "order":    "desc",
            "sort":     "votes",
            "site":     site,
            "page":     page,
            "pagesize": 100,   # hard API max — never exceed this
            "filter":   "withbody",
        })
        items = data.get("items", [])
        if not items:
            break

        for ra in items:
            qid = str(ra.get("question_id", ""))
            if qid in result_map and len(result_map[qid]) < max_per_q:
                result_map[qid].append(_parse_answer(ra))

        # Stop if every question in batch has reached its cap
        all_satisfied = all(len(v) >= max_per_q for v in result_map.values())
        if all_satisfied or not data.get("has_more"):
            break

        page += 1
        time.sleep(0.2)

    return result_map


# ── Phase 3: batch comments ───────────────────────────────────────────────────

def _batch_fetch_comments(
    cfg: StackExchangeConfig,
    site: str,
    post_ids: list,
    max_per_post: int,
) -> dict:
    """
    Fetch up to max_per_post comments for each post_id in the batch.
    Returns dict: str(post_id) → [parsed comment, ...]
    """
    ids_str    = ";".join(str(pid) for pid in post_ids)
    result_map: dict = {str(pid): [] for pid in post_ids}
    page = 1

    while True:
        data  = _api_get(cfg.api_key, f"/posts/{ids_str}/comments", {
            "order":    "asc",
            "sort":     "creation",
            "site":     site,
            "page":     page,
            "pagesize": 100,
            "filter":   "withbody",
        })
        items = data.get("items", [])
        if not items:
            break

        for rc in items:
            pid = str(rc.get("post_id", ""))
            if pid in result_map and len(result_map[pid]) < max_per_post:
                result_map[pid].append(_parse_comment(rc))

        all_satisfied = all(len(v) >= max_per_post for v in result_map.values())
        if all_satisfied or not data.get("has_more"):
            break

        page += 1
        time.sleep(0.2)

    return result_map


# ── Parsers ───────────────────────────────────────────────────────────────────

def _parse_question(raw: dict, site: str) -> dict:
    owner = raw.get("owner", {})
    return {
        "id":            raw.get("question_id", ""),
        "url":           raw.get("link", ""),
        "site":          site,
        "title":         raw.get("title", "").strip(),
        "body":          raw.get("body",  "").strip(),
        "created_at":    datetime.fromtimestamp(
                             int(raw.get("creation_date",      0)), tz=timezone.utc
                         ).isoformat(),
        "last_activity": datetime.fromtimestamp(
                             int(raw.get("last_activity_date", 0)), tz=timezone.utc
                         ).isoformat(),
        "tags":          raw.get("tags", []),
        "author": {
            "username":   owner.get("display_name", ""),
            "reputation": owner.get("reputation",    0),
            "user_id":    owner.get("user_id",        0),
        },
        "stats": {
            "score":       raw.get("score",        0),
            "views":       raw.get("view_count",   0),
            "answers":     raw.get("answer_count", 0),
            "is_answered": raw.get("is_answered",  False),
        },
        "comments": [],
        "answers":  [],
    }


def _parse_answer(raw: dict) -> dict:
    owner = raw.get("owner", {})
    return {
        "id":          raw.get("answer_id", ""),
        "body":        raw.get("body", "").strip(),
        "created_at":  datetime.fromtimestamp(
                           int(raw.get("creation_date", 0)), tz=timezone.utc
                       ).isoformat(),
        "is_accepted": raw.get("is_accepted", False),
        "author": {
            "username":   owner.get("display_name", ""),
            "reputation": owner.get("reputation",    0),
            "user_id":    owner.get("user_id",        0),
        },
        "stats":    {"score": raw.get("score", 0)},
        "comments": [],
    }


def _parse_comment(raw: dict) -> dict:
    owner = raw.get("owner", {})
    return {
        "id":         raw.get("comment_id", ""),
        "body":       raw.get("body", "").strip(),
        "created_at": datetime.fromtimestamp(
                          int(raw.get("creation_date", 0)), tz=timezone.utc
                      ).isoformat(),
        "score":      raw.get("score", 0),
        "author": {
            "username":   owner.get("display_name", ""),
            "reputation": owner.get("reputation",    0),
        },
    }


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: StackExchangeConfig) -> dict:
    all_posts: List[dict] = []
    seen_ids:  set        = set()

    # Cap pagesize at the API maximum to avoid 400 errors
    max_answers  = min(getattr(cfg, "max_answers",  50), 50)
    max_comments = min(getattr(cfg, "max_comments",  5),  100)

    # Dynamic batch size: floor(100 / answers_wanted_per_question)
    # Ensures one batch call can satisfy every question in the chunk
    answer_batch_size = max(1, 100 // max_answers)

    logger.info(
        "StackExchange: '%s' on %s | max_questions=%d max_answers=%d "
        "answer_batch=%d",
        cfg.keyword, cfg.sites, cfg.max_per_site, max_answers, answer_batch_size,
    )

    for site in cfg.sites:
        logger.info("StackExchange: --- %s ---", site)
        site_posts: List[dict] = []
        page     = 1
        has_more = True

        # ── Phase 1: collect matching questions ───────────────────────────────
        while len(site_posts) < cfg.max_per_site and has_more:
            items, has_more = _search_questions(cfg, site, page)
            if not items:
                break

            for raw in items:
                qid = str(raw.get("question_id", ""))
                if not qid or qid in seen_ids:
                    continue
                title = raw.get("title", "").strip()
                body  = raw.get("body",  "").strip()
                tags  = raw.get("tags",  [])
                if not _matches_keyword(cfg.keyword, title, body, tags):
                    logger.debug("SE: skipping off-topic — %s", title[:60])
                    continue
                site_posts.append(_parse_question(raw, site))
                seen_ids.add(qid)
                if len(site_posts) >= cfg.max_per_site:
                    break

            page += 1
            time.sleep(INTER_BATCH_SLEEP)

        logger.info("StackExchange: %d matching questions on %s", len(site_posts), site)
        if not site_posts:
            continue

        qid_list = [str(p["id"]) for p in site_posts]
        total_ans_batches = (len(qid_list) + answer_batch_size - 1) // answer_batch_size
        total_cmt_batches = (len(qid_list) + COMMENTS_BATCH    - 1) // COMMENTS_BATCH

        # ── Phase 2: batch-fetch answers ──────────────────────────────────────
        logger.info(
            "StackExchange: fetching answers — %d questions in %d batches of %d",
            len(qid_list), total_ans_batches, answer_batch_size,
        )
        answers_map: dict = {}
        for batch_n, chunk in enumerate(_chunks(qid_list, answer_batch_size), 1):
            logger.info(
                "StackExchange: answers batch %d/%d", batch_n, total_ans_batches,
            )
            batch_result = _batch_fetch_answers(cfg, site, chunk, max_answers)
            answers_map.update(batch_result)
            time.sleep(INTER_BATCH_SLEEP)

        # ── Phase 3: batch-fetch question comments ────────────────────────────
        logger.info(
            "StackExchange: fetching comments — %d questions in %d batches of %d",
            len(qid_list), total_cmt_batches, COMMENTS_BATCH,
        )
        comments_map: dict = {}
        for batch_n, chunk in enumerate(_chunks(qid_list, COMMENTS_BATCH), 1):
            logger.info(
                "StackExchange: comments batch %d/%d", batch_n, total_cmt_batches,
            )
            batch_result = _batch_fetch_comments(cfg, site, chunk, max_comments)
            comments_map.update(batch_result)
            time.sleep(INTER_BATCH_SLEEP)

        # ── Assign answers + comments back to their questions ─────────────────
        for i, post in enumerate(site_posts):
            qid = str(post["id"])
            post["answers"]  = answers_map.get(qid, [])
            post["comments"] = comments_map.get(qid, [])
            logger.info(
                "StackExchange: [%02d/%02d] %d ans %d com — %s",
                i + 1, len(site_posts),
                len(post["answers"]), len(post["comments"]),
                post["title"][:55],
            )

        all_posts.extend(site_posts)
        time.sleep(0.5)

    payload = {
        "keyword":         cfg.keyword,
        "sites":           cfg.sites,
        "scraped_at":      datetime.now(tz=timezone.utc).isoformat(),
        "total_questions": len(all_posts),
        "total_answers":   sum(len(p["answers"])  for p in all_posts),
        "total_comments":  sum(len(p["comments"]) for p in all_posts),
        "questions":       all_posts,
    }

    logger.info("StackExchange: %d questions ready for DB", len(all_posts))
    return payload

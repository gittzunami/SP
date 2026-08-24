"""
api/routers/scrapers.py
========================
Scraper run/task/status endpoints + the _run_scraper background task runner.

State (task_registry, scraper_status) lives in core.container.state
so it's accessible from anywhere without circular imports.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi import Path as FPath
from sqlalchemy.orm import Session

import database
from api.schemas.scrapers import (
    AutodeskConfig, EduGeekConfig, FacebookConfig, GoogleNewsConfig,
    InstagramConfig, QuoraConfig, RedditConfig, RunRequest, RunResponse,
    SpiceworksConfig, StackExchangeConfig, TikTokConfig, TwitterConfig,
)
from core.container import state
from database import get_db

logger = logging.getLogger("scrapers")
router = APIRouter(tags=["Run"])


# ── Scraper loader ────────────────────────────────────────────────────────────

def _get_scraper(name: str):
    if name == "reddit":        from scrapers import reddit;              return reddit
    if name == "tiktok":        from scrapers import tiktok;              return tiktok
    if name == "edugeek":       from scrapers import edugeek;             return edugeek
    if name == "stackexchange": from scrapers import stackexchange;       return stackexchange
    if name == "autodesk":      from scrapers import autodesk;            return autodesk
    if name == "twitter":       from scrapers import getxapi_twitter;     return getxapi_twitter
    if name == "instagram":     from scrapers import apify_instagram;     return apify_instagram
    if name == "google_news":   from scrapers import scrappa_google_news; return scrappa_google_news
    if name == "spiceworks":    from scrapers import spiceworks;          return spiceworks
    if name == "quora":         from scrapers import quora;               return quora
    if name == "facebook":      from scrapers import facebook;             return facebook
    raise ValueError(f"Unknown scraper: {name!r}")


# ── Date filter ───────────────────────────────────────────────────────────────

def _filter_by_date(scraper: str, result: dict, since_date: str) -> dict:
    """Remove items whose date is before since_date. Applied after scraping and before DB save."""
    if not since_date:
        return result
    try:
        since = datetime.fromisoformat(since_date).replace(tzinfo=timezone.utc)
    except ValueError:
        logger.warning("Invalid since_date %r — skipping date filter", since_date)
        return result

    def _keep(item: dict, *date_keys: str) -> bool:
        for key in date_keys:
            raw = item.get(key)
            if not raw:
                continue
            try:
                raw_s = str(raw)
                if raw_s.count(":") == 2 and "+" in raw_s and len(raw_s) > 25:
                    dt = datetime.strptime(raw_s, "%a %b %d %H:%M:%S %z %Y")
                else:
                    dt = datetime.fromisoformat(raw_s.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt >= since
            except Exception:
                continue
        return True

    result = dict(result)

    if scraper in ("reddit", "autodesk"):
        posts = [p for p in result.get("posts", []) if _keep(p, "created_at")]
        result["posts"]       = posts
        result["total_posts"] = len(posts)

    elif scraper == "edugeek":
        cats     = result.get("categories", {})
        filtered = {cat: [i for i in items if _keep(i, "created_at")] for cat, items in cats.items()}
        result["categories"]      = filtered
        result["total_items"]     = sum(len(v) for v in filtered.values())
        result["category_counts"] = {k: len(v) for k, v in filtered.items()}

    elif scraper == "stackexchange":
        qs = [q for q in result.get("questions", []) if _keep(q, "created_at")]
        result["questions"]       = qs
        result["total_questions"] = len(qs)

    elif scraper == "twitter":
        tweets = [t for t in result.get("tweets", [])
                  if _keep(t, "created_at", "date", "createdAt")]
        result["tweets"]       = tweets
        result["total_tweets"] = len(tweets)

    elif scraper == "google_news":
        articles = [a for a in result.get("articles", [])
                    if _keep(a, "publishedAt", "published_at", "date", "datePublished")]
        result["articles"]       = articles
        result["total_articles"] = len(articles)

    elif scraper == "spiceworks":
        posts = [p for p in result.get("posts", []) if _keep(p, "date")]
        result["posts"]       = posts
        result["total_items"] = len(posts)

    elif scraper == "facebook":
        posts = [p for p in result.get("posts", []) if _keep(p, "created_at")]
        result["posts"]       = posts
        result["total_posts"] = len(posts)

    elif scraper == "quora":
        def _q_keep(q):
            for a in q.get("answers", []):
                if _keep(a, "date"):
                    return True
            return False
        questions = [q for q in result.get("questions", []) if _q_keep(q)]
        result["questions"]    = questions
        result["total_items"]  = len(questions)

    logger.info("Date filter (%s, since=%s): applied", scraper, since_date)
    return result


# ── Task factory ──────────────────────────────────────────────────────────────

def _make_task(scraper: str, initial_status: str = "queued") -> str:
    tid = uuid.uuid4().hex
    now = datetime.now(tz=timezone.utc)
    state.task_registry[tid] = {
        "task_id":     tid,
        "scraper":     scraper,
        "status":      initial_status,
        "started_at":  now.isoformat(),
        "finished_at": None,
        "result":      None,
        "error":       None,
    }
    try:
        db = database.SessionLocal() if database.SessionLocal else None
        if db:
            from db_models import TaskHistory
            db.add(TaskHistory(
                task_id=tid, scraper=scraper, status=initial_status,
                started_at=now, finished_at=None, keyword=None, items_count=0, error=None,
            ))
            db.commit()
            db.close()
    except Exception as exc:
        logger.warning("Could not save task to DB: %s", exc)
    return tid


# ── Background task runner ────────────────────────────────────────────────────

def _run_scraper(task_id: str, scraper: str, cfg) -> None:
    state.task_registry[task_id]["status"]   = "running"
    state.scraper_status[scraper]["running"] = True

    spend_db = database.SessionLocal() if database.SessionLocal is not None else None

    # Per-tool budget block check
    if spend_db:
        try:
            from services.spending_service import get_scraper_budget_status, SCRAPER_TOOL
            tool = SCRAPER_TOOL.get(scraper, scraper)
            bs = get_scraper_budget_status(spend_db).get(tool, {})
            if bs.get("is_blocked"):
                reason = (
                    "No budget allocated — set a budget in Cost Governance"
                    if bs.get("no_budget") else
                    f"Budget limit reached ({bs.get('pct', 0):.1f}% of ${bs.get('budget_usd', 0):.2f})"
                )
                err_msg = f"Tool {tool} blocked: {reason}"
                logger.warning("Task %s (%s) blocked before start — %s", task_id[:8], scraper, reason)
                state.task_registry[task_id].update({
                    "status": "failed", "error": err_msg,
                    "finished_at": datetime.now(tz=timezone.utc).isoformat(),
                })
                state.scraper_status[scraper]["running"] = False
                try:
                    from db_models import TaskHistory
                    row = spend_db.query(TaskHistory).filter_by(task_id=task_id).first()
                    if row:
                        row.status      = "failed"
                        row.error       = err_msg[:500]
                        row.finished_at = datetime.now(tz=timezone.utc)
                        spend_db.commit()
                except Exception:
                    pass
                spend_db.close()
                return
        except Exception as exc:
            logger.warning("Budget block check failed for %s: %s", scraper, exc)

    try:
        mod = _get_scraper(scraper)

        if scraper == "twitter":
            result = mod.run_twitter(
                keywords=cfg.keywords, max_tweets=cfg.max_tweets,
                lang=getattr(cfg, "lang", "en"), task_id=task_id,
            )
        elif scraper == "instagram":
            result = mod.run_instagram(
                keywords=cfg.keywords, results_limit=cfg.results_limit, task_id=task_id,
            )
        elif scraper == "google_news":
            result = mod.run_google_news(
                keywords=cfg.keywords, max_results=cfg.max_results,
                task_id=task_id, db=spend_db,
            )
        else:
            result = mod.run(cfg)

        since_date = getattr(cfg, "since_date", None)
        if since_date:
            result = _filter_by_date(scraper, result, since_date)

        batch_id = getattr(cfg, "batch_id", None)

        _scraped_counts = {
            k: result[k]
            for k in ("total_posts", "total_questions", "total_tweets", "total_articles", "total_items")
            if k in result
        }
        if spend_db is not None and scraper != "google_news":
            from services.db_writer import save
            try:
                actual_saved = save(scraper, spend_db, result, task_id, since_date=since_date, batch_id=batch_id)
                result["items_saved_to_db"] = actual_saved
                logger.info("DB write complete for task %s (%s): %d saved (scraped: %s)",
                            task_id[:8], scraper, actual_saved, _scraped_counts)
            except Exception as exc:
                logger.error("DB write error for %s: %s", scraper, exc)
                spend_db.rollback()

        if spend_db is not None:
            try:
                from services.spending_service import (
                    record_apify_spend,
                    record_reddit_spend, record_autodesk_spend,
                    record_scrapecreators_spend, record_scrapingbee_spend,
                )
                keyword = getattr(cfg, "keyword", "") or ""
                if not keyword and hasattr(cfg, "keywords"):
                    keyword = (cfg.keywords or [""])[0]

                if scraper == "google_news":
                    from services.spending_service import record_scrappa_spend
                    scrappa_stats = result.get("_scrappa_run_stats") or {}
                    record_scrappa_spend(
                        db=spend_db,
                        requests_made=scrappa_stats.get("requests_made", 0),
                        articles_found=scrappa_stats.get("articles_found", result.get("total_articles", 0)),
                        keyword=keyword, task_id=task_id,
                    )
                elif scraper == "twitter":
                    from services.spending_service import record_getxapi_spend
                    gx_stats = result.get("_getxapi_run_stats") or {}
                    record_getxapi_spend(
                        db=spend_db,
                        calls_made=gx_stats.get("calls_made", 0),
                        tweets_collected=gx_stats.get("tweets_collected", result.get("total_tweets", 0)),
                        keyword=keyword, task_id=task_id,
                    )
                elif scraper == "instagram":
                    apify_stats = result.get("_apify_run_stats") or {}
                    run_meta = {
                        "usageTotalUsd": apify_stats.get("usageTotalUsd", 0),
                        "stats": {"computeUnits": apify_stats.get("computeUnits", 0)},
                    }
                    record_apify_spend(
                        db=spend_db, scraper="instagram",
                        service_label="Apify (Instagram)", operation="instagram_scrape",
                        run_result=run_meta,
                        items_count=apify_stats.get("items_count", result.get("total_posts", 0)),
                        keyword=keyword, task_id=task_id,
                    )
                elif scraper == "reddit":
                    record_reddit_spend(spend_db,
                                        items_count=_scraped_counts.get("total_posts", 0),
                                        keyword=keyword, task_id=task_id)
                elif scraper == "autodesk":
                    record_autodesk_spend(spend_db,
                                          items_count=_scraped_counts.get("total_posts", 0),
                                          keyword=keyword, task_id=task_id)
                elif scraper == "tiktok":
                    record_scrapecreators_spend(spend_db,
                                               items_count=_scraped_counts.get("total_posts", 0),
                                               keyword=keyword, task_id=task_id)
                elif scraper == "edugeek":
                    items = _scraped_counts.get("total_items", 0)
                    record_scrapingbee_spend(spend_db, pages_fetched=max(items * 2, 1),
                                            keyword=keyword, task_id=task_id)
                elif scraper == "spiceworks":
                    from services.spending_service import record_spiceworks_spend
                    record_spiceworks_spend(spend_db,
                                            items_count=_scraped_counts.get("total_items", 0),
                                            keyword=keyword, task_id=task_id)
                elif scraper == "quora":
                    from services.spending_service import record_quora_spend
                    record_quora_spend(spend_db,
                                       items_count=_scraped_counts.get("total_items", 0),
                                       keyword=keyword, task_id=task_id)
                elif scraper == "facebook":
                    from services.spending_service import record_facebook_spend
                    record_facebook_spend(spend_db,
                                          items_count=result.get("_api_fetched_count")
                                                      or _scraped_counts.get("total_posts", 0),
                                          keyword=keyword, task_id=task_id)
            except Exception as exc:
                logger.warning("Spend recording failed for %s: %s", scraper, exc)

        finished_at = datetime.now(tz=timezone.utc)
        keyword = getattr(cfg, "keyword", "") or ""
        if not keyword and hasattr(cfg, "keywords"):
            keyword = (getattr(cfg, "keywords", None) or [""])[0]
        items = result.get("items_saved_to_db") or (
            _scraped_counts.get("total_posts") or _scraped_counts.get("total_tweets") or
            _scraped_counts.get("total_articles") or _scraped_counts.get("total_questions") or
            _scraped_counts.get("total_items") or 0
        )

        final_status = "completed"

        state.task_registry[task_id].update({
            "status":      final_status,
            "finished_at": finished_at.isoformat(),
            "result":      result,
        })
        try:
            if spend_db:
                from db_models import TaskHistory
                row = spend_db.query(TaskHistory).filter_by(task_id=task_id).first()
                if row:
                    row.status      = final_status
                    row.finished_at = finished_at
                    row.keyword     = keyword[:255] if keyword else None
                    row.items_count = items
                    spend_db.commit()
        except Exception as exc:
            logger.warning("Could not update task in DB: %s", exc)

        state.scraper_status[scraper].update({
            "last_run":         datetime.now(tz=timezone.utc).isoformat(),
            "last_file":        result.get("file"),
            "total_runs":       state.scraper_status[scraper]["total_runs"] + 1,
            "last_total_items": items,
        })
        if scraper == "google_news":
            state.scraper_status[scraper]["last_newsletters_created"] = result.get("newsletters_created", 0)
        logger.info("Task %s (%s) completed", task_id[:8], scraper)

    except Exception as exc:
        logger.exception("Task %s (%s) FAILED: %s", task_id[:8], scraper, exc)
        failed_at = datetime.now(tz=timezone.utc)
        state.task_registry[task_id].update({
            "status":      "failed",
            "finished_at": failed_at.isoformat(),
            "error":       str(exc),
        })
        try:
            if spend_db:
                from db_models import TaskHistory
                row = spend_db.query(TaskHistory).filter_by(task_id=task_id).first()
                if row:
                    row.status      = "failed"
                    row.finished_at = failed_at
                    row.error       = str(exc)[:500]
                    spend_db.commit()
        except Exception as exc2:
            logger.warning("Could not update failed task in DB: %s", exc2)
    finally:
        state.scraper_status[scraper]["running"] = False
        if spend_db is not None:
            try:
                spend_db.close()
            except Exception:
                pass


# ══════════════════════════════════════════════════════════════════════════════
#  Auto-scheduler Smart Brain coordinator
# ══════════════════════════════════════════════════════════════════════════════

def _run_all_auto_scrape(task_ids: list[str], batch_id: str) -> None:
    """
    Background coordinator:
      1. Waits for all scraper tasks to finish (polls every 10s, max 45 min)
      2. Loads all scraped records for this batch from DB
      3. Fetches the most recently saved Smart Brain prompt
      4. Runs LLM analysis and saves result to smart_brain_analyses
    """
    import time
    import database as _db
    from core.container import state as _state

    logger.info("Auto-scheduler coordinator started — batch %s, %d tasks", batch_id[:8], len(task_ids))

    # ── Poll until all tasks done (or timeout) ────────────────────────────────
    deadline = time.time() + 45 * 60  # 45 minutes
    while time.time() < deadline:
        statuses = [
            _state.task_registry.get(tid, {}).get("status", "unknown")
            for tid in task_ids
        ]
        pending = [s for s in statuses if s not in ("completed", "failed")]
        if not pending:
            break
        logger.debug("Auto-scheduler batch %s — %d tasks still running", batch_id[:8], len(pending))
        time.sleep(10)
    else:
        logger.warning("Auto-scheduler batch %s timed out after 45 min — running Smart Brain on available data", batch_id[:8])

    # ── Collect scraped records for this batch ────────────────────────────────
    db = _db.SessionLocal() if _db.SessionLocal else None
    if db is None:
        logger.error("Auto-scheduler: no DB session available, aborting Smart Brain step")
        return

    try:
        from db_models import ScrapeRun, SavedPrompt
        from api.routers.smart_brain import _smart_brain_records_for_runs

        runs = db.query(ScrapeRun).filter(ScrapeRun.batch_id == batch_id).all()
        if not runs:
            logger.warning("Auto-scheduler batch %s: no ScrapeRun rows found — skipping Smart Brain", batch_id[:8])
            return

        data_rows = _smart_brain_records_for_runs(db, runs, max_per_run=50)
        if not data_rows:
            logger.warning("Auto-scheduler batch %s: no records found for Smart Brain", batch_id[:8])
            return

        # ── Fetch most recently saved prompt ──────────────────────────────────
        prompt_row = db.query(SavedPrompt).order_by(SavedPrompt.created_at.desc()).first()
        if not prompt_row:
            logger.warning("Auto-scheduler batch %s: no saved prompt found — skipping Smart Brain", batch_id[:8])
            return

        logger.info(
            "Auto-scheduler batch %s: running Smart Brain on %d records with prompt id=%d",
            batch_id[:8], len(data_rows), prompt_row.id,
        )

        # ── Run LLM analysis ──────────────────────────────────────────────────
        from llm_service import feed_to_llm
        try:
            result = feed_to_llm(db, prompt_row.text, data_rows, keyword=f"Scheduled Batch {batch_id[:8]}")
        except RuntimeError as exc:
            logger.error("Auto-scheduler Smart Brain LLM call failed: %s", exc)
            return

        # ── Save to smart_brain_analyses ──────────────────────────────────────
        from db_models import SmartBrainAnalysis
        entry = SmartBrainAnalysis(
            result          = result["response"],
            provider        = result["provider"],
            model           = result["model"],
            tokens_used     = result.get("tokens_used", 0),
            cost_usd        = result.get("cost_usd", 0.0),
            enhanced_prompt = "",
            prompt_used     = prompt_row.text,
            record_count    = len(data_rows),
        )
        db.add(entry)
        db.commit()
        logger.info(
            "Auto-scheduler batch %s: Smart Brain analysis saved (id=%d, %d tokens, %d records)",
            batch_id[:8], entry.id, entry.tokens_used, len(data_rows),
        )

    except Exception as exc:
        logger.exception("Auto-scheduler coordinator failed for batch %s: %s", batch_id[:8], exc)
    finally:
        try:
            db.close()
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════════════════
#  Run endpoints
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/api/run", response_model=RunResponse,
             summary="Run any combination of scrapers in one request")
def run_all(body: RunRequest, background_tasks: BackgroundTasks):
    task_ids: List[str] = []
    for name, cfg in [
        ("reddit",        body.reddit),
        ("edugeek",       body.edugeek),
        ("stackexchange", body.stackexchange),
        ("autodesk",      body.autodesk),
        ("twitter",       body.twitter),
        ("google_news",   body.google_news),
        ("spiceworks",    body.spiceworks),
        ("quora",         body.quora),
    ]:
        if cfg is not None:
            tid = _make_task(name)
            background_tasks.add_task(_run_scraper, tid, name, cfg)
            task_ids.append(tid)
    if not task_ids:
        raise HTTPException(400, "No scraper config provided.")
    return RunResponse(message=f"{len(task_ids)} scraper(s) queued.", task_ids=task_ids)


@router.post("/api/run/reddit")
def run_reddit(cfg: RedditConfig, background_tasks: BackgroundTasks):
    tid = _make_task("reddit")
    background_tasks.add_task(_run_scraper, tid, "reddit", cfg)
    return {"message": "Reddit scraper queued.", "task_id": tid}


@router.post("/api/run/tiktok")
def run_tiktok(cfg: TikTokConfig, background_tasks: BackgroundTasks):
    tid = _make_task("tiktok")
    background_tasks.add_task(_run_scraper, tid, "tiktok", cfg)
    return {"message": "TikTok scraper queued.", "task_id": tid}


@router.post("/api/run/edugeek")
def run_edugeek(cfg: EduGeekConfig, background_tasks: BackgroundTasks):
    tid = _make_task("edugeek")
    background_tasks.add_task(_run_scraper, tid, "edugeek", cfg)
    return {"message": "EduGeek scraper queued.", "task_id": tid}


@router.post("/api/run/stackexchange")
def run_stackexchange(cfg: StackExchangeConfig, background_tasks: BackgroundTasks):
    tid = _make_task("stackexchange")
    background_tasks.add_task(_run_scraper, tid, "stackexchange", cfg)
    return {"message": "StackExchange scraper queued.", "task_id": tid}


@router.post("/api/run/autodesk")
def run_autodesk(cfg: AutodeskConfig, background_tasks: BackgroundTasks):
    tid = _make_task("autodesk")
    background_tasks.add_task(_run_scraper, tid, "autodesk", cfg)
    return {"message": "Autodesk Community scraper queued.", "task_id": tid}


@router.post("/api/run/twitter")
def run_twitter(cfg: TwitterConfig, background_tasks: BackgroundTasks):
    tid = _make_task("twitter")
    background_tasks.add_task(_run_scraper, tid, "twitter", cfg)
    return {"message": "Twitter scraper queued.", "task_id": tid}


@router.post("/api/run/instagram")
def run_instagram(cfg: InstagramConfig, background_tasks: BackgroundTasks):
    tid = _make_task("instagram")
    background_tasks.add_task(_run_scraper, tid, "instagram", cfg)
    return {"message": "Instagram scraper queued.", "task_id": tid}


@router.post("/api/run/google-news")
def run_google_news(cfg: GoogleNewsConfig, background_tasks: BackgroundTasks):
    tid = _make_task("google_news")
    background_tasks.add_task(_run_scraper, tid, "google_news", cfg)
    return {"message": "Google News scraper queued.", "task_id": tid}


@router.post("/api/run/spiceworks")
def run_spiceworks(cfg: SpiceworksConfig, background_tasks: BackgroundTasks):
    tid = _make_task("spiceworks")
    background_tasks.add_task(_run_scraper, tid, "spiceworks", cfg)
    return {"message": "Spiceworks scraper queued.", "task_id": tid}


@router.post("/api/run/quora")
def run_quora(cfg: QuoraConfig, background_tasks: BackgroundTasks):
    tid = _make_task("quora")
    background_tasks.add_task(_run_scraper, tid, "quora", cfg)
    return {"message": "Quora scraper queued.", "task_id": tid}


@router.post("/api/run/facebook")
def run_facebook(cfg: FacebookConfig, background_tasks: BackgroundTasks):
    tid = _make_task("facebook")
    background_tasks.add_task(_run_scraper, tid, "facebook", cfg)
    return {"message": "Facebook Groups scraper queued.", "task_id": tid}


# ══════════════════════════════════════════════════════════════════════════════
#  Unified auto-scrape webhook (for MS Power Automate)
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/api/webhook/scrapers/auto-scrape", tags=["Webhooks"])
async def auto_scrape_all(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Parameterless automated webhook for scheduled scraping (Power Automate, Cron, etc.).

    Operates completely bodyless and parameterless:
    1. Resolves 'since_date' exclusively from 'last_auto_scrape_timestamp' in the database.
    2. Automatically updates 'last_auto_scrape_timestamp' to the current execution time.
    3. Runs all 8 scrapers across dedicated Auto Keywords and Auto Facebook Groups.
    4. Automatically triggers Smart Brain analysis on the newly collected batch.
    """
    now = datetime.now(timezone.utc)
    from db_models import ScraperKeyword, ScraperKeywordSelection, FacebookGroup, UserPreferences

    # ── Resolve since_date exclusively from DB last_auto_scrape_timestamp ─────
    last_pref = db.query(UserPreferences).filter_by(key="last_auto_scrape_timestamp").first()
    if last_pref and last_pref.value:
        try:
            last_dt = datetime.fromisoformat(last_pref.value)
            since_date = last_dt.strftime("%Y-%m-%d")
            logger.info("Auto-scrape: dynamic gap resolved from database last run timestamp: %s (since_date=%s)", last_pref.value, since_date)
        except Exception:
            since_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
            logger.info("Auto-scrape: fallback since_date applied: %s", since_date)
    else:
        since_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        logger.info("Auto-scrape: initial run detected — defaulting since_date to: %s", since_date)

    # ── Update last_auto_scrape_timestamp in DB for subsequent runs ────────────
    try:
        if not last_pref:
            last_pref = UserPreferences(key="last_auto_scrape_timestamp", value=now.isoformat())
            db.add(last_pref)
        else:
            last_pref.value = now.isoformat()
        db.commit()
        logger.info("Auto-scrape: updated last_auto_scrape_timestamp in DB to %s", now.isoformat())
    except Exception as exc:
        logger.warning("Could not update last_auto_scrape_timestamp in DB: %s", exc)

    max_items = 50

    # ── Scrapers to run (Google News excluded — has its own webhook) ──────────
    SCRAPERS = ["reddit", "edugeek", "facebook", "quora",
                "spiceworks", "stackexchange", "autodesk", "twitter"]

    # ── Fetch keywords for auto-scrape ─────────────────────────────────────────
    # If dedicated 'auto' pool keywords exist (up to 8), use them exclusively across all scrapers.
    # Otherwise fallback to per-scraper selections.
    auto_kw_rows = (
        db.query(ScraperKeyword)
        .filter(ScraperKeyword.pool == "auto")
        .order_by(ScraperKeyword.created_at)
        .all()
    )
    auto_keywords = [r.keyword for r in auto_kw_rows if r.keyword.strip()]

    if auto_keywords:
        kw_map: dict[str, list[str]] = {s: list(auto_keywords) for s in SCRAPERS}
        logger.info("Auto-scrape webhook: using %d dedicated Auto Keywords: %s", len(auto_keywords), auto_keywords)
    else:
        selections = (
            db.query(ScraperKeywordSelection, ScraperKeyword)
            .join(ScraperKeyword, ScraperKeywordSelection.keyword_id == ScraperKeyword.id)
            .filter(ScraperKeywordSelection.scraper.in_(SCRAPERS))
            .all()
        )
        kw_map: dict[str, list[str]] = {s: [] for s in SCRAPERS}
        for sel, kw in selections:
            kw_map[sel.scraper].append(kw.keyword)

    # ── Facebook: resolve selected groups ─────────────────────────────────────
    fb_groups: list[str] = []
    if kw_map.get("facebook"):
        # First check dedicated Auto Facebook Groups
        auto_group_rows = (
            db.query(FacebookGroup)
            .filter(FacebookGroup.is_auto == True)
            .order_by(FacebookGroup.created_at)
            .all()
        )
        fb_groups = [g.url for g in auto_group_rows if g.url]

        # Fallback to manual selected groups if no auto groups exist
        if not fb_groups:
            pref_row = (
                db.query(UserPreferences)
                .filter_by(key="fb_selected_groups")
                .first()
            )
            if pref_row and pref_row.value:
                try:
                    selected_ids = set(_json.loads(pref_row.value))
                except Exception:
                    selected_ids = set()
                group_rows = (
                    db.query(FacebookGroup)
                    .filter(FacebookGroup.id.in_(selected_ids))
                    .all()
                )
                fb_groups = [g.url for g in group_rows if g.url]

        if fb_groups:
            logger.info("Auto-scrape webhook: using %d Facebook groups for auto scraping", len(fb_groups))
        else:
            logger.info("Auto-scrape: no Facebook groups configured — skipping Facebook")
            kw_map["facebook"] = []

    # ── Generate batch_id shared across all tasks ─────────────────────────────
    batch_id = uuid.uuid4().hex
    all_task_ids: list[str] = []

    # ── Build and fire tasks ──────────────────────────────────────────────────
    from api.schemas.scrapers import (
        RedditConfig, EduGeekConfig, FacebookConfig, QuoraConfig,
        SpiceworksConfig, StackExchangeConfig, AutodeskConfig, TwitterConfig,
    )

    for scraper in SCRAPERS:
        keywords = kw_map.get(scraper, [])
        if not keywords:
            continue

        for keyword in keywords:
            if scraper == "facebook":
                for group_url in fb_groups:
                    cfg = FacebookConfig(
                        keyword=keyword, group_url=group_url,
                        max_posts=max_items, since_date=since_date, batch_id=batch_id,
                    )
                    tid = _make_task(scraper)
                    background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                    all_task_ids.append(tid)

            elif scraper == "reddit":
                cfg = RedditConfig(
                    keyword=keyword, max_posts=max_items,
                    max_comments=max_items * 2, since_date=since_date, batch_id=batch_id,
                )
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

            elif scraper == "edugeek":
                cfg = EduGeekConfig(
                    keyword=keyword, max_items=max_items,
                    max_replies=max_items * 2, since_date=since_date, batch_id=batch_id,
                )
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

            elif scraper == "quora":
                # Quora has no date filter
                cfg = QuoraConfig(keyword=keyword, max_results=max_items, batch_id=batch_id)
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

            elif scraper == "spiceworks":
                cfg = SpiceworksConfig(
                    keyword=keyword, max_results=max_items,
                    since_date=since_date, batch_id=batch_id,
                )
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

            elif scraper == "stackexchange":
                cfg = StackExchangeConfig(
                    keyword=keyword, max_per_site=max_items,
                    max_answers=max_items * 2, since_date=since_date, batch_id=batch_id,
                )
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

            elif scraper == "autodesk":
                cfg = AutodeskConfig(
                    keyword=keyword, max_posts=max_items,
                    max_replies=max_items * 2, since_date=since_date, batch_id=batch_id,
                )
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

            elif scraper == "twitter":
                cfg = TwitterConfig(
                    keywords=[keyword], max_tweets=max_items,
                    since_date=since_date, batch_id=batch_id,
                )
                tid = _make_task(scraper)
                background_tasks.add_task(_run_scraper, tid, scraper, cfg)
                all_task_ids.append(tid)

    if not all_task_ids:
        raise HTTPException(400, "No keywords selected for any scraper. Please select keywords on the Scraping page first.")

    # ── Launch Smart Brain coordinator ────────────────────────────────────────
    background_tasks.add_task(_run_all_auto_scrape, all_task_ids, batch_id)

    scrapers_active = len({
        scraper for scraper in SCRAPERS if kw_map.get(scraper)
    })

    return {
        "status":          "started",
        "batch_id":        batch_id,
        "scrapers_queued": scrapers_active,
        "task_count":      len(all_task_ids),
        "since_date":      since_date,
        "task_ids":        all_task_ids,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Tasks
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/tasks", tags=["Tasks"])
def list_tasks():
    tasks = list(state.task_registry.values())
    try:
        db = database.SessionLocal() if database.SessionLocal else None
        if db:
            from db_models import TaskHistory
            rows = db.query(TaskHistory).order_by(TaskHistory.started_at.desc()).limit(50).all()
            db.close()
            live_ids = {t["task_id"] for t in tasks}
            for row in rows:
                if row.task_id not in live_ids:
                    tasks.append({
                        "task_id":     row.task_id,
                        "scraper":     row.scraper,
                        "status":      row.status,
                        "started_at":  row.started_at.isoformat()  if row.started_at  else None,
                        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
                        "result": {
                            "keywords":    [row.keyword] if row.keyword else [],
                            "total_items": row.items_count or 0,
                        },
                        "error": row.error,
                    })
    except Exception as exc:
        logger.warning("Could not load task history from DB: %s", exc)
    return {
        "total":     len(tasks),
        "queued":    sum(1 for t in tasks if t["status"] == "queued"),
        "running":   sum(1 for t in tasks if t["status"] == "running"),
        "pending_approval": sum(1 for t in tasks if t["status"] == "pending_approval"),
        "completed": sum(1 for t in tasks if t["status"] == "completed"),
        "failed":    sum(1 for t in tasks if t["status"] == "failed"),
        "tasks":     tasks,
    }


@router.get("/api/tasks/{task_id}", tags=["Tasks"])
def get_task(task_id: str = FPath(...)):
    task = state.task_registry.get(task_id)
    if not task:
        raise HTTPException(404, f"Task '{task_id}' not found.")
    return task


@router.delete("/api/tasks/{task_id}", tags=["Tasks"])
def delete_task(task_id: str = FPath(...)):
    if task_id not in state.task_registry:
        raise HTTPException(404, f"Task '{task_id}' not found.")
    if state.task_registry[task_id]["status"] == "running":
        raise HTTPException(409, "Cannot delete a running task.")
    del state.task_registry[task_id]
    return {"message": f"Task {task_id} deleted."}


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/api/status", tags=["Status"])
def get_status():
    return state.scraper_status


@router.get("/api/scraper-latest-batch-status", tags=["Status"])
def get_latest_batch_status(db: Session = Depends(get_db)):
    """Return per-scraper latest batch total items from DB."""
    from db_models import ScrapeRun
    from sqlalchemy import func as _func, literal

    result = {}
    scrapers = ["reddit", "tiktok", "edugeek", "stackexchange", "autodesk",
                "twitter", "instagram", "google_news", "spiceworks", "quora", "facebook"]

    for scraper in scrapers:
        # Find the latest batch_id for this scraper
        latest_batch_subq = (
            db.query(ScrapeRun.batch_id)
            .filter(ScrapeRun.scraper == scraper, ScrapeRun.batch_id.isnot(None))
            .order_by(ScrapeRun.scraped_at.desc())
            .limit(1)
            .subquery()
        )

        row = db.query(
            _func.sum(ScrapeRun.total_items).label("total_items"),
            _func.max(ScrapeRun.scraped_at).label("last_run"),
        ).filter(
            ScrapeRun.scraper == scraper,
            ScrapeRun.batch_id == db.query(latest_batch_subq.c.batch_id).scalar_subquery(),
        ).first()

        if row and row.total_items is not None:
            result[scraper] = {
                "last_total_items": int(row.total_items),
                "last_run": row.last_run.isoformat() if row.last_run else None,
            }
        else:
            # Fallback: get the most recent single run
            latest = (
                db.query(ScrapeRun)
                .filter(ScrapeRun.scraper == scraper)
                .order_by(ScrapeRun.scraped_at.desc())
                .first()
            )
            if latest:
                result[scraper] = {
                    "last_total_items": latest.total_items or 0,
                    "last_run": latest.scraped_at.isoformat() if latest.scraped_at else None,
                }
            else:
                result[scraper] = {
                    "last_total_items": 0,
                    "last_run": None,
                }

        # Check TaskHistory if it has a more recent execution timestamp
        from db_models import TaskHistory
        last_task = (
            db.query(TaskHistory)
            .filter(TaskHistory.scraper == scraper)
            .order_by(TaskHistory.started_at.desc())
            .first()
        )
        if last_task and (last_task.finished_at or last_task.started_at):
            task_time = last_task.finished_at or last_task.started_at
            current_run_iso = result[scraper].get("last_run")
            if not current_run_iso:
                result[scraper]["last_run"] = task_time.isoformat()
                result[scraper]["last_total_items"] = last_task.items_count or 0
            else:
                try:
                    current_dt = datetime.fromisoformat(current_run_iso)
                    if task_time.tzinfo is None:
                        task_time = task_time.replace(tzinfo=timezone.utc)
                    if current_dt.tzinfo is None:
                        current_dt = current_dt.replace(tzinfo=timezone.utc)
                    if task_time > current_dt:
                        result[scraper]["last_run"] = task_time.isoformat()
                        result[scraper]["last_total_items"] = last_task.items_count or 0
                except Exception:
                    pass

    return result

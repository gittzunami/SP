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
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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

    logger.info("Date filter (%s, since=%s): applied", scraper, since_date)
    return result


# ── Task factory ──────────────────────────────────────────────────────────────

def _make_task(scraper: str) -> str:
    tid = uuid.uuid4().hex
    now = datetime.now(tz=timezone.utc)
    state.task_registry[tid] = {
        "task_id":     tid,
        "scraper":     scraper,
        "status":      "queued",
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
                task_id=tid, scraper=scraper, status="queued",
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

    # Per-scraper budget block check
    if spend_db:
        try:
            from services.spending_service import get_scraper_budget_status
            bs = get_scraper_budget_status(spend_db).get(scraper, {})
            if bs.get("is_blocked"):
                reason = (
                    "No budget allocated — set a budget in Cost Governance"
                    if bs.get("no_budget") else
                    f"Budget limit reached ({bs.get('pct', 0):.1f}% of ${bs.get('budget_usd', 0):.2f})"
                )
                err_msg = f"Scraper blocked: {reason}"
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

        _scraped_counts = {
            k: result[k]
            for k in ("total_posts", "total_questions", "total_tweets", "total_articles", "total_items")
            if k in result
        }
        if spend_db is not None and scraper != "google_news":
            from services.db_writer import save
            try:
                actual_saved = save(scraper, spend_db, result, task_id, since_date=since_date)
                for _key in ("total_posts", "total_questions", "total_tweets", "total_articles", "total_items"):
                    if _key in result:
                        result[_key] = actual_saved
                        break
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
        items = (
            result.get("total_posts") or result.get("total_tweets") or
            result.get("total_articles") or result.get("total_questions") or
            result.get("total_items") or 0
        )
        state.task_registry[task_id].update({
            "status":      "completed",
            "finished_at": finished_at.isoformat(),
            "result":      result,
        })
        try:
            if spend_db:
                from db_models import TaskHistory
                row = spend_db.query(TaskHistory).filter_by(task_id=task_id).first()
                if row:
                    row.status      = "completed"
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

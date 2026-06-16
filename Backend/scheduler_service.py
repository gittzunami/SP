"""
scheduler_service.py
Wraps APScheduler to manage recurring scraper jobs.

FIX: APScheduler Job objects do NOT support arbitrary attribute assignment
     (job.meta = ... raises AttributeError). Metadata is stored in a
     plain module-level dict  _job_meta  keyed by job_id instead.
"""

from __future__ import annotations

import uuid, logging
from typing import Any, Callable, Dict, List, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from models import SCHEDULE_SECONDS

logger     = logging.getLogger("scheduler")
_scheduler: Optional[BackgroundScheduler] = None

# Stores extra metadata for each job that APScheduler can't hold itself.
# key = job_id  →  {"scraper": str, "schedule": str, "config": dict}
_job_meta: Dict[str, Dict[str, Any]] = {}


# ── Scheduler lifecycle ───────────────────────────────────────────────────────

def get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone="UTC")
        _scheduler.start()
        logger.info("APScheduler started")
    return _scheduler


def shutdown() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler shut down")
    _scheduler = None


# ── Job management ────────────────────────────────────────────────────────────

def add_job(
    scraper_name:  str,
    interval_name: str,
    fn:            Callable,
    cfg_dict:      Dict[str, Any],
    fn_kwargs:     Dict[str, Any],
) -> str:
    """Register a recurring interval job and return its job_id."""
    if interval_name not in SCHEDULE_SECONDS:
        raise ValueError(f"Unknown schedule interval: {interval_name!r}")

    seconds   = SCHEDULE_SECONDS[interval_name]
    job_id    = f"{scraper_name}_{uuid.uuid4().hex[:8]}"
    scheduler = get_scheduler()

    scheduler.add_job(
        func               = fn,
        trigger            = IntervalTrigger(seconds=seconds),
        id                 = job_id,
        name               = f"{scraper_name} — {interval_name}",
        kwargs             = fn_kwargs,
        replace_existing   = True,
        misfire_grace_time = 300,
    )

    # Store metadata separately — APScheduler Job objects are read-only
    _job_meta[job_id] = {
        "scraper":  scraper_name,
        "schedule": interval_name,
        "config":   cfg_dict,
    }

    logger.info("Job registered: %s — every %s (%d s)", job_id, interval_name, seconds)
    return job_id


def remove_job(job_id: str) -> bool:
    try:
        get_scheduler().remove_job(job_id)
        _job_meta.pop(job_id, None)
        logger.info("Job removed: %s", job_id)
        return True
    except Exception:
        return False


def pause_job(job_id: str) -> bool:
    try:
        get_scheduler().pause_job(job_id)
        return True
    except Exception:
        return False


def resume_job(job_id: str) -> bool:
    try:
        get_scheduler().resume_job(job_id)
        return True
    except Exception:
        return False


def list_jobs() -> List[Dict[str, Any]]:
    result = []
    for job in get_scheduler().get_jobs():
        meta = _job_meta.get(job.id, {})
        result.append({
            "job_id":   job.id,
            "scraper":  meta.get("scraper",  job.name),
            "schedule": meta.get("schedule", "unknown"),
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            "config":   meta.get("config",   {}),
        })
    return result
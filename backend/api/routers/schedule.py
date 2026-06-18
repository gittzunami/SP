"""api/routers/schedule.py — APScheduler job management endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from fastapi import Path as FPath

import scheduler_service as sched
from api.schemas.scrapers import ScheduleRequest

logger = logging.getLogger("schedule")
router = APIRouter(prefix="/api/schedule", tags=["Schedule"])


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


@router.post("")
def create_schedule(body: ScheduleRequest):
    created: List[Dict[str, Any]] = []

    def _register(name, cfg):
        if cfg is None:
            return
        if cfg.schedule == "manual":
            raise HTTPException(400, "Use /api/run for manual runs.")
        mod    = _get_scraper(name)
        job_id = sched.add_job(
            scraper_name=name, interval_name=cfg.schedule,
            fn=mod.run, cfg_dict=cfg.model_dump(), fn_kwargs={"cfg": cfg},
        )
        created.append({"scraper": name, "job_id": job_id, "schedule": cfg.schedule})

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
        _register(name, cfg)

    if not created:
        raise HTTPException(400, "No scraper config provided.")
    return {"message": f"{len(created)} schedule(s) registered.", "jobs": created}


@router.get("")
def list_schedules():
    return {"jobs": sched.list_jobs()}


@router.delete("/{job_id}")
def delete_schedule(job_id: str = FPath(...)):
    if not sched.remove_job(job_id):
        raise HTTPException(404, f"Job '{job_id}' not found.")
    return {"message": f"Job {job_id} removed."}


@router.patch("/{job_id}/pause")
def pause_schedule(job_id: str = FPath(...)):
    if not sched.pause_job(job_id):
        raise HTTPException(404, f"Job '{job_id}' not found.")
    return {"message": f"Job {job_id} paused."}


@router.patch("/{job_id}/resume")
def resume_schedule(job_id: str = FPath(...)):
    if not sched.resume_job(job_id):
        raise HTTPException(404, f"Job '{job_id}' not found.")
    return {"message": f"Job {job_id} resumed."}

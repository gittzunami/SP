"""api/routers/health.py — Health check endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter
import database

router = APIRouter(tags=["Health"])


@router.get("/")
def root():
    return {
        "status":     "ok",
        "version":    "4.2.0",
        "scrapers":   sorted([
            "reddit", "tiktok", "edugeek", "stackexchange", "autodesk",
            "twitter", "instagram", "google_news", "spiceworks", "quora", "facebook",
        ]),
        "db_enabled": database.SessionLocal is not None,
        "docs":       "/docs",
    }


@router.get("/api/health")
def health():
    return {
        "status":     "ok",
        "time":       datetime.now(tz=timezone.utc).isoformat(),
        "db_enabled": database.SessionLocal is not None,
    }

"""
api/app.py
==========
FastAPI application factory.

Responsibilities:
  - Create and configure the FastAPI instance
  - Register CORS, JWT middleware, and exception handlers
  - Include all domain routers
  - Define the lifespan (startup/shutdown: DB init, scheduler, state restore)

Entry point: `uvicorn api.app:app --reload --port 8000`
             or the slim main.py shim at the project root.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import database
import scheduler_service as sched
from api.middleware.auth import jwt_middleware
from core.logging import setup_logging
from api.routers import (
    auth, health, keywords, llm, newsletter,
    results, schedule, scrapers, search, smart_brain, spending, stats,
)
from core.container import state

logger = logging.getLogger("app")


# ══════════════════════════════════════════════════════════════════════════════
#  Lifespan — startup / shutdown
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    database.init_db()
    sched.get_scheduler()

    # Restore scraper last_run from DB so cards show correct state after restart
    if database.SessionLocal is not None:
        try:
            db = database.SessionLocal()
            from db_models import ScrapeRun
            from sqlalchemy import func as _func

            subq = (
                db.query(
                    ScrapeRun.scraper,
                    _func.max(ScrapeRun.scraped_at).label("max_at"),
                )
                .group_by(ScrapeRun.scraper)
                .subquery()
            )
            rows = (
                db.query(ScrapeRun)
                .join(subq,
                      (ScrapeRun.scraper == subq.c.scraper) &
                      (ScrapeRun.scraped_at == subq.c.max_at))
                .all()
            )
            for row in rows:
                if row.scraper in state.scraper_status and row.scraped_at:
                    state.scraper_status[row.scraper]["last_run"]         = row.scraped_at.isoformat()
                    state.scraper_status[row.scraper]["last_total_items"] = row.total_items or 0

            # Restore last_newsletters_created for Google News from most recent completed job
            try:
                from db_models import NewsletterJob, GeneratedNewsletter
                last_job = (
                    db.query(NewsletterJob)
                    .filter(NewsletterJob.status == "completed")
                    .order_by(NewsletterJob.created_at.desc())
                    .first()
                )
                if last_job:
                    nl_count = db.query(GeneratedNewsletter).filter_by(job_id=last_job.job_id).count()
                    state.scraper_status["google_news"]["last_newsletters_created"] = nl_count
                    logger.info("Restored google_news last_newsletters_created=%d (job %s)", nl_count, last_job.job_id[:8])
            except Exception as exc:
                logger.warning("Could not restore last_newsletters_created: %s", exc)

            db.close()
            logger.info("Restored scraper_status from DB (%d scrapers)", len(rows))
        except Exception as exc:
            logger.warning("Could not restore scraper_status from DB: %s", exc)

    # One-time cleanup: normalise existing keywords to lowercase
    if database.SessionLocal is not None:
        try:
            db = database.SessionLocal()
            from db_models import ScrapeRun
            from sqlalchemy import update, func as _sfunc
            db.execute(
                update(ScrapeRun)
                .where(ScrapeRun.keyword.isnot(None), ScrapeRun.keyword != "")
                .values(keyword=_sfunc.lower(ScrapeRun.keyword))
            )
            db.commit()
            db.close()
        except Exception as exc:
            logger.warning("Keyword lowercase cleanup failed: %s", exc)

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    sched.shutdown()


# ══════════════════════════════════════════════════════════════════════════════
#  App factory
# ══════════════════════════════════════════════════════════════════════════════

def create_app() -> FastAPI:
    setup_logging()

    application = FastAPI(
        title    = "TrendSense Scraper API",
        version  = "4.2.0",
        lifespan = lifespan,
    )

    # CORS
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

    # JWT middleware
    application.middleware("http")(jwt_middleware)

    # Validation error handler
    @application.exception_handler(RequestValidationError)
    async def _validation_error_handler(request: Request, exc: RequestValidationError):
        logger.error(
            "422 Validation error on %s %s — %s",
            request.method, request.url.path, exc.errors(),
        )
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    # Routers
    application.include_router(health.router)
    application.include_router(auth.router)
    application.include_router(scrapers.router)
    application.include_router(schedule.router)
    application.include_router(spending.router)
    application.include_router(llm.router)
    application.include_router(newsletter.router)
    application.include_router(keywords.router)
    application.include_router(smart_brain.router)
    application.include_router(search.router)
    application.include_router(stats.router)
    application.include_router(results.router)

    return application


# Module-level app instance for uvicorn / import
app = create_app()

"""api/routers/newsletter.py — Newsletter approval workflow and webhook endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi import Path as FPath
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from database import get_db

logger = logging.getLogger("newsletter")
router = APIRouter(tags=["Newsletter"])


@router.post("/api/webhook/google-news/response", tags=["Webhooks"])
async def webhook_google_news_response_json(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Receives Adaptive Card submissions from Power Automate.
    Supports both:
      1. Initial article batch approval: { "action": "approve", "job_id": "...", "selected_0": "true", ... }
      2. Direct newsletter action: { "action": "newsletter_draft" | "newsletter_send", "newsletter_id": 123 }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    from newsletter_service import handle_teams_submission

    action = body.get("action") or request.query_params.get("action", "")
    job_id = body.get("job_id") or request.query_params.get("job_id", "")
    newsletter_id = body.get("newsletter_id") or request.query_params.get("newsletter_id")

    if not job_id and not newsletter_id:
        raise HTTPException(status_code=400, detail="job_id or newsletter_id is required")

    payload = {**body}
    if action:
        payload["action"] = action
    if job_id:
        payload["job_id"] = job_id
    if newsletter_id:
        payload["newsletter_id"] = newsletter_id

    try:
        result = handle_teams_submission(db, payload)
        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result)
        return {"status": "ok", **result}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("Webhook submission processing failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/webhook/newsletter/action", tags=["Webhooks"])
async def webhook_newsletter_action(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Dedicated endpoint for Microsoft Teams generated newsletter card actions:
    Payload: { "action": "newsletter_draft" | "newsletter_send", "newsletter_id": 123 }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    from newsletter_service import handle_teams_submission

    action = body.get("action") or request.query_params.get("action", "")
    newsletter_id = body.get("newsletter_id") or request.query_params.get("newsletter_id")

    if not newsletter_id:
        raise HTTPException(status_code=400, detail="newsletter_id is required")

    try:
        result = handle_teams_submission(db, {**body, "action": action, "newsletter_id": newsletter_id})
        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result)
        return {"status": "ok", **result}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("Newsletter webhook action failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))



@router.post("/webhook/google-news/response", tags=["Newsletter"])
def webhook_google_news_response_legacy(
    job_id: str = None,
    action: str = None,
    body: Dict[str, Any] = None,
    db: Session = Depends(get_db),
):
    from newsletter_service import process_webhook_response

    if action:
        if not job_id:
            raise HTTPException(400, "job_id is required")
        approved = action == "approve"
        reason   = "Approved via Teams" if approved else "Rejected via Teams"
    else:
        if body is None:
            raise HTTPException(400, "Request body is required")
        job_id   = body.get("job_id", "").strip()
        approved = bool(body.get("approved", False))
        reason   = body.get("reason", "")

    if not job_id:
        raise HTTPException(400, "job_id is required")

    try:
        return process_webhook_response(db, job_id, approved, reason)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Webhook response processing failed: %s", e)
        raise HTTPException(500, f"Processing failed: {e}")


@router.get("/api/newsletter/jobs")
def get_newsletter_jobs(db: Session = Depends(get_db)):
    from newsletter_service import get_all_jobs
    return {"jobs": get_all_jobs(db)}


@router.get("/api/newsletter/pending")
def get_pending_newsletter_jobs(db: Session = Depends(get_db)):
    from newsletter_service import get_pending_jobs
    return {"jobs": get_pending_jobs(db)}


@router.get("/api/newsletters")
def get_newsletters(db: Session = Depends(get_db)):
    from newsletter_service import get_all_newsletters
    return {"newsletters": get_all_newsletters(db)}


@router.get("/api/newsletters/{newsletter_id}")
def get_newsletter(newsletter_id: int = FPath(...), db: Session = Depends(get_db)):
    from newsletter_service import get_newsletter_by_id
    nl = get_newsletter_by_id(db, newsletter_id)
    if not nl:
        raise HTTPException(404, f"Newsletter {newsletter_id} not found")
    return nl


@router.get("/api/newsletters/{newsletter_id}/preview", response_class=HTMLResponse, tags=["Newsletter"])
def preview_newsletter_html(
    newsletter_id: int = FPath(...),
    db: Session = Depends(get_db),
):
    """
    Renders and serves the complete, standalone HTML email for in-browser preview.
    Does not require frontend React bundle — opens directly as an HTML document.
    """
    import json
    import datetime
    from db_models import GeneratedNewsletter
    from services.mailchimp_service import render_newsletter_html

    nl = db.query(GeneratedNewsletter).filter(GeneratedNewsletter.id == newsletter_id).first()
    if not nl:
        raise HTTPException(404, f"Newsletter {newsletter_id} not found")

    try:
        content_dict = json.loads(nl.content_json or "{}")
    except Exception:
        content_dict = {}

    rendered = render_newsletter_html({
        "title": nl.title or "TrendSense Newsletter",
        "content": content_dict,
    })

    # For browser preview friendliness, replace merge tags with realistic values
    year_str = str(datetime.datetime.now().year)
    rendered = (
        rendered
        .replace("*|CURRENT_YEAR|*", year_str)
        .replace("*|LIST:COMPANY|*", "Tzunami")
        .replace("*|HTML:LIST_ADDRESS_HTML|*", "Tzunami Inc., Cloud Migration & Governance")
        .replace("*|UNSUB|*", "#")
        .replace("*|UPDATE_PROFILE|*", "#")
        .replace("*|REWARDS|*", "")
    )

    return HTMLResponse(content=rendered, status_code=200)


@router.delete("/api/newsletters/{newsletter_id}")
def delete_newsletter(newsletter_id: int = FPath(...), db: Session = Depends(get_db)):
    from db_models import GeneratedNewsletter
    nl = db.query(GeneratedNewsletter).filter(GeneratedNewsletter.id == newsletter_id).first()
    if not nl:
        raise HTTPException(404, f"Newsletter {newsletter_id} not found")
    db.delete(nl)
    db.commit()
    return {"deleted": newsletter_id}


@router.put("/api/newsletters/{newsletter_id}", tags=["Newsletter"])
async def update_newsletter(
    request: Request,
    newsletter_id: int = FPath(...),
    db: Session = Depends(get_db),
):
    """Updates newsletter title and content JSON in the database (locked if already sent)."""
    import json
    from db_models import GeneratedNewsletter
    from newsletter_service import _newsletter_dict

    nl = db.query(GeneratedNewsletter).filter(GeneratedNewsletter.id == newsletter_id).first()
    if not nl:
        raise HTTPException(404, f"Newsletter {newsletter_id} not found")

    if nl.mailchimp_status == "sent":
        raise HTTPException(
            status_code=409,
            detail=f"Newsletter #{newsletter_id} was already sent via Mailchimp on {nl.mailchimp_sent_at} and is locked from editing."
        )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    if "title" in body and body["title"]:
        nl.title = str(body["title"]).strip()

    if "content" in body:
        nl.content_json = json.dumps(body["content"])
    elif "content_json" in body:
        if isinstance(body["content_json"], dict):
            nl.content_json = json.dumps(body["content_json"])
        else:
            nl.content_json = str(body["content_json"])

    try:
        db.commit()
        db.refresh(nl)
        return {"status": "ok", "newsletter": _newsletter_dict(nl)}
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to update newsletter %d: %s", newsletter_id, exc)
        raise HTTPException(500, f"Database error updating newsletter: {exc}")


# ── Mailchimp Campaign & Integration Endpoints ────────────────────────────────


@router.get("/api/mailchimp/config", tags=["Mailchimp"])
def get_mailchimp_config(db: Session = Depends(get_db)):
    """Returns whether Mailchimp is configured in .env and database-configured audiences."""
    from services.mailchimp_service import get_mailchimp_credentials
    from core.config import settings
    from db_models import UserPreferences
    import json

    key, prefix = get_mailchimp_credentials()

    pref_row = db.query(UserPreferences).filter_by(key="mailchimp_custom_audiences").first()
    custom_audiences = []
    if pref_row and pref_row.value:
        try:
            custom_audiences = json.loads(pref_row.value)
        except Exception:
            pass

    return {
        "configured": bool(key),
        "server_prefix": prefix if key else None,
        "default_from_name": getattr(settings, "MAILCHIMP_FROM_NAME", "") or "TrendSense Newsletter",
        "default_from_email": getattr(settings, "MAILCHIMP_FROM_EMAIL", "") or None,
        "custom_audiences": custom_audiences,
    }


@router.post("/api/mailchimp/test", tags=["Mailchimp"])
def test_mailchimp_connection():
    """Test ping connection with Mailchimp using configured API key."""
    from services.mailchimp_service import ping_connection
    res = ping_connection()
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Connection failed"))
    return res


@router.get("/api/mailchimp/audiences", tags=["Mailchimp"])
def get_mailchimp_audiences():
    """List available subscriber audiences from Mailchimp."""
    from services.mailchimp_service import get_audiences
    try:
        audiences = get_audiences()
        return {"audiences": audiences}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/api/mailchimp/audiences/{audience_id}/members", tags=["Mailchimp"])
def get_mailchimp_audience_members(
    audience_id: str,
    status: Optional[str] = None,
    count: int = 50,
    offset: int = 0,
):
    """List subscriber members/contacts belonging to an audience list."""
    from services.mailchimp_service import get_audience_members
    try:
        data = get_audience_members(
            audience_id=audience_id,
            status=status,
            count=count,
            offset=offset,
        )
        return data
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to fetch audience members for %s: %s", audience_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/newsletters/{newsletter_id}/mailchimp/send", tags=["Mailchimp"])
async def send_newsletter_via_mailchimp(
    request: Request,
    newsletter_id: int = FPath(...),
    db: Session = Depends(get_db),
):
    """Create and immediately dispatch a Mailchimp regular campaign for this newsletter."""
    from services.mailchimp_service import create_and_send_campaign
    try:
        body = await request.json()
    except Exception:
        body = {}

    try:
        result = create_and_send_campaign(
            db=db,
            newsletter_id=newsletter_id,
            audience_id=body.get("audience_id"),
            audience_ids=body.get("audience_ids"),
            subject=body.get("subject"),
            preview_text=body.get("preview_text"),
            from_name=body.get("from_name"),
            from_email=body.get("from_email"),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to send Mailchimp campaign: %s", exc)
        raise HTTPException(status_code=500, detail=f"Mailchimp send failed: {exc}")


@router.post("/api/newsletters/{newsletter_id}/mailchimp/schedule", tags=["Mailchimp"])
async def schedule_newsletter_via_mailchimp(
    request: Request,
    newsletter_id: int = FPath(...),
    db: Session = Depends(get_db),
):
    """Create and schedule a Mailchimp campaign for a future UTC timestamp."""
    from services.mailchimp_service import create_and_send_campaign
    try:
        body = await request.json()
    except Exception:
        body = {}

    schedule_time = body.get("schedule_time")
    if not schedule_time:
        raise HTTPException(status_code=400, detail="schedule_time (ISO 8601 UTC timestamp) is required")

    try:
        result = create_and_send_campaign(
            db=db,
            newsletter_id=newsletter_id,
            audience_id=body.get("audience_id"),
            audience_ids=body.get("audience_ids"),
            subject=body.get("subject"),
            preview_text=body.get("preview_text"),
            from_name=body.get("from_name"),
            from_email=body.get("from_email"),
            schedule_time_iso=schedule_time,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to schedule Mailchimp campaign: %s", exc)
        raise HTTPException(status_code=500, detail=f"Mailchimp schedule failed: {exc}")


@router.post("/api/newsletters/{newsletter_id}/mailchimp/draft", tags=["Mailchimp"])
async def draft_newsletter_via_mailchimp(
    request: Request,
    newsletter_id: int = FPath(...),
    db: Session = Depends(get_db),
):
    """Create and save a Mailchimp campaign draft without sending."""
    from services.mailchimp_service import create_and_send_campaign
    try:
        body = await request.json()
    except Exception:
        body = {}

    try:
        result = create_and_send_campaign(
            db=db,
            newsletter_id=newsletter_id,
            audience_id=body.get("audience_id"),
            audience_ids=body.get("audience_ids"),
            subject=body.get("subject"),
            preview_text=body.get("preview_text"),
            from_name=body.get("from_name"),
            from_email=body.get("from_email"),
            draft_only=True,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to create Mailchimp draft: %s", exc)
        raise HTTPException(status_code=500, detail=f"Mailchimp draft creation failed: {exc}")


@router.get("/api/newsletters/{newsletter_id}/mailchimp/report", tags=["Mailchimp"])
def get_newsletter_mailchimp_report(
    newsletter_id: int = FPath(...),

    db: Session = Depends(get_db),
):
    """Get live open and click analytics for a sent Mailchimp campaign."""
    from db_models import GeneratedNewsletter
    from services.mailchimp_service import get_campaign_report

    nl = db.query(GeneratedNewsletter).filter_by(id=newsletter_id).first()
    if not nl:
        raise HTTPException(404, f"Newsletter {newsletter_id} not found")
    if not nl.mailchimp_campaign_id:
        raise HTTPException(400, f"Newsletter {newsletter_id} has not been sent via Mailchimp yet")

    try:
        report = get_campaign_report(nl.mailchimp_campaign_id)
        return report
    except Exception as exc:
        logger.exception("Failed to fetch Mailchimp report: %s", exc)
        raise HTTPException(status_code=500, detail=f"Could not load campaign report: {exc}")


# ── Auto-scrape Google News (unauthenticated, for MS Teams scheduler) ─────────


def _run_auto_scrape(task_id: str, keywords: list[str]) -> None:
    """Background task: scrape Google News for all keywords, then trigger webhook flow."""
    from datetime import datetime, timezone
    from db_models import TaskHistory
    import database as _db
    from scrapers.scrappa_google_news import run_google_news

    db = _db.SessionLocal() if _db.SessionLocal else None
    try:
        result = run_google_news(
            keywords=keywords,
            max_results=20,
            task_id=task_id,
            db=db,
        )
        logger.info(
            "Auto-scrape completed for task %s — %d articles",
            task_id[:8], result.get("total_articles", 0),
        )
        finished_at = datetime.now(tz=timezone.utc)
        try:
            from core.container import state
            state.task_registry[task_id].update({
                "status": "completed",
                "finished_at": finished_at.isoformat(),
                "result": result,
            })
        except Exception:
            pass
        try:
            if db is not None:
                row = db.query(TaskHistory).filter_by(task_id=task_id).first()
                if row:
                    row.status = "completed"
                    row.finished_at = finished_at
                    row.items_count = result.get("total_articles", 0) or 0
                    db.commit()
        except Exception as exc:
            logger.warning("Could not mark auto-scrape task completed in DB: %s", exc)
    except Exception as exc:
        logger.error("Auto-scrape failed for task %s: %s", task_id[:8], exc)
    finally:
        if db:
            db.close()


@router.post("/api/webhook/google-news/auto-scrape", tags=["Webhooks"])
def auto_scrape_google_news(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Unauthenticated endpoint for MS Teams scheduler.
    Scrapes Google News for all keywords assigned to google_news,
    then triggers the normal webhook → approval → newsletter flow.
    """
    import uuid
    from datetime import datetime, timezone
    from db_models import ScraperKeywordSelection, ScraperKeyword, TaskHistory
    import database

    # Fetch all keywords assigned to google_news
    selections = (
        db.query(ScraperKeywordSelection)
        .filter(ScraperKeywordSelection.scraper == "google_news")
        .all()
    )
    if not selections:
        raise HTTPException(400, "No keywords assigned to Google News")

    keyword_ids = [s.keyword_id for s in selections]
    keywords = [
        row.keyword for row in
        db.query(ScraperKeyword)
        .filter(ScraperKeyword.id.in_(keyword_ids))
        .all()
    ]
    if not keywords:
        raise HTTPException(400, "No keywords found for Google News")

    # Create task
    task_id = uuid.uuid4().hex
    now = datetime.now(tz=timezone.utc)

    try:
        db.add(TaskHistory(
            task_id=task_id, scraper="google_news", status="running",
            started_at=now, keyword=", ".join(keywords[:3]),
        ))
        db.commit()
    except Exception as exc:
        logger.warning("Could not save auto-scrape task to DB: %s", exc)

    # Also update in-memory task registry
    try:
        from core.container import state
        state.task_registry[task_id] = {
            "task_id": task_id, "scraper": "google_news", "status": "running",
            "started_at": now.isoformat(), "finished_at": None,
            "result": None, "error": None,
        }
    except Exception:
        pass

    background_tasks.add_task(_run_auto_scrape, task_id, keywords)

    return {
        "status": "started",
        "task_id": task_id,
        "keywords": keywords,
        "keyword_count": len(keywords),
        "max_results": 20,
    }

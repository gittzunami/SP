"""api/routers/newsletter.py — Newsletter approval workflow and webhook endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import Path as FPath
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
    Receives the Adaptive Card submission from Power Automate.

    Power Automate HTTP action body (set to JSON):
    {
      "action":     "approve",
      "job_id":     "abc123def456...",
      "selected_0": "true",
      "selected_1": "false",
      ...
    }
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    from newsletter_service import handle_teams_submission

    action = body.get("action") or request.query_params.get("action", "approve")
    job_id = body.get("job_id") or request.query_params.get("job_id", "")

    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")

    try:
        result = handle_teams_submission(db, {**body, "action": action, "job_id": job_id})
        return {"status": "ok", **result}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
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


@router.delete("/api/newsletters/{newsletter_id}")
def delete_newsletter(newsletter_id: int = FPath(...), db: Session = Depends(get_db)):
    from db_models import GeneratedNewsletter
    nl = db.query(GeneratedNewsletter).filter(GeneratedNewsletter.id == newsletter_id).first()
    if not nl:
        raise HTTPException(404, f"Newsletter {newsletter_id} not found")
    db.delete(nl)
    db.commit()
    return {"deleted": newsletter_id}

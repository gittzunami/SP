"""api/routers/llm.py — LLM configuration, analysis, and spending endpoints."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import Path as FPath
from sqlalchemy.orm import Session

from database import get_db

logger = logging.getLogger("llm")
router = APIRouter(prefix="/api/llm", tags=["LLM"])


@router.get("/configs")
def get_llm_configs(db: Session = Depends(get_db)):
    from llm_service import get_all_configs
    return get_all_configs(db)


@router.get("/active-config")
def get_active_llm_config(db: Session = Depends(get_db)):
    from llm_service import get_active_config
    cfg = get_active_config(db)
    if not cfg:
        return {"configured": False}
    return {"configured": True, "provider": cfg["provider"], "model": cfg["model"]}


@router.post("/config")
def save_llm_config(body: Dict[str, Any], db: Session = Depends(get_db)):
    from llm_service import save_provider_config
    provider   = body.get("provider", "")
    api_key    = body.get("api_key")
    model      = body.get("model", "")
    set_active = bool(body.get("set_active", False))
    if not provider or not model:
        raise HTTPException(400, "provider and model are required")
    try:
        return save_provider_config(db, provider, api_key, model, set_active)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/enhance-prompt")
def enhance_prompt_endpoint(body: Dict[str, Any], db: Session = Depends(get_db)):
    from llm_service import enhance_prompt
    raw_prompt   = body.get("prompt", "").strip()
    data_sources = body.get("data_sources", [])
    sample_rows  = body.get("sample_rows", [])
    if not raw_prompt:
        raise HTTPException(400, "prompt is required")
    try:
        return enhance_prompt(db, raw_prompt, data_sources, sample_rows)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Enhancement failed: {e}")


@router.post("/feed")
def feed_to_llm_endpoint(body: Dict[str, Any], db: Session = Depends(get_db)):
    from llm_service import feed_to_llm
    prompt  = body.get("prompt", "").strip()
    rows    = body.get("rows", [])
    keyword = body.get("keyword", "")
    if not prompt:
        raise HTTPException(400, "prompt is required")
    if not rows:
        raise HTTPException(400, "rows (data) is required")
    if len(rows) > 15:
        raise HTTPException(400, f"Maximum 15 records allowed per LLM request (got {len(rows)})")
    try:
        return feed_to_llm(db, prompt, rows, keyword)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("feed_to_llm failed: %s", e)
        raise HTTPException(500, f"LLM call failed: {e}")


@router.get("/spending")
def llm_spending_summary(db: Session = Depends(get_db)):
    from llm_service import get_llm_spending_summary
    return get_llm_spending_summary(db)


@router.post("/analyses")
def save_llm_analysis(body: Dict[str, Any], db: Session = Depends(get_db)):
    from db_models import LLMAnalysis
    generated_at_raw = body.get("generatedAt") or body.get("generated_at")
    if not generated_at_raw:
        raise HTTPException(400, "generatedAt is required")
    try:
        generated_at = datetime.fromisoformat(str(generated_at_raw).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"Invalid generatedAt: {generated_at_raw!r}")

    platforms = body.get("platforms", [])
    row = LLMAnalysis(
        provider        = body.get("provider", ""),
        model           = body.get("model", ""),
        raw_prompt      = body.get("rawPrompt", ""),
        enhanced_prompt = body.get("enhancedPrompt", ""),
        response        = body.get("response", ""),
        record_count    = int(body.get("recordCount", 0) or 0),
        tokens_used     = int(body.get("tokens_used", 0) or 0),
        cost_usd        = float(body.get("cost_usd", 0.0) or 0.0),
        platforms       = json.dumps(platforms) if isinstance(platforms, list) else str(platforms),
        generated_at    = generated_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("LLM analysis saved: id=%d provider=%s", row.id, row.provider)
    return {"id": row.id}


@router.get("/analyses")
def list_llm_analyses(
    date:  str = Query(None, description="Filter by date YYYY-MM-DD"),
    limit: int = Query(100, ge=1, le=500),
    db:    Session = Depends(get_db),
):
    from db_models import LLMAnalysis
    q = db.query(LLMAnalysis)
    if date:
        try:
            day_start = datetime.fromisoformat(f"{date}T00:00:00+00:00")
            day_end   = datetime.fromisoformat(f"{date}T23:59:59+00:00")
            q = q.filter(LLMAnalysis.generated_at >= day_start, LLMAnalysis.generated_at <= day_end)
        except ValueError:
            raise HTTPException(400, f"Invalid date: {date!r}")
    rows = q.order_by(LLMAnalysis.generated_at.desc()).limit(limit).all()

    def _row(r):
        try:
            platforms = json.loads(r.platforms) if r.platforms else []
        except Exception:
            platforms = []
        return {
            "id":             r.id,
            "provider":       r.provider,
            "model":          r.model,
            "rawPrompt":      r.raw_prompt,
            "enhancedPrompt": r.enhanced_prompt,
            "response":       r.response,
            "recordCount":    r.record_count,
            "tokens_used":    r.tokens_used,
            "cost_usd":       r.cost_usd,
            "platforms":      platforms,
            "generatedAt":    r.generated_at.isoformat() if r.generated_at else None,
        }

    return {"total": len(rows), "analyses": [_row(r) for r in rows]}


@router.delete("/analyses/{analysis_id}")
def delete_llm_analysis(analysis_id: int = FPath(...), db: Session = Depends(get_db)):
    from db_models import LLMAnalysis
    row = db.query(LLMAnalysis).filter_by(id=analysis_id).first()
    if not row:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    db.delete(row)
    db.commit()
    return {"status": "ok", "deleted_id": analysis_id}


@router.delete("/config/{provider}/key")
def delete_llm_key(provider: str = FPath(...), db: Session = Depends(get_db)):
    from db_models import LLMProviderConfig
    if provider not in ("openai", "anthropic", "gemini"):
        raise HTTPException(400, f"Unknown provider: {provider}")
    row = db.query(LLMProviderConfig).filter_by(provider=provider).first()
    if not row:
        raise HTTPException(404, "Provider not configured")
    row.api_key   = None
    row.is_active = False
    db.commit()
    return {"status": "ok", "provider": provider, "message": "API key removed"}

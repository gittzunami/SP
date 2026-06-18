"""api/routers/keywords.py — Keyword pool, keyword-selections, and Facebook group endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Path as FPath
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db

router = APIRouter(tags=["Keywords"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class _KeywordAddBody(BaseModel):
    keywords: List[str]
    pool:     str = "shared"  # "shared" | "google_news"


class _KwSelectionBody(BaseModel):
    scraper:    str
    keyword_id: int


class _FacebookGroupBody(BaseModel):
    name: str
    url:  str


# ── Keyword pool ──────────────────────────────────────────────────────────────

@router.get("/api/keywords")
def list_keywords(db: Session = Depends(get_db)):
    from db_models import ScraperKeyword
    rows = db.query(ScraperKeyword).order_by(ScraperKeyword.created_at).all()
    return {
        "shared":      [{"id": r.id, "keyword": r.keyword} for r in rows if r.pool == "shared"],
        "google_news": [{"id": r.id, "keyword": r.keyword} for r in rows if r.pool == "google_news"],
    }


@router.post("/api/keywords")
def add_keywords(body: _KeywordAddBody, db: Session = Depends(get_db)):
    from db_models import ScraperKeyword
    added = []
    for kw in body.keywords:
        kw = kw.strip()
        if not kw:
            continue
        exists = db.query(ScraperKeyword).filter(
            ScraperKeyword.keyword == kw,
            ScraperKeyword.pool    == body.pool,
        ).first()
        if not exists:
            db.add(ScraperKeyword(
                keyword=kw, pool=body.pool,
                created_at=datetime.now(tz=timezone.utc),
            ))
            added.append(kw)
    db.commit()
    return {"added": added}


@router.delete("/api/keywords/{keyword_id}")
def delete_keyword(keyword_id: int = FPath(...), db: Session = Depends(get_db)):
    from db_models import ScraperKeyword
    kw = db.query(ScraperKeyword).filter(ScraperKeyword.id == keyword_id).first()
    if not kw:
        raise HTTPException(404, f"Keyword {keyword_id} not found")
    db.delete(kw)
    db.commit()
    return {"deleted": keyword_id}


# ── Keyword selections ────────────────────────────────────────────────────────

@router.get("/api/keyword-selections")
def get_keyword_selections(db: Session = Depends(get_db)):
    from db_models import ScraperKeywordSelection
    rows   = db.query(ScraperKeywordSelection).all()
    result: dict[str, list[int]] = {}
    for r in rows:
        result.setdefault(r.scraper, []).append(r.keyword_id)
    return {"selections": result}


@router.post("/api/keyword-selections")
def add_keyword_selection(body: _KwSelectionBody, db: Session = Depends(get_db)):
    from db_models import ScraperKeywordSelection
    existing = db.query(ScraperKeywordSelection).filter_by(
        scraper=body.scraper, keyword_id=body.keyword_id
    ).first()
    if not existing:
        db.add(ScraperKeywordSelection(scraper=body.scraper, keyword_id=body.keyword_id))
        db.commit()
    return {"scraper": body.scraper, "keyword_id": body.keyword_id}


@router.delete("/api/keyword-selections")
def remove_keyword_selection(body: _KwSelectionBody, db: Session = Depends(get_db)):
    from db_models import ScraperKeywordSelection
    row = db.query(ScraperKeywordSelection).filter_by(
        scraper=body.scraper, keyword_id=body.keyword_id
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return {"scraper": body.scraper, "keyword_id": body.keyword_id}


# ── Facebook groups ───────────────────────────────────────────────────────────

@router.get("/api/facebook/groups", tags=["Facebook Groups"])
def list_facebook_groups(db: Session = Depends(get_db)):
    from db_models import FacebookGroup
    rows = db.query(FacebookGroup).order_by(FacebookGroup.created_at).all()
    return {"groups": [{"id": r.id, "name": r.name, "url": r.url} for r in rows]}


@router.post("/api/facebook/groups", tags=["Facebook Groups"])
def add_facebook_group(body: _FacebookGroupBody, db: Session = Depends(get_db)):
    from db_models import FacebookGroup
    name = body.name.strip()
    url  = body.url.strip()
    if not name or not url:
        raise HTTPException(400, "name and url are required")
    existing = db.query(FacebookGroup).filter(FacebookGroup.url == url).first()
    if existing:
        raise HTTPException(409, "A group with this URL already exists")
    grp = FacebookGroup(name=name, url=url, created_at=datetime.now(tz=timezone.utc))
    db.add(grp)
    db.commit()
    db.refresh(grp)
    return {"id": grp.id, "name": grp.name, "url": grp.url}


@router.delete("/api/facebook/groups/{group_id}", tags=["Facebook Groups"])
def delete_facebook_group(group_id: int = FPath(...), db: Session = Depends(get_db)):
    from db_models import FacebookGroup
    grp = db.query(FacebookGroup).filter(FacebookGroup.id == group_id).first()
    if not grp:
        raise HTTPException(404, f"Group {group_id} not found")
    db.delete(grp)
    db.commit()
    return {"deleted": group_id}

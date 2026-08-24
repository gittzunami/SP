"""api/routers/preferences.py — User preferences CRUD (replaces localStorage)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi import Path as FPath
from sqlalchemy.orm import Session

from database import get_db

router = APIRouter(prefix="/api/preferences", tags=["Preferences"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_dict(row) -> dict:
    return {
        "key":        row.key,
        "value":      row.value,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── GET all preferences ───────────────────────────────────────────────────────

@router.get("")
def get_all_preferences(db: Session = Depends(get_db)):
    from db_models import UserPreferences, Base
    try:
        rows = db.query(UserPreferences).all()
    except Exception:
        db.rollback()
        Base.metadata.create_all(bind=db.get_bind(), tables=[UserPreferences.__table__])
        rows = db.query(UserPreferences).all()
    return {"preferences": {r.key: r.value for r in rows}}


# ── GET single preference ─────────────────────────────────────────────────────

@router.get("/{key}")
def get_preference(key: str = FPath(...), db: Session = Depends(get_db)):
    from db_models import UserPreferences, Base
    try:
        row = db.query(UserPreferences).filter_by(key=key).first()
    except Exception:
        db.rollback()
        Base.metadata.create_all(bind=db.get_bind(), tables=[UserPreferences.__table__])
        row = db.query(UserPreferences).filter_by(key=key).first()

    if not row:
        raise HTTPException(status_code=404, detail=f"Preference '{key}' not found.")
    return _to_dict(row)


# ── PUT (upsert) preference ───────────────────────────────────────────────────

@router.put("/{key}")
def set_preference(
    key:  str  = FPath(...),
    body: dict = Body(...),
    db:   Session = Depends(get_db),
):
    from db_models import UserPreferences, Base
    value = body.get("value")
    if value is not None:
        value = str(value)

    now = datetime.now(timezone.utc)
    try:
        row = db.query(UserPreferences).filter_by(key=key).first()
    except Exception:
        db.rollback()
        Base.metadata.create_all(bind=db.get_bind(), tables=[UserPreferences.__table__])
        row = db.query(UserPreferences).filter_by(key=key).first()

    if row:
        row.value      = value
        row.updated_at = now
    else:
        row = UserPreferences(key=key, value=value, updated_at=now)
        db.add(row)

    try:
        db.commit()
    except Exception:
        db.rollback()
        Base.metadata.create_all(bind=db.get_bind(), tables=[UserPreferences.__table__])
        db.add(row)
        db.commit()

    db.refresh(row)
    return _to_dict(row)


# ── DELETE single preference ──────────────────────────────────────────────────

@router.delete("/{key}")
def delete_preference(key: str = FPath(...), db: Session = Depends(get_db)):
    from db_models import UserPreferences
    row = db.query(UserPreferences).filter_by(key=key).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"Preference '{key}' not found.")
    db.delete(row)
    db.commit()
    return {"deleted": key}


# ── DELETE all preferences (Clear Cache) ─────────────────────────────────────

@router.delete("")
def clear_all_preferences(db: Session = Depends(get_db)):
    from db_models import UserPreferences
    count = db.query(UserPreferences).delete()
    db.commit()
    return {"deleted_count": count}

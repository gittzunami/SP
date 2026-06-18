"""api/routers/auth.py — Authentication endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from jose import JWTError, jwt
from pydantic import BaseModel

from core.config import settings

logger = logging.getLogger("auth")
router = APIRouter(prefix="/api/auth", tags=["Auth"])


class _LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(payload: _LoginRequest):
    if not settings.LOGIN_USERNAME or not settings.LOGIN_PASSWORD:
        raise HTTPException(
            status_code=503,
            detail="Login not configured — set LOGIN_USERNAME and LOGIN_PASSWORD in .env",
        )
    if payload.username != settings.LOGIN_USERNAME or payload.password != settings.LOGIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = jwt.encode(
        {
            "sub": settings.LOGIN_USERNAME,
            "exp": datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_H),
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    return {
        "access_token": token,
        "token_type":   "bearer",
        "username":     settings.LOGIN_USERNAME,
    }


@router.get("/me")
def me(request: Request):
    raw   = request.headers.get("Authorization", "")
    token = raw[7:] if raw.startswith("Bearer ") else ""
    try:
        data = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"username": data.get("sub")}

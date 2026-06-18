"""
api/dependencies.py
===================
FastAPI dependency providers.

Inject these via `Depends()` in route handlers:

    @router.get("/me")
    async def get_me(user: str = Depends(get_current_user)):
        return {"username": user}

Dependencies here are thin wrappers — they delegate to existing services and
the `core` layer; no business logic lives here.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from core.config import settings
from database import get_db  # existing DB session provider

__all__ = ["get_current_user", "get_db"]

# Re-export get_db so callers only need to import from here
get_db = get_db  # noqa: F811

_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(token: str | None = Depends(_oauth2)) -> str:
    """
    Decode the Bearer token and return the username (``sub`` claim).

    Raises HTTP 401 when the token is missing, malformed, or expired.
    Route handlers that call ``Depends(get_current_user)`` are automatically
    protected — no extra middleware check is needed for those paths.
    """
    if not token:
        raise HTTPException(
            status_code = status.HTTP_401_UNAUTHORIZED,
            detail      = "Not authenticated",
            headers     = {"WWW-Authenticate": "Bearer"},
        )
    try:
        payload  = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise JWTError("Missing sub claim")
    except JWTError:
        raise HTTPException(
            status_code = status.HTTP_401_UNAUTHORIZED,
            detail      = "Invalid or expired token",
            headers     = {"WWW-Authenticate": "Bearer"},
        )
    return username

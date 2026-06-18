"""
api/middleware/auth.py
======================
JWT authentication middleware.
Validates Bearer tokens on every request except explicitly whitelisted paths.
"""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt

from core.config import settings

logger = logging.getLogger("auth")


async def jwt_middleware(request: Request, call_next):
    path = request.url.path

    # Always allow: CORS preflight, public paths, webhook callbacks
    if (
        request.method == "OPTIONS"
        or path in settings.AUTH_SKIP_EXACT
        or any(path.startswith(p) for p in settings.AUTH_SKIP_PREFIX)
    ):
        return await call_next(request)

    raw   = request.headers.get("Authorization", "")
    token = raw[7:] if raw.startswith("Bearer ") else ""
    if not token:
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    try:
        jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})

    return await call_next(request)

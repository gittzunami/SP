"""
main.py — TrendSense Scraper API entry point
============================================

Start:  uvicorn main:app --reload --port 8000
Docs:   http://localhost:8000/docs

The full application lives in api/app.py.
This file is a slim shim so existing uvicorn commands keep working.
"""

from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

from api.app import app  # noqa: F401 — re-exported for uvicorn

__all__ = ["app"]

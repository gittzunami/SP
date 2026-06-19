"""
models.py — Backward-compatibility shim
=======================================
Pydantic schemas have moved to api/schemas/scrapers.py.
This file re-exports only what scrapers and services actually import from here.

New code should import from:
  from api.schemas.scrapers import RedditConfig, RunRequest, ...
"""

from api.schemas.scrapers import (
    SCHEDULE_SECONDS,
    APIFY_API_TOKEN,
    RedditConfig,
    TikTokConfig,
    EduGeekConfig,
    StackExchangeConfig,
    AutodeskConfig,
    SpiceworksConfig,
    QuoraConfig,
)

__all__ = [
    "SCHEDULE_SECONDS",
    "APIFY_API_TOKEN",
    "RedditConfig",
    "TikTokConfig",
    "EduGeekConfig",
    "StackExchangeConfig",
    "AutodeskConfig",
    "SpiceworksConfig",
    "QuoraConfig",
]

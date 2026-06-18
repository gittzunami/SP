"""
models.py — Backward-compatibility shim
=======================================
Pydantic schemas have moved to api/schemas/scrapers.py.
This file re-exports everything so existing imports keep working.

New code should import from:
  from api.schemas.scrapers import RedditConfig, RunRequest, ...
"""

from api.schemas.scrapers import (  # noqa: F401
    ScheduleInterval,
    SCHEDULE_SECONDS,
    APIFY_API_TOKEN,
    GETXAPI_KEY,
    SCRAPPA_API_KEY,
    RedditConfig,
    TikTokConfig,
    EduGeekCategory,
    EduGeekConfig,
    StackExchangeConfig,
    AutodeskContentType,
    AutodeskConfig,
    TwitterConfig,
    InstagramConfig,
    GoogleNewsConfig,
    SpiceworksConfig,
    QuoraConfig,
    FacebookConfig,
    RunRequest,
    ScheduleRequest,
    RunResponse,
)

"""
models.py — Pydantic request/response schemas for all scrapers.
API keys are read from environment variables.
Set them in your .env file — never hardcode secrets here.
"""

from __future__ import annotations

import os
from typing import List, Literal, Dict, Any, Optional
from pydantic import BaseModel, Field

# ── Schedule ──────────────────────────────────────────────────────────────────

ScheduleInterval = Literal["manual", "daily", "weekly", "fortnightly", "monthly"]

SCHEDULE_SECONDS: Dict[str, int] = {
    "daily":       86_400,
    "weekly":      604_800,
    "fortnightly": 1_296_000,
    "monthly":     2_592_000,
}

# ── API keys (all from environment) ──────────────────────────────────────────
APIFY_API_TOKEN     = os.environ.get("APIFY_API_TOKEN",    "")
GETXAPI_KEY         = os.environ.get("GETXAPI_KEY",         "")  # https://www.getxapi.com
SCRAPPA_API_KEY     = os.environ.get("SCRAPPA_API_KEY",     "")  # https://scrappa.co
_SCRAPECREATORS_KEY = os.environ.get("SCRAPECREATORS_KEY", "")
_SCRAPINGBEE_KEY    = os.environ.get("SCRAPINGBEE_KEY",    "")
_STACKAPPS_KEY      = os.environ.get("STACKAPPS_KEY",      "")

# ── Scraper defaults (hardcoded — only max_posts/items are user-configurable) ─

# Reddit
_REDDIT_MAX_POSTS    = 20
_REDDIT_MAX_COMMENTS = 50   # per-post limit; frontend sends max_posts * 50
_REDDIT_SORT         = "relevance"
_REDDIT_TIME_FILTER  = "all"

# TikTok
_TIKTOK_MAX_POSTS    = 20
_TIKTOK_MAX_COMMENTS = 50

# EduGeek
_EDUGEEK_MAX_ITEMS   = 20
_EDUGEEK_MAX_REPLIES = 50
_EDUGEEK_CATEGORIES  = ["forums"]

# StackExchange
_SE_SITES        = ["stackoverflow"]
_SE_MAX_PER_SITE = 20
_SE_MAX_ANSWERS  = 50
_SE_MAX_COMMENTS = 50

# Autodesk
_AUTODESK_MAX_POSTS    = 20
_AUTODESK_MAX_REPLIES  = 50
_AUTODESK_CONTENT_TYPES = ["all"]

# Twitter
_TWITTER_MAX_TWEETS = 20
_TWITTER_LANG       = "en"

# Instagram
_INSTAGRAM_RESULTS_LIMIT = 20

# Google News (Scrappa)
_GOOGLE_NEWS_MAX_RESULTS = 50

# Quora
_QUORA_MAX_RESULTS = 20



# ══════════════════════════════════════════════════════════════════════════════
#  Scraper configs
# ══════════════════════════════════════════════════════════════════════════════

class RedditConfig(BaseModel):
    keyword:      str = Field(..., description="Search term")
    subreddits:   List[str] = Field(default=[], description="Leave empty to search all of Reddit.")
    sort:         Literal["relevance", "new", "top", "comments"] = _REDDIT_SORT
    time_filter:  Literal["hour", "day", "week", "month", "year", "all"] = _REDDIT_TIME_FILTER
    max_posts:    int = Field(default=_REDDIT_MAX_POSTS,    ge=1)
    max_comments: int = Field(default=_REDDIT_MAX_COMMENTS, ge=0)
    since_date:   Optional[str] = Field(default=None, description="ISO date string e.g. '2024-01-15' — only keep records on or after this date")
    schedule:     ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keyword": "school IT infrastructure", "subreddits": ["sysadmin"],
        "max_posts": 20, "max_comments": 10,
    }}}


class TikTokConfig(BaseModel):
    api_key:      str = Field(default_factory=lambda: _SCRAPECREATORS_KEY, description="ScrapeCreators API key.")
    keyword:      str = Field(..., description="Hashtag or search term")
    max_posts:    int = Field(default=_TIKTOK_MAX_POSTS,    ge=1)
    max_comments: int = Field(default=_TIKTOK_MAX_COMMENTS, ge=0)
    schedule:     ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keyword": "edtech", "max_posts": 20, "max_comments": 10,
    }}}


EduGeekCategory = Literal["forums", "blogs", "jobs", "groups", "articles", "all"]

class EduGeekConfig(BaseModel):
    api_key:     str = Field(default_factory=lambda: _SCRAPINGBEE_KEY, description="ScrapingBee API key.")
    keyword:     str
    categories:  List[EduGeekCategory] = Field(default_factory=lambda: _EDUGEEK_CATEGORIES)
    max_items:   int = Field(default=_EDUGEEK_MAX_ITEMS,   ge=1)
    max_replies: int = Field(default=_EDUGEEK_MAX_REPLIES, ge=0)
    since_date:  Optional[str] = Field(default=None, description="ISO date string — only keep records on or after this date")
    schedule:    ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keyword": "network switch", "categories": ["forums"],
        "max_items": 20, "max_replies": 10,
    }}}


class StackExchangeConfig(BaseModel):
    api_key:      str = Field(default_factory=lambda: _STACKAPPS_KEY, description="StackApps API key.")
    sites:        List[str] = Field(default_factory=lambda: list(_SE_SITES))
    keyword:      str
    max_per_site: int = Field(default=_SE_MAX_PER_SITE,  ge=1)
    max_answers:  int = Field(default=_SE_MAX_ANSWERS,   ge=0)
    max_comments: int = Field(default=_SE_MAX_COMMENTS,  ge=0)
    since_date:   Optional[str] = Field(default=None, description="ISO date string — only keep records on or after this date")
    schedule:     ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "sites": ["stackoverflow", "superuser"], "keyword": "windows group policy",
        "max_per_site": 20, "max_answers": 5, "max_comments": 5,
    }}}


AutodeskContentType = Literal["forum", "qanda", "tkb", "blog", "idea", "all"]

class AutodeskConfig(BaseModel):
    keyword:       str
    content_types: List[AutodeskContentType] = Field(default_factory=lambda: list(_AUTODESK_CONTENT_TYPES))
    max_posts:     int = Field(default=_AUTODESK_MAX_POSTS,   ge=1)
    max_replies:   int = Field(default=_AUTODESK_MAX_REPLIES, ge=0)
    since_date:    Optional[str] = Field(default=None, description="ISO date string — only keep records on or after this date")
    schedule:      ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keyword": "AutoCAD performance slow", "content_types": ["all"],
        "max_posts": 50, "max_replies": 20,
    }}}


class TwitterConfig(BaseModel):
    keywords:   List[str] = Field(..., description="Search terms e.g. ['BBCWorld', 'AI']")
    max_tweets: int        = Field(default=_TWITTER_MAX_TWEETS, ge=1)
    lang:       str        = Field(default=_TWITTER_LANG, description="Language filter e.g. 'en', 'ur'")
    since_date: Optional[str] = Field(default=None, description="ISO date string — only keep tweets on or after this date")
    schedule:   ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keywords": ["Pakistan", "education technology"], "max_tweets": 20, "lang": "en",
    }}}


class InstagramConfig(BaseModel):
    keywords:      List[str] = Field(
        ...,
        description="Usernames (e.g. 'nasa') or hashtags (e.g. '#pakistan')"
    )
    results_limit: int = Field(default=_INSTAGRAM_RESULTS_LIMIT, ge=1)
    schedule:      ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keywords": ["nasa", "#pakistan"], "results_limit": 20,
    }}}


class GoogleNewsConfig(BaseModel):
    keywords:    List[str] = Field(..., description="Search terms for Google News")
    max_results: int = Field(default=_GOOGLE_NEWS_MAX_RESULTS, ge=1)
    since_date:  Optional[str] = Field(default=None, description="ISO date string — only keep articles on or after this date")
    schedule:    ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keywords": ["AI in education", "edtech"], "max_results": 50,
    }}}


class SpiceworksConfig(BaseModel):
    keyword:     str
    max_results: int = Field(default=20, ge=1)
    since_date:  Optional[str] = Field(default=None, description="ISO date string — only keep records on or after this date")
    schedule:    ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keyword": "network switch", "max_results": 20,
    }}}


class QuoraConfig(BaseModel):
    keyword:     str
    max_results: int = Field(default=_QUORA_MAX_RESULTS, ge=1)
    schedule:    ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "keyword": "cloud migration challenges", "max_results": 10,
    }}}


# Facebook
_FACEBOOK_MAX_POSTS = 9

class FacebookConfig(BaseModel):
    api_key:   str = Field(
        default_factory=lambda: os.environ.get("SCRAPECREATORS_KEY", "").strip(),
        description="ScrapeCreators API key (uses SCRAPECREATORS_KEY env var).",
    )
    group_url: str = Field(default="", description="Facebook group URL to scrape")
    keyword:   str = Field(default="", description="Keyword for soft-match filtering")
    max_posts: int = Field(default=_FACEBOOK_MAX_POSTS, ge=1)
    since_date: Optional[str] = Field(
        default=None,
        description="ISO date string — only keep records on or after this date",
    )
    schedule:  ScheduleInterval = "manual"

    model_config = {"json_schema_extra": {"example": {
        "group_url": "https://www.facebook.com/groups/123456789",
        "keyword":   "cloud services",
        "max_posts": 9,
    }}}


# ══════════════════════════════════════════════════════════════════════════════
#  Unified multi-scraper request / response
# ══════════════════════════════════════════════════════════════════════════════

class RunRequest(BaseModel):
    """Include a config block only for the scrapers you want to run."""
    reddit:        Optional[RedditConfig]        = None
    tiktok:        Optional[TikTokConfig]         = None
    edugeek:       Optional[EduGeekConfig]        = None
    stackexchange: Optional[StackExchangeConfig]  = None
    autodesk:      Optional[AutodeskConfig]        = None
    twitter:       Optional[TwitterConfig]         = None
    instagram:     Optional[InstagramConfig]       = None
    google_news:   Optional[GoogleNewsConfig]      = None
    spiceworks:    Optional[SpiceworksConfig]      = None
    quora:         Optional[QuoraConfig]           = None
    facebook:      Optional[FacebookConfig]        = None

    model_config = {"json_schema_extra": {"example": {
        "reddit":      {"keyword": "edtech", "max_posts": 10},
        "twitter":     {"keywords": ["edtech"], "max_tweets": 20},
        "google_news": {"keywords": ["edtech"],},
        "spiceworks":  {"keyword": "network switch", "max_results": 20},
    }}}


class ScheduleRequest(BaseModel):
    """schedule field must NOT be 'manual' — use POST /api/run for one-off runs."""
    reddit:        Optional[RedditConfig]        = None
    tiktok:        Optional[TikTokConfig]         = None
    edugeek:       Optional[EduGeekConfig]        = None
    stackexchange: Optional[StackExchangeConfig]  = None
    autodesk:      Optional[AutodeskConfig]        = None
    twitter:       Optional[TwitterConfig]         = None
    instagram:     Optional[InstagramConfig]       = None
    google_news:   Optional[GoogleNewsConfig]      = None
    spiceworks:    Optional[SpiceworksConfig]      = None
    quora:         Optional[QuoraConfig]           = None
    facebook:      Optional[FacebookConfig]        = None


class RunResponse(BaseModel):
    message:  str
    task_ids: List[str]
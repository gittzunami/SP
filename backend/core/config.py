"""
core/config.py
==============
Centralized application settings — all environment variables in one place.
Replaces scattered os.environ.get() calls across the codebase.
"""

from __future__ import annotations
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ── Auth ──────────────────────────────────────────────────────────────────
    JWT_SECRET: str       = os.environ.get("JWT_SECRET_KEY", "trendsense-dev-secret-change-in-prod")
    JWT_ALGORITHM: str    = "HS256"
    JWT_EXPIRE_H: int     = int(os.environ.get("JWT_EXPIRE_HOURS", "1"))
    LOGIN_USERNAME: str   = os.environ.get("LOGIN_USERNAME", "").strip()
    LOGIN_PASSWORD: str   = os.environ.get("LOGIN_PASSWORD", "").strip()

    # Paths that bypass JWT check
    AUTH_SKIP_EXACT: frozenset = frozenset({
        "/api/auth/login", "/docs", "/openapi.json", "/redoc", "/", "/api/health",
    })
    AUTH_SKIP_PREFIX: tuple = ("/webhook/", "/api/webhook/")

    # ── Budget ────────────────────────────────────────────────────────────────
    DEFAULT_MONTHLY_BUDGET_USD: float = float(os.environ.get("DEFAULT_MONTHLY_BUDGET_USD", "1000"))
    EMAIL_ALERT_THRESHOLD_PCT: int    = int(os.environ.get("EMAIL_ALERT_THRESHOLD_PCT", "77"))

    # ── SMTP alerts ───────────────────────────────────────────────────────────
    ALERT_SMTP_HOST: str = os.environ.get("ALERT_SMTP_HOST", "smtp.gmail.com")
    ALERT_SMTP_PORT: int = int(os.environ.get("ALERT_SMTP_PORT", "587"))
    ALERT_SMTP_USER: str = os.environ.get("ALERT_SMTP_USER", "")
    ALERT_SMTP_PASS: str = os.environ.get("ALERT_SMTP_PASS", "")

    # ── LLM ───────────────────────────────────────────────────────────────────
    PROMPT_ENHANCER_MODEL: str = os.environ.get("PROMPT_ENHANCER_MODEL", "gpt-4o-mini")
    PROMPT_ENHANCER_KEY: str   = os.environ.get("PROMPT_ENHANCER_KEY", "")

    # ── Webhooks & URLs ───────────────────────────────────────────────────────
    WEBHOOK_URL: str                    = os.environ.get("WEBHOOK_URL", "").rstrip("/")
    NEWSLETTER_ACTIONS_WEBHOOK_URL: str = os.environ.get("NEWSLETTER_ACTIONS_WEBHOOK_URL", "").rstrip("/")
    BACKEND_URL: str                    = os.environ.get("BACKEND_URL", "").rstrip("/")
    FRONTEND_URL: str                   = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")


    # ── Scraper API keys ──────────────────────────────────────────────────────
    APIFY_API_TOKEN: str     = os.environ.get("APIFY_API_TOKEN", "")
    GETXAPI_KEY: str         = os.environ.get("GETXAPI_KEY", "")
    SCRAPPA_API_KEY: str     = os.environ.get("SCRAPPA_API_KEY", "")
    SCRAPECREATORS_KEY: str  = os.environ.get("SCRAPECREATORS_KEY", "")
    SCRAPINGBEE_KEY: str     = os.environ.get("SCRAPINGBEE_KEY", "")
    STACKAPPS_KEY: str       = os.environ.get("STACKAPPS_KEY", "")
    SCRAPEDO_KEY: str        = os.environ.get("SCRAPEDO_KEY", "")

    # ── Mailchimp ─────────────────────────────────────────────────────────────
    MAILCHIMP_API_KEY: str       = os.environ.get("MAILCHIMP_API_KEY", "").strip()
    MAILCHIMP_SERVER_PREFIX: str = os.environ.get("MAILCHIMP_SERVER_PREFIX", "").strip()
    MAILCHIMP_AUDIENCE_ID: str   = os.environ.get("MAILCHIMP_AUDIENCE_ID", "").strip()
    MAILCHIMP_FROM_NAME: str     = os.environ.get("MAILCHIMP_FROM_NAME", "TrendSense Newsletter").strip()
    MAILCHIMP_FROM_EMAIL: str    = os.environ.get("MAILCHIMP_FROM_EMAIL", "").strip()


settings = Settings()

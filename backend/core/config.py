"""
core/config.py
==============
Centralized application settings — all environment variables in one place.
Replaces scattered os.environ.get() calls across the codebase.
"""

from __future__ import annotations
import os


class Settings:
    # ── Auth ──────────────────────────────────────────────────────────────────
    JWT_SECRET: str       = os.environ.get("JWT_SECRET_KEY", "trendsense-dev-secret-change-in-prod")
    JWT_ALGORITHM: str    = "HS256"
    JWT_EXPIRE_H: int     = int(os.environ.get("JWT_EXPIRE_HOURS", "8"))
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

    # ── Webhooks ──────────────────────────────────────────────────────────────
    WEBHOOK_URL: str  = os.environ.get("WEBHOOK_URL", "")
    BACKEND_URL: str  = os.environ.get("BACKEND_URL", "")

    # ── Scraper API keys ──────────────────────────────────────────────────────
    APIFY_API_TOKEN: str     = os.environ.get("APIFY_API_TOKEN", "")
    GETXAPI_KEY: str         = os.environ.get("GETXAPI_KEY", "")
    SCRAPPA_API_KEY: str     = os.environ.get("SCRAPPA_API_KEY", "")
    SCRAPECREATORS_KEY: str  = os.environ.get("SCRAPECREATORS_KEY", "")
    SCRAPINGBEE_KEY: str     = os.environ.get("SCRAPINGBEE_KEY", "")
    STACKAPPS_KEY: str       = os.environ.get("STACKAPPS_KEY", "")
    SCRAPEDO_KEY: str        = os.environ.get("SCRAPEDO_KEY", "")


settings = Settings()

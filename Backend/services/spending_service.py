"""
spending_service.py
===================
Records API spending and provides budget status for Cost Governance.
Includes per-scraper budget tracking and alert emails.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger("spending_service")

# ── Default fallback cost rates (used only if DB has no config row) ───────────
_DEFAULT_APIFY_COST_PER_CU = float(os.environ.get("APIFY_COST_PER_CU", "0.004"))

APIFY_SCRAPERS = {"instagram"}

# Active scrapers only — tiktok and instagram excluded (backend exists, not in use)
_ALL_SCRAPERS = {
    "reddit", "edugeek", "stackexchange", "autodesk",
    "twitter", "google_news", "spiceworks", "quora", "facebook",
}

# Maps scraper key to its .env rate variable
_SCRAPER_RATE_ENV = {
    "google_news":   "GOOGLE_NEWS_COST_RATE",
    "twitter":       "TWITTER_COST_RATE",
    "instagram":     "INSTAGRAM_COST_RATE",
    "reddit":        "REDDIT_COST_RATE",
    "stackexchange": "STACKEXCHANGE_COST_RATE",
    "autodesk":      "AUTODESK_COST_RATE",
    "edugeek":       "EDUGEEK_COST_RATE",
    "tiktok":        "TIKTOK_COST_RATE",
    "spiceworks":    "SPICEWORKS_COST_RATE",   # Scrape.do: ~$0.0008/request by default
    "quora":         "QUORA_COST_RATE",        # Scrappa + Scrape.do combined
    "facebook":      "FACEBOOK_COST_RATE",     # ScrapeCreators: e.g. 6/1000
}


def _parse_rate(env_var: str):
    """
    Reads an env var like '11/1000' and returns (cost_value, cost_per).
    Returns (None, None) if empty or invalid.
    """
    raw = os.environ.get(env_var, "").strip()
    if not raw:
        return None, None
    try:
        if "/" in raw:
            parts = raw.split("/")
            return float(parts[0]), int(parts[1])
        else:
            return float(raw), None
    except Exception:
        logger.warning("Invalid cost rate format for %s: '%s'", env_var, raw)
        return None, None


def _calc_cost(scraper: str, items_count: int, apify_cu: float = 0.0) -> tuple:
    """
    Returns (cost_usd, is_estimated, cost_mode).
    Priority: .env rate → Apify compute-unit estimation → free.
    """
    env_var = _SCRAPER_RATE_ENV.get(scraper)
    cost_value, cost_per = _parse_rate(env_var) if env_var else (None, None)

    if cost_value is not None and cost_per is not None:
        return round((cost_value / cost_per) * items_count, 6), True, "per_item"
    if cost_value is not None:
        return round(cost_value, 6), True, "per_run"

    if scraper in APIFY_SCRAPERS:
        cost_usd = round(apify_cu * _DEFAULT_APIFY_COST_PER_CU, 6)
        return cost_usd, (apify_cu == 0), "apify_real"

    return 0.0, False, "free"

# Tracks the budget_usd in effect when the last alert was sent per scraper+level.
# Keyed by "{scraper}:{level}" → budget_usd_at_send (float).
# If the budget is modified, the stored value won't match the current budget,
# so the alert fires again automatically.
_scraper_alert_sent: dict = {}


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _record(db, *, provider, service, operation, scraper, task_id,
            cost_usd, cost_units, is_estimated, items_count, keyword) -> float:
    if db is None:
        return 0.0
    try:
        from db_models import ApiSpending
        row = ApiSpending(
            provider     = provider,
            service      = service,
            operation    = operation,
            scraper      = scraper,
            task_id      = task_id or "",
            cost_usd     = cost_usd,
            cost_units   = cost_units,
            is_estimated = is_estimated,
            items_count  = items_count,
            keyword      = (keyword or "")[:255],
            called_at    = _now(),
        )
        db.add(row)
        db.commit()
        logger.info("Spend recorded: %.4f USD  provider=%s  scraper=%s", cost_usd, provider, scraper)
        return cost_usd
    except Exception as exc:
        logger.error("Failed to record spend (%s): %s", scraper, exc)
        try:
            db.rollback()
        except Exception:
            pass
        return 0.0


# ── Public recording functions ────────────────────────────────────────────────

def record_apify_spend(db, scraper: str, service_label: str, operation: str,
                       run_result: dict, items_count: int,
                       keyword: str = "", task_id: str = "") -> float:
    run    = run_result or {}
    stats  = run.get("stats", {}) or {}
    cu     = float(stats.get("computeUnits", 0) or 0)

    # .env rate takes priority (e.g. GOOGLE_NEWS_COST_RATE=11/1000).
    # Falls back to usageTotalUsd for standard compute-unit actors,
    # then to compute-unit estimation if neither is available.
    env_var    = _SCRAPER_RATE_ENV.get(scraper)
    env_val, _ = _parse_rate(env_var) if env_var else (None, None)

    if env_val is not None:
        cost_usd, is_estimated, _ = _calc_cost(scraper, items_count, apify_cu=cu)
    else:
        actual_usd = float(run.get("usageTotalUsd", 0) or 0)
        if actual_usd > 0:
            cost_usd, is_estimated = round(actual_usd, 6), False
        else:
            cost_usd, is_estimated, _ = _calc_cost(scraper, items_count, apify_cu=cu)

    return _record(
        db=db, provider="apify", service=service_label, operation=operation,
        scraper=scraper, task_id=task_id, cost_usd=cost_usd, cost_units=cu,
        is_estimated=is_estimated, items_count=items_count, keyword=keyword,
    )


def record_scrappa_spend(db, requests_made: int, articles_found: int,
                          keyword: str = "", task_id: str = "") -> float:
    """
    Scrappa.co (Google News) cost: $0.30/1K requests + 5% margin = $0.315/1K.
    Env var format: SCRAPPA_COST_PER_1K_REQUESTS=0.30/1000
    """
    MARGIN               = 0.05
    cost_value, cost_per = _parse_rate("SCRAPPA_COST_PER_1K_REQUESTS")
    if cost_value is not None and cost_per is not None:
        cost_per_req = cost_value / cost_per
    else:
        cost_per_req = 0.30 / 1000   # fallback: $0.30/1K
    cost_usd     = round(requests_made * cost_per_req * (1 + MARGIN), 6)
    is_estimated = requests_made == 0

    return _record(
        db=db, provider="scrappa", service="Scrappa.co (Google News)",
        operation="google_news_scrape", scraper="google_news", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(requests_made),
        is_estimated=is_estimated, items_count=articles_found, keyword=keyword,
    )


def record_getxapi_spend(db, calls_made: int, tweets_collected: int,
                          keyword: str = "", task_id: str = "") -> float:
    """
    GetXAPI (Twitter / X) cost: $0.001/call + 3% margin = $0.05/1,000 tweets.
    If TWITTER_COST_RATE env var is set (e.g. '0.05/1000') it overrides the
    per-call calculation and uses a per-tweet rate instead.
    """
    _GETXAPI_COST_PER_CALL = 0.001
    _MARGIN                = 0.03

    env_var    = _SCRAPER_RATE_ENV.get("twitter")
    env_val, cost_per = _parse_rate(env_var) if env_var else (None, None)

    if env_val is not None and cost_per is not None:
        # Per-tweet rate override (e.g. 0.05/1000)
        cost_usd     = round((env_val / cost_per) * tweets_collected * (1 + _MARGIN), 6)
        is_estimated = True
    else:
        # Exact per-call cost with margin
        cost_usd     = round(calls_made * _GETXAPI_COST_PER_CALL * (1 + _MARGIN), 6)
        is_estimated = calls_made == 0

    return _record(
        db=db, provider="getxapi", service="GetXAPI (Twitter / X)",
        operation="twitter_scrape", scraper="twitter", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(calls_made),
        is_estimated=is_estimated, items_count=tweets_collected, keyword=keyword,
    )


def record_scrapecreators_spend(db, items_count: int,
                                 keyword: str = "", task_id: str = "") -> float:
    cost_usd, is_estimated, _ = _calc_cost("tiktok", items_count)
    return _record(
        db=db, provider="scrapecreators", service="ScrapeCreators (TikTok)",
        operation="tiktok_scrape", scraper="tiktok", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(items_count), is_estimated=is_estimated,
        items_count=items_count, keyword=keyword,
    )


def record_scrapingbee_spend(db, pages_fetched: int,
                              keyword: str = "", task_id: str = "") -> float:
    cost_usd, is_estimated, _ = _calc_cost("edugeek", pages_fetched)
    return _record(
        db=db, provider="scrapingbee", service="ScrapingBee (EduGeek)",
        operation="edugeek_scrape", scraper="edugeek", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(pages_fetched), is_estimated=is_estimated,
        items_count=pages_fetched, keyword=keyword,
    )


def record_reddit_spend(db, items_count: int,
                         keyword: str = "", task_id: str = "") -> float:
    # Per-request cost: REDDIT_COST_RATE (e.g. 1.16/1000) × items fetched
    per_req_cost, is_estimated, _ = _calc_cost("reddit", items_count)

    # Per-call flat overhead: REDDIT_COST_PER_CALL (e.g. 0.00116)
    # Covers the one Reddit search API call made per scraper invocation (~10 scrape.do credits)
    try:
        per_call_cost = float(os.environ.get("REDDIT_COST_PER_CALL", "0").strip() or "0")
    except ValueError:
        per_call_cost = 0.0

    total_cost = round(per_req_cost + per_call_cost, 6)

    return _record(
        db=db, provider="scrapedo", service="Reddit (Public JSON + Scrape.do Proxy)",
        operation="reddit_scrape", scraper="reddit", task_id=task_id,
        cost_usd=total_cost, cost_units=float(items_count), is_estimated=is_estimated,
        items_count=items_count, keyword=keyword,
    )


def record_autodesk_spend(db, items_count: int,
                           keyword: str = "", task_id: str = "") -> float:
    cost_usd, is_estimated, _ = _calc_cost("autodesk", items_count)
    return _record(
        db=db, provider="autodesk_liql", service="Autodesk LiQL",
        operation="autodesk_scrape", scraper="autodesk", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(items_count), is_estimated=is_estimated,
        items_count=items_count, keyword=keyword,
    )


def record_quora_spend(db, items_count: int,
                        keyword: str = "", task_id: str = "") -> float:
    """
    Quora uses Scrappa (URL discovery) + Scrape.do (JS rendering, super=true residential).
    Set QUORA_COST_RATE in .env (e.g. '0.002/1') to assign a cost per question fetched.
    """
    cost_usd, is_estimated, _ = _calc_cost("quora", items_count)
    return _record(
        db=db, provider="scrapedo", service="Quora (Scrappa + Scrape.do)",
        operation="quora_scrape", scraper="quora", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(items_count), is_estimated=is_estimated,
        items_count=items_count, keyword=keyword,
    )


def record_spiceworks_spend(db, items_count: int,
                             keyword: str = "", task_id: str = "") -> float:
    """
    Spiceworks uses Scrape.do API.
    Set SPICEWORKS_COST_RATE in .env to assign a cost per item (e.g. '0.0008/1').
    """
    cost_usd, is_estimated, _ = _calc_cost("spiceworks", items_count)
    return _record(
        db=db, provider="scrapedo", service="Spiceworks (Scrape.do)",
        operation="spiceworks_scrape", scraper="spiceworks", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(items_count), is_estimated=is_estimated,
        items_count=items_count, keyword=keyword,
    )


def record_facebook_spend(db, items_count: int,
                           keyword: str = "", task_id: str = "") -> float:
    """
    Facebook Groups uses ScrapeCreators API.
    Set FACEBOOK_COST_RATE in .env (e.g. '6/1000' for $6 per 1000 results).
    """
    cost_usd, is_estimated, _ = _calc_cost("facebook", items_count)
    return _record(
        db=db, provider="scrapecreators", service="ScrapeCreators (Facebook Groups)",
        operation="facebook_scrape", scraper="facebook", task_id=task_id,
        cost_usd=cost_usd, cost_units=float(items_count), is_estimated=is_estimated,
        items_count=items_count, keyword=keyword,
    )


# ── Per-scraper budget CRUD ───────────────────────────────────────────────────

def save_scraper_budgets(db, budgets: dict) -> None:
    """Save per-scraper budget allocations."""
    if db is None:
        return
    try:
        from db_models import ScraperBudget
        for scraper, amount in budgets.items():
            row = db.query(ScraperBudget).filter_by(scraper=scraper).first()
            if row:
                row.budget_usd = float(amount)
                row.updated_at = _now()
            else:
                db.add(ScraperBudget(
                    scraper    = scraper,
                    budget_usd = float(amount),
                    updated_at = _now(),
                ))
        db.commit()
        logger.info("Scraper budgets saved: %s", budgets)
    except Exception as exc:
        logger.error("save_scraper_budgets failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


def get_scraper_budget_status(db) -> dict:
    """
    Returns per-scraper spend vs budget + block/warning flags.
    Also fires alert emails when thresholds are crossed.
    """
    if db is None:
        return {}
    try:
        from db_models import ApiSpending, ScraperBudget
        from sqlalchemy import func

        now         = _now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # Monthly spend per scraper
        spend_rows = (
            db.query(
                ApiSpending.scraper,
                func.sum(ApiSpending.cost_usd).label("spent"),
            )
            .filter(ApiSpending.called_at >= month_start)
            .group_by(ApiSpending.scraper)
            .all()
        )
        spend_map = {r.scraper: float(r.spent or 0) for r in spend_rows}

        # Budget allocations from DB
        budget_rows = db.query(ScraperBudget).all()
        budget_map  = {r.scraper: r.budget_usd for r in budget_rows}

        result = {}
        all_scrapers = _ALL_SCRAPERS | set(spend_map.keys()) | set(budget_map.keys())

        for scraper in all_scrapers:
            spent      = spend_map.get(scraper, 0.0)
            budget     = budget_map.get(scraper, 0.0)
            no_budget  = budget <= 0
            pct        = (spent / budget * 100) if budget > 0 else 0.0
            is_blocked = no_budget or pct >= 97.0
            is_warning = not is_blocked and pct >= 77.0

            result[scraper] = {
                "spent_usd":  round(spent,  4),
                "budget_usd": round(budget, 2),
                "pct":        round(pct,    1),
                "is_blocked": is_blocked,
                "is_warning": is_warning,
                "no_budget":  no_budget,
            }

            # Fire alert email only when the user has set a budget and crossed a threshold
            if not no_budget and (is_warning or is_blocked):
                _maybe_send_scraper_alert(db, scraper, pct, is_blocked, budget)

        return result

    except Exception as exc:
        logger.error("get_scraper_budget_status failed: %s", exc)
        return {}


def _maybe_send_scraper_alert(db, scraper: str, pct: float,
                               is_blocked: bool, budget_usd: float) -> None:
    """Send email alert once per session when scraper crosses 77% or 97%."""
    level     = "blocked" if is_blocked else "warning"
    cache_key = f"{scraper}:{level}"

    if _scraper_alert_sent.get(cache_key) == budget_usd:
        return  # already sent for this exact budget — skip to avoid spam

    try:
        from db_models import BudgetAlertEmail
        emails = [r.email for r in db.query(BudgetAlertEmail).all()]
        if not emails:
            # Don't cache — retry next poll once emails are configured
            logger.info("Scraper alert skipped for %s (no emails configured yet)", scraper)
            return

        smtp_host = os.environ.get("ALERT_SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.environ.get("ALERT_SMTP_PORT", "587"))
        smtp_user = os.environ.get("ALERT_SMTP_USER", "")
        smtp_pass = os.environ.get("ALERT_SMTP_PASS", "")

        if not smtp_user or not smtp_pass:
            logger.warning("SMTP not configured — skipping scraper alert for %s", scraper)
            return  # Don't cache — retry once SMTP is configured

        color   = "#ef4444" if is_blocked else "#f59e0b"
        heading = "🚫 Collection Blocked" if is_blocked else "⚠️ Budget Warning"
        subject = (
            f"🚫 {scraper.upper()} collection BLOCKED — {pct:.1f}% budget used"
            if is_blocked else
            f"⚠️ {scraper.upper()} collection warning — {pct:.1f}% of budget used"
        )
        action = (
            "The collection is now <strong>blocked</strong> until you increase its budget allocation."
            if is_blocked else
            "The collection continues running but is approaching its limit."
        )

        body_html = f"""
        <html><body style="font-family:sans-serif;background:#0a0e17;color:#e2e8f0;padding:24px">
          <div style="max-width:520px;margin:0 auto;background:#111827;border-radius:12px;
                      border:1px solid #1e293b;padding:32px">
            <h2 style="color:{color};margin-top:0">{heading}</h2>
            <p>The <strong>{scraper.upper()}</strong> collection has reached
               <strong style="color:#f97316">{pct:.1f}%</strong> of its
               <strong>${budget_usd:,.2f}</strong> monthly allocation.</p>
            <p>{action}</p>
            <hr style="border-color:#1e293b;margin:24px 0"/>
            <p style="color:#64748b;font-size:0.85rem">
              Manage allocations at
              <strong>Cost Governance → Modifications → Budget Per Source</strong>.
            </p>
          </div>
        </body></html>
        """

        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_pass)
            for recipient in emails:
                msg = MIMEMultipart("alternative")
                msg["Subject"] = subject
                msg["From"]    = f"TrendSense Alerts <{smtp_user}>"
                msg["To"]      = recipient
                msg.attach(MIMEText(body_html, "html"))
                server.sendmail(smtp_user, recipient, msg.as_string())

        _scraper_alert_sent[cache_key] = budget_usd  # store budget — re-fires if budget changes
        logger.info("Scraper alert email sent for %s (%s) budget=%.2f", scraper, level, budget_usd)

    except Exception as exc:
        logger.error("Scraper alert email failed for %s: %s", scraper, exc)


# ── Dashboard summary ─────────────────────────────────────────────────────────

def get_spending_summary(db) -> dict:
    if db is None:
        return _empty_summary()

    try:
        from db_models import ApiSpending, UserBudget
        from sqlalchemy import func
        import calendar

        now         = _now()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        today_usd = float(
            db.query(func.coalesce(func.sum(ApiSpending.cost_usd), 0))
              .filter(ApiSpending.called_at >= today_start).scalar() or 0.0
        )

        week_ago = today_start - timedelta(days=7)
        week_usd = float(
            db.query(func.coalesce(func.sum(ApiSpending.cost_usd), 0))
              .filter(ApiSpending.called_at >= week_ago,
                      ApiSpending.called_at < today_start).scalar() or 0.0
        )
        daily_avg_7d    = week_usd / 7.0 if week_usd > 0 else 0.0
        today_vs_7d_pct = (
            round(((today_usd - daily_avg_7d) / daily_avg_7d) * 100, 1)
            if daily_avg_7d > 0 else 0.0
        )

        month_usd = float(
            db.query(func.coalesce(func.sum(ApiSpending.cost_usd), 0))
              .filter(ApiSpending.called_at >= month_start).scalar() or 0.0
        )

        days_in_month   = calendar.monthrange(now.year, now.month)[1]
        days_elapsed    = max(now.day, 1)
        month_projected = round((month_usd / days_elapsed) * days_in_month, 2) if month_usd > 0 else 0.0

        budget_row          = db.query(UserBudget).filter_by(id=1).first()
        budget_usd          = budget_row.monthly_limit_usd   if budget_row else 1000.0
        alert_threshold_pct = budget_row.alert_threshold_pct if budget_row else 80

        svc_rows = (
            db.query(
                ApiSpending.service,
                ApiSpending.provider,
                func.sum(ApiSpending.cost_usd).label("month_usd"),
            )
            .filter(ApiSpending.called_at >= month_start)
            .group_by(ApiSpending.service, ApiSpending.provider)
            .order_by(func.sum(ApiSpending.cost_usd).desc())
            .all()
        )

        SERVICE_CAPS = {
            "apify":          budget_usd * 0.40,
            "scrapecreators": budget_usd * 0.15,
            "scrapingbee":    budget_usd * 0.15,
            "reddit_public":  budget_usd * 0.10,
            "autodesk_liql":  budget_usd * 0.10,
            "stackapps":      0.0,
        }
        service_breakdown = [
            {
                "service":   row.service,
                "provider":  row.provider,
                "month_usd": round(float(row.month_usd), 4),
                "cap_usd":   round(SERVICE_CAPS.get(row.provider, budget_usd * 0.25), 2),
            }
            for row in svc_rows
        ]

        high_cost_rows = (
            db.query(ApiSpending)
              .filter(ApiSpending.cost_usd >= 5.0)
              .order_by(ApiSpending.called_at.desc())
              .limit(10).all()
        )
        recent_high_cost = [
            {
                "job_id":       (row.task_id or "")[:8].upper() or f"OP-{row.id}",
                "service":      row.service,
                "scraper":      row.scraper,
                "cost_usd":     round(row.cost_usd, 4),
                "items":        row.items_count,
                "is_estimated": row.is_estimated,
                "called_at":    row.called_at.isoformat() if row.called_at else "",
            }
            for row in high_cost_rows
        ]

        # Per-scraper budget status
        scraper_budgets = get_scraper_budget_status(db)

        return {
            "today_usd":           round(today_usd,   4),
            "today_vs_7d_avg_pct": today_vs_7d_pct,
            "month_usd":           round(month_usd,   4),
            "month_projected_usd": month_projected,
            "budget_usd":          budget_usd,
            "alert_threshold_pct": alert_threshold_pct,
            "budget_used_pct":     round((month_usd / budget_usd * 100), 1) if budget_usd > 0 else 0.0,
            "service_breakdown":   service_breakdown,
            "recent_high_cost":    recent_high_cost,
            "scraper_budgets":     scraper_budgets,
        }

    except Exception as exc:
        logger.error("get_spending_summary failed: %s", exc)
        return _empty_summary()


def _empty_summary() -> dict:
    return {
        "today_usd":           0.0,
        "today_vs_7d_avg_pct": 0.0,
        "month_usd":           0.0,
        "month_projected_usd": 0.0,
        "budget_usd":          1000.0,
        "alert_threshold_pct": 80,
        "budget_used_pct":     0.0,
        "service_breakdown":   [],
        "recent_high_cost":    [],
        "scraper_budgets":     {},
    }
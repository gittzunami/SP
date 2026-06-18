"""api/routers/spending.py — Cost governance endpoints."""

from __future__ import annotations

import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.config import settings
from database import get_db

logger = logging.getLogger("spending")
router = APIRouter(prefix="/api/spending", tags=["Cost"])

VALID_SCRAPERS = frozenset({
    "reddit", "tiktok", "edugeek", "stackexchange", "autodesk",
    "twitter", "instagram", "google_news", "spiceworks", "quora", "facebook",
})


# ── Overall budget ────────────────────────────────────────────────────────────

@router.get("/summary")
def spending_summary(db: Session = Depends(get_db)):
    from services.spending_service import get_spending_summary
    try:
        return get_spending_summary(db)
    except Exception as exc:
        import traceback
        logger.error("spending_summary error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"spending_summary error: {exc}")


@router.get("/budget")
def get_budget(db: Session = Depends(get_db)):
    from db_models import UserBudget
    row = db.query(UserBudget).filter_by(id=1).first()
    if not row:
        return {
            "monthly_limit_usd":   settings.DEFAULT_MONTHLY_BUDGET_USD,
            "alert_threshold_pct": 80,
        }
    return {
        "monthly_limit_usd":   row.monthly_limit_usd,
        "alert_threshold_pct": row.alert_threshold_pct,
    }


@router.post("/budget")
def set_budget(body: Dict[str, Any], db: Session = Depends(get_db)):
    from db_models import UserBudget
    limit     = float(body.get("monthly_limit_usd", 1000.0))
    threshold = int(body.get("alert_threshold_pct", 80))
    if limit <= 0:
        raise HTTPException(400, "monthly_limit_usd must be positive")
    if not (1 <= threshold <= 100):
        raise HTTPException(400, "alert_threshold_pct must be 1–100")
    row = db.query(UserBudget).filter_by(id=1).first()
    if row:
        row.monthly_limit_usd   = limit
        row.alert_threshold_pct = threshold
        row.updated_at          = datetime.now(tz=timezone.utc)
    else:
        db.add(UserBudget(
            id=1, monthly_limit_usd=limit,
            alert_threshold_pct=threshold,
            updated_at=datetime.now(tz=timezone.utc),
        ))
    db.commit()
    return {"status": "ok", "monthly_limit_usd": limit, "alert_threshold_pct": threshold}


# ── Per-scraper budgets ───────────────────────────────────────────────────────

@router.get("/scraper-budgets", summary="Get all per-scraper budget allocations with spend status")
def get_scraper_budgets(db: Session = Depends(get_db)):
    from services.spending_service import get_scraper_budget_status
    return get_scraper_budget_status(db)


@router.post("/scraper-budgets", summary="Save per-scraper budget allocations")
def set_scraper_budgets(body: Dict[str, Any], db: Session = Depends(get_db)):
    from db_models import ScraperBudget, UserBudget, ApiSpending
    from sqlalchemy import func as _func

    budgets = body.get("budgets", {})
    if not isinstance(budgets, dict):
        raise HTTPException(400, "'budgets' must be an object mapping scraper → amount")

    overall_row    = db.query(UserBudget).filter_by(id=1).first()
    overall_budget = overall_row.monthly_limit_usd if overall_row else settings.DEFAULT_MONTHLY_BUDGET_USD
    total_alloc    = sum(float(v or 0) for v in budgets.values())

    if total_alloc > overall_budget + 0.01:
        raise HTTPException(
            400,
            f"Total allocation ${total_alloc:.2f} exceeds the overall monthly budget "
            f"${overall_budget:.2f}. Please reduce allocations or increase the overall budget.",
        )

    month_start = datetime.now(tz=timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    violations = []
    for scraper, amount in budgets.items():
        if scraper not in VALID_SCRAPERS:
            continue
        amount_f = float(amount or 0)
        if amount_f <= 0:
            continue
        spent = float(
            db.query(_func.coalesce(_func.sum(ApiSpending.cost_usd), 0))
              .filter(ApiSpending.scraper == scraper, ApiSpending.called_at >= month_start)
              .scalar() or 0.0
        )
        if amount_f < spent:
            violations.append(
                f"{scraper}: cannot set ${amount_f:.2f} — already spent ${spent:.4f} this month"
            )
    if violations:
        raise HTTPException(400, "Budget below current spend: " + "; ".join(violations))

    now = datetime.now(tz=timezone.utc)
    for scraper, amount in budgets.items():
        if scraper not in VALID_SCRAPERS:
            continue
        amount = float(amount or 0)
        row = db.query(ScraperBudget).filter_by(scraper=scraper).first()
        if row:
            row.budget_usd = amount
            row.updated_at = now
        else:
            db.add(ScraperBudget(scraper=scraper, budget_usd=amount, updated_at=now))

    db.commit()
    return {"status": "ok", "budgets": budgets, "total_allocated": round(total_alloc, 2)}


@router.get("/scraper-status", summary="Per-scraper budget usage and block status")
def scraper_budget_status(db: Session = Depends(get_db)):
    from services.spending_service import get_scraper_budget_status
    return {"scrapers": get_scraper_budget_status(db)}


# ── Cost config ───────────────────────────────────────────────────────────────

@router.get("/cost-config", summary="Get per-scraper cost rate configuration")
def get_cost_config(db: Session = Depends(get_db)):
    from db_models import ScraperCostConfig
    rows   = db.query(ScraperCostConfig).all()
    config = {r.scraper: {
        "cost_mode":  r.cost_mode,
        "cost_value": r.cost_value,
        "cost_per":   r.cost_per,
    } for r in rows}
    APIFY_SCRAPERS = {"instagram"}
    for scraper in VALID_SCRAPERS:
        if scraper not in config:
            config[scraper] = {
                "cost_mode":  "apify_real" if scraper in APIFY_SCRAPERS else "free",
                "cost_value": None,
                "cost_per":   None,
            }
    return config


@router.post("/cost-config", summary="Save per-scraper cost rate configuration")
def set_cost_config(body: Dict[str, Any], db: Session = Depends(get_db)):
    from db_models import ScraperCostConfig
    now     = datetime.now(tz=timezone.utc)
    configs = body.get("configs", {})
    if not isinstance(configs, dict):
        raise HTTPException(400, "'configs' must be an object mapping scraper → config")

    for scraper, cfg in configs.items():
        if scraper not in VALID_SCRAPERS:
            continue
        cost_mode  = cfg.get("cost_mode", "free")
        cost_value = cfg.get("cost_value")
        cost_per   = cfg.get("cost_per")

        if cost_mode not in ("apify_real", "per_item", "per_run", "free"):
            raise HTTPException(400, f"Invalid cost_mode '{cost_mode}' for {scraper}")

        cost_value = float(cost_value) if cost_value not in (None, "") else None
        cost_per   = int(cost_per)     if cost_per   not in (None, "") else None

        row = db.query(ScraperCostConfig).filter_by(scraper=scraper).first()
        if row:
            row.cost_mode  = cost_mode
            row.cost_value = cost_value
            row.cost_per   = cost_per
            row.updated_at = now
        else:
            db.add(ScraperCostConfig(
                scraper=scraper, cost_mode=cost_mode,
                cost_value=cost_value, cost_per=cost_per, updated_at=now,
            ))
    db.commit()
    return {"status": "ok", "saved": list(configs.keys())}


# ── History, emails, alerts ───────────────────────────────────────────────────

@router.get("/history")
def spending_history(
    limit:  int = Query(50, le=200),
    offset: int = Query(0),
    db:     Session = Depends(get_db),
):
    from db_models import ApiSpending
    total = db.query(ApiSpending).count()
    rows  = (
        db.query(ApiSpending)
          .order_by(ApiSpending.called_at.desc())
          .offset(offset).limit(limit).all()
    )
    return {
        "total": total,
        "rows": [
            {
                "id": r.id, "provider": r.provider, "service": r.service,
                "operation": r.operation, "scraper": r.scraper, "task_id": r.task_id,
                "cost_usd": r.cost_usd, "cost_units": r.cost_units,
                "is_estimated": r.is_estimated, "items_count": r.items_count,
                "keyword": r.keyword,
                "called_at": r.called_at.isoformat() if r.called_at else None,
            }
            for r in rows
        ],
    }


@router.get("/alert-emails")
def get_alert_emails(db: Session = Depends(get_db)):
    from db_models import BudgetAlertEmail
    rows = db.query(BudgetAlertEmail).order_by(BudgetAlertEmail.added_at).all()
    return {"emails": [r.email for r in rows]}


@router.post("/alert-emails")
def save_alert_emails(body: Dict[str, Any], db: Session = Depends(get_db)):
    from db_models import BudgetAlertEmail
    emails = body.get("emails", [])
    if not isinstance(emails, list):
        raise HTTPException(400, "emails must be a list")
    db.query(BudgetAlertEmail).delete()
    for email in emails:
        email = email.strip().lower()
        if email:
            db.add(BudgetAlertEmail(email=email, added_at=datetime.now(tz=timezone.utc)))
    db.commit()
    return {"status": "ok", "emails": emails}


@router.post("/trigger-alert")
def trigger_budget_alert(body: Dict[str, Any], db: Session = Depends(get_db)):
    from db_models import UserBudget, BudgetAlertEmail

    budget_pct = float(body.get("budget_pct", 0))
    alert_type = body.get("alert_type", "warning")
    is_blocked = alert_type == "blocked"

    row        = db.query(UserBudget).filter_by(id=1).first()
    budget_usd = row.monthly_limit_usd if row else settings.DEFAULT_MONTHLY_BUDGET_USD
    emails     = [r.email for r in db.query(BudgetAlertEmail).all()]

    if not emails:
        return {"status": "no_recipients"}

    if not settings.ALERT_SMTP_USER or not settings.ALERT_SMTP_PASS:
        return {"status": "smtp_not_configured", "would_have_sent_to": emails}

    color   = "#dc2626" if is_blocked else "#d97706"
    icon    = "🚫" if is_blocked else "⚠️"
    subject = f"{icon} Overall Budget {'BLOCKED' if is_blocked else 'Warning'} — {budget_pct:.1f}% used"
    action  = (
        "All scrapers have been <strong>permanently blocked</strong>. Increase your budget to resume."
        if is_blocked else
        "Scrapers are still running. They will be blocked at 100%."
    )

    html = f"""
    <html><body style="font-family:sans-serif;background:#0a0e17;color:#e2e8f0;padding:24px">
      <div style="max-width:540px;margin:0 auto;background:#111827;border-radius:12px;
                  border:2px solid {color};padding:32px">
        <h2 style="color:{color};margin-top:0">{icon} Budget Alert</h2>
        <p>Overall budget is at <strong style="color:{color}">{budget_pct:.1f}%</strong>
           of <strong>${budget_usd:,.2f}</strong> monthly limit.</p>
        <p>{action}</p>
        <hr style="border-color:#1e293b;margin:24px 0"/>
        <p style="color:#64748b;font-size:0.8rem">
          Manage at <strong>Cost Governance → Modifications</strong>
        </p>
      </div>
    </body></html>
    """

    sent, failed = [], []
    try:
        with smtplib.SMTP(settings.ALERT_SMTP_HOST, settings.ALERT_SMTP_PORT, timeout=15) as srv:
            srv.ehlo(); srv.starttls(); srv.ehlo()
            srv.login(settings.ALERT_SMTP_USER, settings.ALERT_SMTP_PASS)
            for recipient in emails:
                try:
                    msg = MIMEMultipart("alternative")
                    msg["Subject"] = subject
                    msg["From"]    = f"TrendSense Alerts <{settings.ALERT_SMTP_USER}>"
                    msg["To"]      = recipient
                    msg.attach(MIMEText(html, "html"))
                    srv.sendmail(settings.ALERT_SMTP_USER, recipient, msg.as_string())
                    sent.append(recipient)
                except Exception as exc:
                    failed.append({"email": recipient, "error": str(exc)})
    except smtplib.SMTPAuthenticationError:
        return {"status": "smtp_auth_error",
                "error": "Use a Google App Password, not your Gmail password."}
    except Exception as exc:
        return {"status": "smtp_error", "error": str(exc)}

    return {"status": "ok", "alert_type": alert_type, "sent": sent, "failed": failed}


@router.get("/debug")
def spending_debug(db: Session = Depends(get_db)):
    try:
        from db_models import ApiSpending, UserBudget
        rows   = db.query(ApiSpending).order_by(ApiSpending.called_at.desc()).limit(10).all()
        budget = db.query(UserBudget).filter_by(id=1).first()
        return {
            "api_spending_count": db.query(ApiSpending).count(),
            "user_budget": {
                "monthly_limit_usd":   budget.monthly_limit_usd   if budget else None,
                "alert_threshold_pct": budget.alert_threshold_pct if budget else None,
            },
            "last_10_rows": [
                {
                    "id": r.id, "provider": r.provider, "scraper": r.scraper,
                    "cost_usd": r.cost_usd, "keyword": r.keyword,
                    "called_at": r.called_at.isoformat() if r.called_at else None,
                }
                for r in rows
            ],
        }
    except Exception as exc:
        import traceback
        return {"error": str(exc), "traceback": traceback.format_exc()}

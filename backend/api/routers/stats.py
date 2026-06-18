"""api/routers/stats.py — Usage statistics endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db

router = APIRouter(prefix="/api/stats", tags=["Stats"])


@router.get("/24h", summary="Items scraped in last 24h with 7-day comparison")
def stats_24h(db: Session = Depends(get_db)):
    from db_models import ScrapeRun
    from sqlalchemy import func

    now      = datetime.now(tz=timezone.utc)
    h24_ago  = now - timedelta(hours=24)
    week_ago = now - timedelta(days=8)

    today_items = (
        db.query(func.coalesce(func.sum(ScrapeRun.total_items), 0))
          .filter(ScrapeRun.scraped_at >= h24_ago)
          .scalar() or 0
    )
    prev_items = (
        db.query(func.coalesce(func.sum(ScrapeRun.total_items), 0))
          .filter(ScrapeRun.scraped_at >= week_ago, ScrapeRun.scraped_at < h24_ago)
          .scalar() or 0
    )

    daily_avg  = prev_items / 7.0 if prev_items > 0 else 0
    change_pct = None
    if daily_avg > 0:
        change_pct = round(((today_items - daily_avg) / daily_avg) * 100, 1)

    return {
        "total_items":   int(today_items),
        "daily_avg_7d":  round(daily_avg, 1),
        "change_7d_pct": change_pct,
    }


@router.get("/monthly", summary="Items scraped per month (last 12 months) broken down by scraper")
def stats_monthly(db: Session = Depends(get_db)):
    from db_models import ScrapeRun
    from sqlalchemy import func

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=365)

    rows = (
        db.query(
            func.to_char(ScrapeRun.scraped_at, "YYYY-MM").label("month"),
            ScrapeRun.scraper,
            func.coalesce(func.sum(ScrapeRun.total_items), 0).label("total"),
        )
        .filter(ScrapeRun.scraped_at >= cutoff)
        .group_by("month", ScrapeRun.scraper)
        .order_by("month")
        .all()
    )

    month_map: dict = {}
    for row in rows:
        m = row.month
        if m not in month_map:
            month_map[m] = {"month": m, "total": 0}
        month_map[m][row.scraper]  = int(row.total)
        month_map[m]["total"]     += int(row.total)

    result = []
    for m, data in sorted(month_map.items()):
        try:
            label = datetime.strptime(m, "%Y-%m").strftime("%b %Y")
        except Exception:
            label = m
        result.append({**data, "label": label})

    return {"months": result}

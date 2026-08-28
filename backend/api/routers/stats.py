"""api/routers/stats.py — Usage statistics endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db

logger = logging.getLogger("stats")

router = APIRouter(prefix="/api/stats", tags=["Stats"])


def _get_platform_models():
    from db_models import (
        RedditPost, TikTokPost, EduGeekPost, AutodeskPost, StackExchangeQuestion,
        GoogleNewsArticle, InstagramPost, SpiceworksPost, TwitterTweet, QuoraQuestion,
        FacebookPost,
    )
    return [
        ("reddit",        RedditPost,            RedditPost.created_at),
        ("tiktok",        TikTokPost,            TikTokPost.created_at),
        ("edugeek",       EduGeekPost,           EduGeekPost.created_at),
        ("autodesk",      AutodeskPost,          AutodeskPost.created_at),
        ("stackexchange", StackExchangeQuestion, StackExchangeQuestion.created_at),
        ("google_news",   GoogleNewsArticle,     GoogleNewsArticle.scraped_at),
        ("instagram",     InstagramPost,         InstagramPost.timestamp),
        ("spiceworks",    SpiceworksPost,        SpiceworksPost.created_at),
        ("twitter",       TwitterTweet,          TwitterTweet.created_at),
        ("quora",         QuoraQuestion,         QuoraQuestion.scraped_at),
        ("facebook",      FacebookPost,          FacebookPost.created_at),
    ]


@router.get("/24h", summary="Items scraped in last 24h with 7-day comparison")
def stats_24h(db: Session = Depends(get_db)):
    from db_models import ScrapeRun, GoogleNewsArticle
    from sqlalchemy import func

    now      = datetime.now(tz=timezone.utc)
    h24_ago  = now - timedelta(hours=24)
    week_ago = now - timedelta(days=8)

    platforms = _get_platform_models()
    today_items = 0
    prev_items  = 0

    for _, model, date_col in platforms:
        try:
            if model is GoogleNewsArticle:
                t_cnt = db.query(func.count(model.id)).filter(model.scraped_at >= h24_ago).scalar() or 0
                p_cnt = db.query(func.count(model.id)).filter(model.scraped_at >= week_ago, model.scraped_at < h24_ago).scalar() or 0
            else:
                date_expr = func.coalesce(ScrapeRun.scraped_at, date_col)
                t_cnt = (
                    db.query(func.count(model.id))
                    .outerjoin(ScrapeRun, model.run_id == ScrapeRun.id)
                    .filter(date_expr >= h24_ago)
                    .scalar() or 0
                )
                p_cnt = (
                    db.query(func.count(model.id))
                    .outerjoin(ScrapeRun, model.run_id == ScrapeRun.id)
                    .filter(date_expr >= week_ago, date_expr < h24_ago)
                    .scalar() or 0
                )
            today_items += t_cnt
            prev_items  += p_cnt
        except Exception as exc:
            logger.warning("stats_24h failed for model %s: %s", getattr(model, '__name__', str(model)), exc)

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
    from db_models import ScrapeRun, GoogleNewsArticle
    from sqlalchemy import func

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=365)
    platforms = _get_platform_models()
    month_map: dict = {}

    for scraper_name, model, date_col in platforms:
        try:
            if model is GoogleNewsArticle:
                rows = (
                    db.query(
                        func.to_char(model.scraped_at, "YYYY-MM").label("month"),
                        func.count(model.id).label("count")
                    )
                    .filter(model.scraped_at >= cutoff)
                    .group_by("month")
                    .all()
                )
            else:
                date_expr = func.coalesce(ScrapeRun.scraped_at, date_col)
                rows = (
                    db.query(
                        func.to_char(date_expr, "YYYY-MM").label("month"),
                        func.count(model.id).label("count")
                    )
                    .outerjoin(ScrapeRun, model.run_id == ScrapeRun.id)
                    .filter(date_expr >= cutoff)
                    .group_by("month")
                    .all()
                )

            for r in rows:
                if not r.month:
                    continue
                m = r.month
                if m not in month_map:
                    month_map[m] = {"month": m, "total": 0}
                cnt = int(r.count or 0)
                month_map[m][scraper_name] = month_map[m].get(scraper_name, 0) + cnt
                month_map[m]["total"] += cnt
        except Exception as exc:
            logger.warning("stats_monthly failed for %s: %s", scraper_name, exc)

    result = []
    for m, data in sorted(month_map.items()):
        try:
            label = datetime.strptime(m, "%Y-%m").strftime("%b %Y")
        except Exception:
            label = m
        result.append({**data, "label": label})

    return {"months": result}

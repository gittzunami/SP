"""
services/search_service.py
===========================
Full-text keyword search + export across every scraped table.

Key fix: recent_all() now returns the TRUE total count from DB
instead of len(fetched_rows), which was capped at limit*2*8.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_

logger = logging.getLogger("search_service")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _scraped_at_str(db, run_id) -> str:
    if not run_id:
        return ""
    try:
        from db_models import ScrapeRun
        run = db.query(ScrapeRun).filter_by(id=run_id).first()
        return run.scraped_at.isoformat() if run and run.scraped_at else ""
    except Exception:
        return ""


def _run_keyword(db, run_id) -> str:
    if not run_id:
        return ""
    try:
        from db_models import ScrapeRun
        run = db.query(ScrapeRun).filter_by(id=run_id).first()
        return run.keyword or "" if run else ""
    except Exception:
        return ""


def _cutoff_from_range(date_range: str | None) -> datetime | None:
    if not date_range or date_range == "all":
        return None
    now = datetime.now(tz=timezone.utc)
    if date_range == "24h":  return now - timedelta(hours=24)
    if date_range == "7d":   return now - timedelta(days=7)
    if date_range == "30d":  return now - timedelta(days=30)
    return None


# ══════════════════════════════════════════════════════════════════════════════
#  Preview serialisers (truncated body for Results table)
# ══════════════════════════════════════════════════════════════════════════════

def _reddit_comment_dict(c):
    return {
        "id": c.reddit_id, "author": c.author, "body": c.body,
        "score": c.score, "depth": c.depth, "created_at": str(c.created_at),
        "replies": [_reddit_comment_dict(r) for r in (c.replies or [])],
    }

def _reddit_post_preview(r, db=None):
    return {
        "source": "reddit", "id": r.reddit_id, "url": r.url,
        "title": r.title, "body": (r.body or "")[:500],
        "author": r.author, "subreddit": r.subreddit, "score": r.score,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _reddit_post_full(r):
    return {
        "id": r.reddit_id, "url": r.url, "subreddit": r.subreddit,
        "title": r.title, "body": r.body, "flair": r.flair,
        "is_nsfw": r.is_nsfw, "url_content": r.url_content,
        "author": r.author, "score": r.score, "upvote_ratio": r.upvote_ratio,
        "num_comments": r.num_comments, "created_at": str(r.created_at),
        "comments": [_reddit_comment_dict(c) for c in (r.comments or []) if c.depth == 0],
    }

def _tiktok_post_preview(r, db=None):
    return {
        "source": "tiktok", "id": r.tiktok_id, "url": r.url,
        "title": r.title, "author": r.author_username,
        "plays": r.plays, "likes": r.likes,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _tiktok_post_full(r):
    return {
        "id": r.tiktok_id, "url": r.url, "title": r.title,
        "created_at": str(r.created_at),
        "author": {
            "username": r.author_username, "nickname": r.author_nickname,
            "verified": r.author_verified, "followers": r.author_followers,
            "following": r.author_following, "likes": r.author_likes, "bio": r.author_bio,
        },
        "stats": {
            "plays": r.plays, "likes": r.likes, "comments": r.comments_count,
            "shares": r.shares, "saves": r.saves,
        },
        "video": {"duration_sec": r.duration_sec},
        "music": {"title": r.music_title, "artist": r.music_artist},
        "hashtags": r.hashtags,
        "comments": [
            {
                "id": c.tiktok_comment_id, "text": c.text, "likes": c.likes,
                "reply_count": c.reply_count, "author_username": c.author_username,
                "author_nickname": c.author_nickname, "created_at": str(c.created_at),
            }
            for c in (r.comments or [])
        ],
    }

def _edugeek_post_preview(r, db=None):
    return {
        "source": "edugeek", "id": r.edugeek_id, "url": r.url,
        "title": r.title, "body": (r.body or "")[:500],
        "author": r.author, "category": r.category,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _edugeek_post_full(r):
    return {
        "id": r.edugeek_id, "url": r.url, "category": r.category,
        "title": r.title, "body": r.body, "author": r.author,
        "author_rep": r.author_rep, "reply_count": r.reply_count,
        "created_at": str(r.created_at),
        "replies": [
            {"id": rep.reply_id, "author": rep.author, "body": rep.body,
             "created_at": str(rep.created_at)}
            for rep in (r.replies or [])
        ],
    }

def _autodesk_post_preview(r, db=None):
    return {
        "source": "autodesk", "id": r.autodesk_id, "url": r.url,
        "title": r.subject, "body": (r.body or "")[:500],
        "author": r.author_username, "content_type": r.content_type,
        "is_solved": r.is_solved, "kudos": r.kudos,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _autodesk_post_full(r):
    return {
        "id": r.autodesk_id, "url": r.url, "content_type": r.content_type,
        "subject": r.subject, "body": r.body, "is_solved": r.is_solved,
        "reply_count": r.reply_count, "kudos": r.kudos,
        "board": {"id": r.board_id, "title": r.board_title},
        "author": {
            "id": r.author_id, "username": r.author_username, "rank": r.author_rank,
            "kudos": r.author_kudos, "messages": r.author_messages,
            "solutions": r.author_solutions, "registered": str(r.author_registered),
        },
        "created_at": str(r.created_at),
        "replies": [
            {
                "id": rep.autodesk_id, "url": rep.url, "subject": rep.subject,
                "body": rep.body, "kudos": rep.kudos, "is_solved": rep.is_solved,
                "author_id": rep.author_id, "author_username": rep.author_username,
                "author_rank": rep.author_rank, "created_at": str(rep.created_at),
            }
            for rep in (r.replies or [])
        ],
    }

def _se_question_preview(r, db=None):
    return {
        "source": "stackexchange", "id": r.question_id, "url": r.url,
        "title": r.title, "body": (r.body or "")[:500],
        "author": r.author_username, "site": r.site, "score": r.score,
        "is_answered": r.is_answered,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _se_question_full(r):
    return {
        "id": r.question_id, "url": r.url, "site": r.site,
        "title": r.title, "body": r.body, "tags": r.tags,
        "is_answered": r.is_answered, "score": r.score,
        "views": r.views, "answer_count": r.answer_count,
        "author": {
            "username": r.author_username, "reputation": r.author_reputation,
            "user_id": r.author_user_id,
        },
        "created_at": str(r.created_at), "last_activity": str(r.last_activity),
        "comments": [
            {
                "id": c.comment_id, "body": c.body, "score": c.score,
                "author_username": c.author_username,
                "author_reputation": c.author_reputation,
                "created_at": str(c.created_at),
            }
            for c in (r.question_comments or [])
        ],
        "answers": [
            {
                "id": a.answer_id, "body": a.body, "is_accepted": a.is_accepted,
                "score": a.score,
                "author": {
                    "username": a.author_username, "reputation": a.author_reputation,
                    "user_id": a.author_user_id,
                },
                "created_at": str(a.created_at),
                "comments": [
                    {
                        "id": ac.comment_id, "body": ac.body, "score": ac.score,
                        "author_username": ac.author_username,
                        "author_reputation": ac.author_reputation,
                        "created_at": str(ac.created_at),
                    }
                    for ac in (a.answer_comments or [])
                ],
            }
            for a in (r.answers or [])
        ],
    }

def _gnews_preview(r, db=None):
    return {
        "source": "google_news", "id": r.google_news_url, "url": r.google_news_url,
        "title": r.title, "description": r.description,
        "source_name": r.source_name, "published_at": str(r.published_at),
        "keyword": r.search_query or "",
        "scraped_at": r.scraped_at.isoformat() if r.scraped_at else _scraped_at_str(db, r.run_id),
    }

def _gnews_full(r):
    return {
        "url": r.google_news_url, "title": r.title,
        "source_name": r.source_name, "description": r.description,
        "image_url": r.image_url, "search_query": r.search_query,
        "published_at": str(r.published_at), "scraped_at": str(r.scraped_at),
    }

def _instagram_post_preview(r, db=None):
    return {
        "source": "instagram", "id": r.instagram_id, "url": r.url,
        "caption": (r.caption or "")[:300], "author": r.owner_username,
        "likes": r.likes_count, "comments_count": r.comments_count,
        "keyword": _run_keyword(db, r.run_id),
        "timestamp": str(r.timestamp), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _instagram_post_full(r):
    return {
        "id": r.instagram_id, "short_code": r.short_code, "url": r.url,
        "post_type": r.post_type, "caption": r.caption,
        "hashtags": r.hashtags, "mentions": r.mentions, "alt_text": r.alt_text,
        "display_url": r.display_url, "image_url": r.image_url,
        "owner_username": r.owner_username, "owner_full_name": r.owner_full_name,
        "owner_id": r.owner_id, "likes_count": r.likes_count,
        "comments_count": r.comments_count, "first_comment": r.first_comment,
        "is_comments_disabled": r.is_comments_disabled, "timestamp": str(r.timestamp),
        "comments": [
            {"id": c.comment_id, "text": c.text, "owner_username": c.owner_username}
            for c in (r.comments or [])
        ],
    }

def _spiceworks_preview(r, db=None):
    return {
        "source": "spiceworks", "id": r.url, "url": r.url,
        "title": r.title, "body": (r.body or "")[:500],
        "author": r.author,
        "category": r.category,
        "thumbnail": r.thumbnail,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at),
        "scraped_at": r.scraped_at.isoformat() if r.scraped_at else _scraped_at_str(db, r.run_id),
    }

def _spiceworks_full(r):
    import json as _json
    tags = None
    if r.tags:
        try:
            tags = _json.loads(r.tags)
        except Exception:
            tags = r.tags
    return {
        "url": r.url, "title": r.title, "author": r.author,
        "body": r.body, "source": r.source,
        "category": r.category, "tags": tags, "thumbnail": r.thumbnail,
        "created_at": str(r.created_at), "scraped_at": str(r.scraped_at),
    }

def _tweet_url(r) -> str:
    if r.screen_name and r.tweet_id:
        return f"https://x.com/{r.screen_name}/status/{r.tweet_id}"
    return ""

def _twitter_tweet_preview(r, db=None):
    return {
        "source":      "twitter",
        "id":          r.tweet_id,
        "url":         _tweet_url(r),
        "text":        (r.text or "")[:300],
        "author":      r.screen_name,
        "user_name":   r.user_name,
        "lang":        r.lang,
        "likes":       r.favorites,
        "retweets":    r.retweets,
        "replies":     r.replies,
        "quotes":      r.quotes,
        "bookmarks":   r.bookmarks,
        "views":       r.views,
        "hashtags":    r.hashtags,
        "media_url":   r.media_url,
        "verified":    r.user_verified,
        "followers":   r.user_followers_count,
        "location":    r.user_location,
        "avatar":      r.user_avatar,
        "keyword":     _run_keyword(db, r.run_id),
        "created_at":  str(r.created_at),
        "scraped_at":  r.scraped_at.isoformat() if r.scraped_at else _scraped_at_str(db, r.run_id),
    }

def _twitter_tweet_full(r):
    return {
        "tweet_id":        r.tweet_id,
        "url":             _tweet_url(r),
        "conversation_id": r.conversation_id,
        "screen_name":     r.screen_name,
        "text":            r.text,
        "lang":            r.lang,
        "likes":           r.favorites,
        "retweets":        r.retweets,
        "replies":         r.replies,
        "quotes":          r.quotes,
        "bookmarks":       r.bookmarks,
        "views":           r.views,
        "hashtags":        r.hashtags,
        "user_mentions":   r.user_mentions,
        "media_url":       r.media_url,
        "author": {
            "username":        r.screen_name,
            "name":            r.user_name,
            "description":     r.user_description,
            "followers_count": r.user_followers_count,
            "friends_count":   r.user_friends_count,
            "verified":        r.user_verified,
            "verified_type":   r.user_verified_type,
            "location":        r.user_location,
            "avatar":          r.user_avatar,
        },
        "created_at":  str(r.created_at),
        "scraped_at":  str(r.scraped_at),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  Run-date filter helper
# ══════════════════════════════════════════════════════════════════════════════

def _apply_run_date_filter(q, model, cutoff, scrape_keyword=None):
    from sqlalchemy import func
    from db_models import ScrapeRun, GoogleNewsArticle
    if model is GoogleNewsArticle:
        if cutoff is not None:
            q = q.filter(model.scraped_at >= cutoff)
        if scrape_keyword:
            q = q.filter(func.lower(model.search_query) == scrape_keyword.lower())
        return q
    needs_join = cutoff is not None or bool(scrape_keyword)
    if not needs_join:
        return q
    q = q.join(ScrapeRun, model.run_id == ScrapeRun.id)
    if cutoff is not None:
        q = q.filter(ScrapeRun.scraped_at >= cutoff)
    if scrape_keyword:
        q = q.filter(func.lower(ScrapeRun.keyword) == scrape_keyword.lower())
    return q


# ══════════════════════════════════════════════════════════════════════════════
#  Search helpers (keyword, paginated)
# ══════════════════════════════════════════════════════════════════════════════

def _search_reddit(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import RedditPost
    q = db.query(RedditPost).filter(or_(
        RedditPost.title.ilike(f"%{keyword}%"),
        RedditPost.body.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, RedditPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(RedditPost.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_reddit_post_preview(r, db) for r in rows]

def _search_tiktok(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import TikTokPost
    q = db.query(TikTokPost).filter(or_(
        TikTokPost.title.ilike(f"%{keyword}%"),
        TikTokPost.hashtags.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, TikTokPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(TikTokPost.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_tiktok_post_preview(r, db) for r in rows]

def _search_edugeek(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import EduGeekPost
    q = db.query(EduGeekPost).filter(or_(
        EduGeekPost.title.ilike(f"%{keyword}%"),
        EduGeekPost.body.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, EduGeekPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(EduGeekPost.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_edugeek_post_preview(r, db) for r in rows]

def _search_autodesk(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import AutodeskPost
    q = db.query(AutodeskPost).filter(or_(
        AutodeskPost.subject.ilike(f"%{keyword}%"),
        AutodeskPost.body.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, AutodeskPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(AutodeskPost.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_autodesk_post_preview(r, db) for r in rows]

def _search_stackexchange(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import StackExchangeQuestion
    q = db.query(StackExchangeQuestion).filter(or_(
        StackExchangeQuestion.title.ilike(f"%{keyword}%"),
        StackExchangeQuestion.body.ilike(f"%{keyword}%"),
        StackExchangeQuestion.tags.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, StackExchangeQuestion, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(StackExchangeQuestion.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_se_question_preview(r, db) for r in rows]

def _search_google_news(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import GoogleNewsArticle
    q = db.query(GoogleNewsArticle).filter(or_(
        GoogleNewsArticle.title.ilike(f"%{keyword}%"),
        GoogleNewsArticle.description.ilike(f"%{keyword}%"),
        GoogleNewsArticle.full_text.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, GoogleNewsArticle, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(GoogleNewsArticle.published_at.desc()).offset(offset).limit(limit).all()
    return total, [_gnews_preview(r, db) for r in rows]

def _search_instagram(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import InstagramPost
    q = db.query(InstagramPost).filter(or_(
        InstagramPost.caption.ilike(f"%{keyword}%"),
        InstagramPost.hashtags.ilike(f"%{keyword}%"),
        InstagramPost.owner_username.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, InstagramPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(InstagramPost.timestamp.desc()).offset(offset).limit(limit).all()
    return total, [_instagram_post_preview(r, db) for r in rows]

def _search_spiceworks(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import SpiceworksPost
    q = db.query(SpiceworksPost).filter(or_(
        SpiceworksPost.title.ilike(f"%{keyword}%"),
        SpiceworksPost.body.ilike(f"%{keyword}%"),
        SpiceworksPost.author.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, SpiceworksPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(SpiceworksPost.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_spiceworks_preview(r, db) for r in rows]

def _search_twitter(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import TwitterTweet
    q = db.query(TwitterTweet).filter(or_(
        TwitterTweet.text.ilike(f"%{keyword}%"),
        TwitterTweet.hashtags.ilike(f"%{keyword}%"),
        TwitterTweet.screen_name.ilike(f"%{keyword}%"),
    ))
    q = _apply_run_date_filter(q, TwitterTweet, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.order_by(TwitterTweet.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_twitter_tweet_preview(r, db) for r in rows]


# ══════════════════════════════════════════════════════════════════════════════
#  Recent helpers (no keyword, paginated)
# ══════════════════════════════════════════════════════════════════════════════

def _recent_q(db, model, cutoff=None, scrape_keyword=None):
    """Query ordered by most-recently-scraped run first, then by post date."""
    from sqlalchemy import func
    from db_models import ScrapeRun, GoogleNewsArticle
    if model is GoogleNewsArticle:
        q = db.query(model)
        if cutoff:
            q = q.filter(model.scraped_at >= cutoff)
        if scrape_keyword:
            q = q.filter(func.lower(model.search_query) == scrape_keyword.lower())
        return q.order_by(model.scraped_at.desc())
    q = db.query(model).join(ScrapeRun, model.run_id == ScrapeRun.id)
    if cutoff:
        q = q.filter(ScrapeRun.scraped_at >= cutoff)
    if scrape_keyword:
        q = q.filter(func.lower(ScrapeRun.keyword) == scrape_keyword.lower())
    return q.order_by(ScrapeRun.scraped_at.desc())


def _recent_reddit(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import RedditPost
    q = _recent_q(db, RedditPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_reddit_post_preview(r, db) for r in rows]

def _recent_tiktok(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import TikTokPost
    q = _recent_q(db, TikTokPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_tiktok_post_preview(r, db) for r in rows]

def _recent_edugeek(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import EduGeekPost
    q = _recent_q(db, EduGeekPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_edugeek_post_preview(r, db) for r in rows]

def _recent_autodesk(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import AutodeskPost
    q = _recent_q(db, AutodeskPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_autodesk_post_preview(r, db) for r in rows]

def _recent_stackexchange(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import StackExchangeQuestion
    q = _recent_q(db, StackExchangeQuestion, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_se_question_preview(r, db) for r in rows]

def _recent_google_news(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import GoogleNewsArticle
    q = _recent_q(db, GoogleNewsArticle, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_gnews_preview(r, db) for r in rows]

def _recent_instagram(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import InstagramPost
    q = _recent_q(db, InstagramPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_instagram_post_preview(r, db) for r in rows]

def _recent_spiceworks(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import SpiceworksPost
    q = _recent_q(db, SpiceworksPost, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_spiceworks_preview(r, db) for r in rows]

def _recent_twitter(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import TwitterTweet
    q = _recent_q(db, TwitterTweet, cutoff, scrape_keyword)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_twitter_tweet_preview(r, db) for r in rows]


# ══════════════════════════════════════════════════════════════════════════════
#  Export helpers (full nested data, no truncation)
# ══════════════════════════════════════════════════════════════════════════════

def _export_reddit(db, keyword, limit):
    from db_models import RedditPost, RedditComment
    q = db.query(RedditPost).options(
        selectinload(RedditPost.comments).selectinload(RedditComment.replies)
    )
    if keyword:
        q = q.filter(or_(RedditPost.title.ilike(f"%{keyword}%"),
                         RedditPost.body.ilike(f"%{keyword}%")))
    return [_reddit_post_full(r) for r in q.order_by(RedditPost.created_at.desc()).limit(limit).all()]

def _export_selected_reddit(db, ids):
    from db_models import RedditPost, RedditComment
    load_opts = selectinload(RedditPost.comments).selectinload(RedditComment.replies)
    rows = db.query(RedditPost).options(load_opts).filter(RedditPost.reddit_id.in_(ids)).all()
    if not rows:
        # Fallback: the frontend may send the post URL when reddit_id is empty
        rows = db.query(RedditPost).options(load_opts).filter(RedditPost.url.in_(ids)).all()
    return [_reddit_post_full(r) for r in rows]

def _export_tiktok(db, keyword, limit):
    from db_models import TikTokPost
    q = db.query(TikTokPost).options(selectinload(TikTokPost.comments))
    if keyword:
        q = q.filter(or_(TikTokPost.title.ilike(f"%{keyword}%"),
                         TikTokPost.hashtags.ilike(f"%{keyword}%")))
    return [_tiktok_post_full(r) for r in q.order_by(TikTokPost.created_at.desc()).limit(limit).all()]

def _export_selected_tiktok(db, ids):
    from db_models import TikTokPost
    rows = db.query(TikTokPost).options(
        selectinload(TikTokPost.comments)
    ).filter(TikTokPost.tiktok_id.in_(ids)).all()
    return [_tiktok_post_full(r) for r in rows]

def _export_edugeek(db, keyword, limit):
    from db_models import EduGeekPost
    q = db.query(EduGeekPost).options(selectinload(EduGeekPost.replies))
    if keyword:
        q = q.filter(or_(EduGeekPost.title.ilike(f"%{keyword}%"),
                         EduGeekPost.body.ilike(f"%{keyword}%")))
    return [_edugeek_post_full(r) for r in q.order_by(EduGeekPost.created_at.desc()).limit(limit).all()]

def _export_selected_edugeek(db, ids):
    from db_models import EduGeekPost
    rows = db.query(EduGeekPost).options(
        selectinload(EduGeekPost.replies)
    ).filter(EduGeekPost.edugeek_id.in_(ids)).all()
    return [_edugeek_post_full(r) for r in rows]

def _export_autodesk(db, keyword, limit):
    from db_models import AutodeskPost
    q = db.query(AutodeskPost).options(selectinload(AutodeskPost.replies))
    if keyword:
        q = q.filter(or_(AutodeskPost.subject.ilike(f"%{keyword}%"),
                         AutodeskPost.body.ilike(f"%{keyword}%")))
    return [_autodesk_post_full(r) for r in q.order_by(AutodeskPost.created_at.desc()).limit(limit).all()]

def _export_selected_autodesk(db, ids):
    from db_models import AutodeskPost
    rows = db.query(AutodeskPost).options(
        selectinload(AutodeskPost.replies)
    ).filter(AutodeskPost.autodesk_id.in_(ids)).all()
    return [_autodesk_post_full(r) for r in rows]

def _export_stackexchange(db, keyword, limit):
    from db_models import StackExchangeQuestion, StackExchangeAnswer
    q = db.query(StackExchangeQuestion).options(
        selectinload(StackExchangeQuestion.question_comments),
        selectinload(StackExchangeQuestion.answers).selectinload(StackExchangeAnswer.answer_comments),
    )
    if keyword:
        q = q.filter(or_(StackExchangeQuestion.title.ilike(f"%{keyword}%"),
                         StackExchangeQuestion.body.ilike(f"%{keyword}%"),
                         StackExchangeQuestion.tags.ilike(f"%{keyword}%")))
    return [_se_question_full(r) for r in q.order_by(StackExchangeQuestion.created_at.desc()).limit(limit).all()]

def _export_selected_stackexchange(db, ids):
    from db_models import StackExchangeQuestion, StackExchangeAnswer
    int_ids = [int(i) for i in ids if str(i).isdigit()]
    rows = db.query(StackExchangeQuestion).options(
        selectinload(StackExchangeQuestion.question_comments),
        selectinload(StackExchangeQuestion.answers).selectinload(StackExchangeAnswer.answer_comments),
    ).filter(StackExchangeQuestion.question_id.in_(int_ids)).all()
    return [_se_question_full(r) for r in rows]

def _export_google_news(db, keyword, limit):
    from db_models import GoogleNewsArticle
    q = db.query(GoogleNewsArticle)
    if keyword:
        q = q.filter(or_(GoogleNewsArticle.title.ilike(f"%{keyword}%"),
                         GoogleNewsArticle.description.ilike(f"%{keyword}%"),
                         GoogleNewsArticle.full_text.ilike(f"%{keyword}%")))
    return [_gnews_full(r) for r in q.order_by(GoogleNewsArticle.published_at.desc()).limit(limit).all()]

def _export_selected_google_news(db, ids):
    from db_models import GoogleNewsArticle
    rows = db.query(GoogleNewsArticle).filter(
        GoogleNewsArticle.google_news_url.in_(ids)
    ).all()
    return [_gnews_full(r) for r in rows]

def _export_instagram(db, keyword, limit):
    from db_models import InstagramPost
    q = db.query(InstagramPost).options(selectinload(InstagramPost.comments))
    if keyword:
        q = q.filter(or_(InstagramPost.caption.ilike(f"%{keyword}%"),
                         InstagramPost.hashtags.ilike(f"%{keyword}%"),
                         InstagramPost.owner_username.ilike(f"%{keyword}%")))
    return [_instagram_post_full(r) for r in q.order_by(InstagramPost.timestamp.desc()).limit(limit).all()]

def _export_selected_instagram(db, ids):
    from db_models import InstagramPost
    rows = db.query(InstagramPost).options(
        selectinload(InstagramPost.comments)
    ).filter(InstagramPost.instagram_id.in_(ids)).all()
    return [_instagram_post_full(r) for r in rows]

def _export_twitter(db, keyword, limit):
    from db_models import TwitterTweet
    q = db.query(TwitterTweet)
    if keyword:
        q = q.filter(or_(TwitterTweet.text.ilike(f"%{keyword}%"),
                         TwitterTweet.hashtags.ilike(f"%{keyword}%"),
                         TwitterTweet.screen_name.ilike(f"%{keyword}%")))
    return [_twitter_tweet_full(r) for r in q.order_by(TwitterTweet.created_at.desc()).limit(limit).all()]

def _export_selected_twitter(db, ids):
    from db_models import TwitterTweet
    rows = db.query(TwitterTweet).filter(TwitterTweet.tweet_id.in_(ids)).all()
    return [_twitter_tweet_full(r) for r in rows]

def _export_spiceworks(db, keyword, limit):
    from db_models import SpiceworksPost
    q = db.query(SpiceworksPost)
    if keyword:
        q = q.filter(or_(SpiceworksPost.title.ilike(f"%{keyword}%"),
                         SpiceworksPost.body.ilike(f"%{keyword}%"),
                         SpiceworksPost.author.ilike(f"%{keyword}%")))
    return [_spiceworks_full(r) for r in q.order_by(SpiceworksPost.created_at.desc()).limit(limit).all()]

def _export_selected_spiceworks(db, ids):
    from db_models import SpiceworksPost
    rows = db.query(SpiceworksPost).filter(SpiceworksPost.url.in_(ids)).all()
    return [_spiceworks_full(r) for r in rows]


# ── Quora serialisers ─────────────────────────────────────────────────────────

def _quora_question_preview(r, db=None):
    import json as _json
    topics = []
    if r.topics:
        try:
            topics = _json.loads(r.topics)
        except Exception:
            topics = []
    first_answer = (r.answers[0].content if r.answers else "") or ""
    return {
        "source":         "quora",
        "id":             r.url,
        "url":            r.url,
        "title":          r.question_title,
        "body":           first_answer[:300],
        "topics":         topics,
        "answer_count":   r.answer_count,
        "keyword":        _run_keyword(db, getattr(r, "run_id", None)),
        "scraped_at":     r.scraped_at.isoformat() if r.scraped_at else "",
    }

def _quora_question_full(r):
    import json as _json
    topics = []
    if r.topics:
        try:
            topics = _json.loads(r.topics)
        except Exception:
            topics = []

    return {
        "url":            r.url,
        "question_title": r.question_title,
        "topics":         topics,
        "answer_count":   r.answer_count,
        "scraped_at":     r.scraped_at.isoformat() if r.scraped_at else "",
        "answers": [
            {
                "author_name":       a.author_name,
                "author_credential": a.author_credential,
                "content":           a.content,
                "upvotes":           a.upvotes,
                "views":             a.views,
                "shares":            a.shares,
                "comments_count":    a.comments_count,
                "is_ai_answer":      a.is_ai_answer,
                "created_at":        str(a.created_at) if a.created_at else "",
            }
            for a in (r.answers or [])
        ],
    }

def _search_quora(db, keyword, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import QuoraQuestion, QuoraAnswer
    answer_subq = db.query(QuoraAnswer.question_id).filter(
        QuoraAnswer.content.ilike(f"%{keyword}%")
    ).subquery()
    q = db.query(QuoraQuestion).filter(or_(
        QuoraQuestion.question_title.ilike(f"%{keyword}%"),
        QuoraQuestion.topics.ilike(f"%{keyword}%"),
        QuoraQuestion.id.in_(answer_subq),
    )).options(selectinload(QuoraQuestion.answers))
    if cutoff is not None:
        q = q.filter(QuoraQuestion.scraped_at >= cutoff)
    if scrape_keyword:
        try:
            from db_models import ScrapeRun
            q = q.join(ScrapeRun, QuoraQuestion.run_id == ScrapeRun.id).filter(
                ScrapeRun.keyword == scrape_keyword
            )
        except Exception:
            pass
    total = q.count()
    rows  = q.order_by(QuoraQuestion.scraped_at.desc()).offset(offset).limit(limit).all()
    return total, [_quora_question_preview(r, db) for r in rows]

def _recent_quora(db, limit, offset, cutoff=None, scrape_keyword=None):
    from db_models import QuoraQuestion
    q = db.query(QuoraQuestion).options(selectinload(QuoraQuestion.answers))
    if cutoff is not None:
        q = q.filter(QuoraQuestion.scraped_at >= cutoff)
    if scrape_keyword:
        try:
            from db_models import ScrapeRun
            q = q.join(ScrapeRun, QuoraQuestion.run_id == ScrapeRun.id).filter(
                ScrapeRun.keyword == scrape_keyword
            )
        except Exception:
            pass
    total = q.count()
    rows  = q.order_by(QuoraQuestion.scraped_at.desc()).offset(offset).limit(limit).all()
    return total, [_quora_question_preview(r, db) for r in rows]

def _export_quora(db, keyword, limit):
    from db_models import QuoraQuestion
    q = db.query(QuoraQuestion).options(selectinload(QuoraQuestion.answers))
    if keyword:
        q = q.filter(or_(
            QuoraQuestion.question_title.ilike(f"%{keyword}%"),
            QuoraQuestion.topics.ilike(f"%{keyword}%"),
        ))
    return [_quora_question_full(r) for r in q.order_by(QuoraQuestion.scraped_at.desc()).limit(limit).all()]

def _export_selected_quora(db, ids):
    from db_models import QuoraQuestion
    rows = db.query(QuoraQuestion).options(
        selectinload(QuoraQuestion.answers)
    ).filter(QuoraQuestion.url.in_(ids)).all()
    return [_quora_question_full(r) for r in rows]


# ══════════════════════════════════════════════════════════════════════════════
#  Facebook
# ══════════════════════════════════════════════════════════════════════════════

def _facebook_comment_dict(c):
    return {
        "id": c.comment_id, "text": c.text, "author": c.author,
        "created_at": str(c.created_at),
    }

def _facebook_post_preview(r, db=None):
    text = r.text or ""
    return {
        "source": "facebook", "id": r.post_id, "url": r.url,
        "title": text[:200], "body": text[:500],
        "author": r.author, "group_url": r.group_url,
        "likes_count": r.likes_count, "comments_count": r.comments_count,
        "keyword": _run_keyword(db, r.run_id),
        "created_at": str(r.created_at), "scraped_at": _scraped_at_str(db, r.run_id),
    }

def _facebook_post_full(r):
    return {
        "id": r.post_id, "url": r.url, "permalink": r.permalink,
        "group_url": r.group_url,
        "text": r.text, "image_url": r.image_url,
        "video_view_count": r.video_view_count,
        "video_details": r.video_details,
        "reaction_counts": r.reaction_counts,
        "author": r.author, "author_id": r.author_id,
        "likes_count": r.likes_count, "comments_count": r.comments_count,
        "created_at": str(r.created_at), "scraped_at": str(r.scraped_at),
        "matched_comments": [_facebook_comment_dict(c) for c in (r.comments or [])],
    }

def _search_facebook(db, keyword, limit, offset, cutoff=None, scrape_keyword=None, group_url=None):
    from db_models import FacebookPost
    q = db.query(FacebookPost).filter(FacebookPost.text.ilike(f"%{keyword}%"))
    q = _apply_run_date_filter(q, FacebookPost, cutoff, scrape_keyword)
    if group_url:
        q = q.filter(FacebookPost.group_url == group_url)
    total = q.count()
    rows  = q.order_by(FacebookPost.created_at.desc()).offset(offset).limit(limit).all()
    return total, [_facebook_post_preview(r, db) for r in rows]

def _recent_facebook(db, limit, offset, cutoff=None, scrape_keyword=None, group_url=None):
    from db_models import FacebookPost
    q = _recent_q(db, FacebookPost, cutoff, scrape_keyword)
    if group_url:
        q = q.filter(FacebookPost.group_url == group_url)
    total = q.count()
    rows  = q.offset(offset).limit(limit).all()
    return total, [_facebook_post_preview(r, db) for r in rows]

def _export_facebook(db, keyword, limit):
    from db_models import FacebookPost
    q = db.query(FacebookPost).options(selectinload(FacebookPost.comments))
    if keyword:
        q = q.filter(FacebookPost.text.ilike(f"%{keyword}%"))
    return [_facebook_post_full(r) for r in q.order_by(FacebookPost.created_at.desc()).limit(limit).all()]

def _export_selected_facebook(db, ids):
    from db_models import FacebookPost
    load_opts = selectinload(FacebookPost.comments)
    rows = db.query(FacebookPost).options(load_opts).filter(FacebookPost.post_id.in_(ids)).all()
    if not rows:
        rows = db.query(FacebookPost).options(load_opts).filter(FacebookPost.url.in_(ids)).all()
    return [_facebook_post_full(r) for r in rows]


# ══════════════════════════════════════════════════════════════════════════════
#  Registries
# ══════════════════════════════════════════════════════════════════════════════

_SEARCHERS = {
    "reddit": _search_reddit, "tiktok": _search_tiktok,
    "edugeek": _search_edugeek, "autodesk": _search_autodesk,
    "stackexchange": _search_stackexchange, "google_news": _search_google_news,
    "instagram": _search_instagram, "twitter": _search_twitter,
    "spiceworks": _search_spiceworks, "quora": _search_quora,
    "facebook": _search_facebook,
}

_RECENT_FETCHERS = {
    "reddit": _recent_reddit, "tiktok": _recent_tiktok,
    "edugeek": _recent_edugeek, "autodesk": _recent_autodesk,
    "stackexchange": _recent_stackexchange, "google_news": _recent_google_news,
    "instagram": _recent_instagram, "twitter": _recent_twitter,
    "spiceworks": _recent_spiceworks, "quora": _recent_quora,
    "facebook": _recent_facebook,
}

_EXPORTERS = {
    "reddit": _export_reddit, "tiktok": _export_tiktok,
    "edugeek": _export_edugeek, "autodesk": _export_autodesk,
    "stackexchange": _export_stackexchange, "google_news": _export_google_news,
    "instagram": _export_instagram, "twitter": _export_twitter,
    "spiceworks": _export_spiceworks, "quora": _export_quora,
    "facebook": _export_facebook,
}

_SELECTED_EXPORTERS = {
    "reddit": _export_selected_reddit, "tiktok": _export_selected_tiktok,
    "edugeek": _export_selected_edugeek, "autodesk": _export_selected_autodesk,
    "stackexchange": _export_selected_stackexchange,
    "google_news": _export_selected_google_news,
    "instagram": _export_selected_instagram, "twitter": _export_selected_twitter,
    "spiceworks": _export_selected_spiceworks, "quora": _export_selected_quora,
    "facebook": _export_selected_facebook,
}

ALL_SOURCES = list(_SEARCHERS.keys())

_SOURCE_TABLE_MAP = {
    "reddit":        ("RedditPost",              "reddit_id"),
    "tiktok":        ("TikTokPost",              "tiktok_id"),
    "edugeek":       ("EduGeekPost",             "edugeek_id"),
    "autodesk":      ("AutodeskPost",            "autodesk_id"),
    "stackexchange": ("StackExchangeQuestion",   "question_id"),
    "google_news":   ("GoogleNewsArticle",       "google_news_url"),
    "instagram":     ("InstagramPost",           "instagram_id"),
    "twitter":       ("TwitterTweet",            "tweet_id"),
    "spiceworks":    ("SpiceworksPost",          "url"),
    "quora":         ("QuoraQuestion",           "url"),
    "facebook":      ("FacebookPost",            "post_id"),
}

def _get_table_and_id_column(source: str):
    """Return (table_class, id_column_name) for a given source."""
    from db_models import (
        RedditPost, TikTokPost, EduGeekPost, AutodeskPost,
        StackExchangeQuestion, GoogleNewsArticle, InstagramPost, TwitterTweet,
        SpiceworksPost, QuoraQuestion, FacebookPost,
    )
    _TABLE_CLASSES = {
        "reddit":        RedditPost,
        "tiktok":        TikTokPost,
        "edugeek":       EduGeekPost,
        "autodesk":      AutodeskPost,
        "stackexchange": StackExchangeQuestion,
        "google_news":   GoogleNewsArticle,
        "instagram":     InstagramPost,
        "twitter":       TwitterTweet,
        "spiceworks":    SpiceworksPost,
        "quora":         QuoraQuestion,
        "facebook":      FacebookPost,
    }
    table_class = _TABLE_CLASSES.get(source)
    id_col_name = _SOURCE_TABLE_MAP.get(source, (None, None))[1]
    if table_class is None or id_col_name is None:
        raise ValueError(f"Unknown source '{source}'")
    id_col = getattr(table_class, id_col_name)
    return table_class, id_col


# ══════════════════════════════════════════════════════════════════════════════
#  Public API
# ══════════════════════════════════════════════════════════════════════════════

class SearchService:

    @staticmethod
    def search_all(db: Session, keyword: str, limit: int = 50, offset: int = 0,
                   date_range: str | None = None, scrape_keyword: str | None = None,
                   group_url: str | None = None) -> dict:
        cutoff        = _cutoff_from_range(date_range)
        all_results   = []
        source_totals = {}
        for source, fn in _SEARCHERS.items():
            try:
                kwargs = dict(limit=10_000, offset=0, cutoff=cutoff, scrape_keyword=scrape_keyword)
                if source == "facebook" and group_url:
                    kwargs["group_url"] = group_url
                total, rows = fn(db, keyword, **kwargs)
                source_totals[source] = total
                all_results.extend(rows)
            except Exception as exc:
                logger.error("search_all failed for %s: %s", source, exc)
                source_totals[source] = 0

        all_results.sort(
            key=lambda r: (
                r.get("scraped_at") or r.get("created_at") or
                r.get("published_at") or r.get("timestamp") or ""
            ),
            reverse=True,
        )

        return {
            "total":         sum(source_totals.values()),
            "source_totals": source_totals,
            "results":       all_results[offset: offset + limit],
        }

    @staticmethod
    def search_one(db: Session, keyword: str, source: str,
                   limit: int = 50, offset: int = 0,
                   date_range: str | None = None, scrape_keyword: str | None = None,
                   group_url: str | None = None) -> dict:
        cutoff = _cutoff_from_range(date_range)
        fn = _SEARCHERS.get(source)
        if fn is None:
            raise ValueError(f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
        kwargs = dict(cutoff=cutoff, scrape_keyword=scrape_keyword)
        if source == "facebook" and group_url:
            kwargs["group_url"] = group_url
        total, results = fn(db, keyword, limit, offset, **kwargs)
        return {"total": total, "results": results}

    @staticmethod
    def recent_all(db: Session, limit: int = 50, offset: int = 0,
                   date_range: str | None = None, scrape_keyword: str | None = None,
                   group_url: str | None = None) -> dict:
        """
        Returns the TRUE total count from DB across all sources,
        plus a page of the most recent results sorted by date.
        """
        cutoff        = _cutoff_from_range(date_range)
        source_totals = {}
        grand_total   = 0

        # Pass 1 — get true count per source (fast, no row fetch)
        for source, fn in _RECENT_FETCHERS.items():
            try:
                kwargs = dict(cutoff=cutoff, scrape_keyword=scrape_keyword)
                if source == "facebook" and group_url:
                    kwargs["group_url"] = group_url
                total, _ = fn(db, 1, 0, **kwargs)
                source_totals[source] = total
                grand_total += total
            except Exception as exc:
                logger.error("recent_all count failed for %s: %s", source, exc)
                source_totals[source] = 0

        # Pass 2 — fetch rows for the current page.
        # Must cover offset+limit in the worst case (all rows from one source).
        fetch_per_source = max(offset + limit, 150)
        all_results = []

        for source, fn in _RECENT_FETCHERS.items():
            if source_totals.get(source, 0) == 0:
                continue
            try:
                kwargs = dict(cutoff=cutoff, scrape_keyword=scrape_keyword)
                if source == "facebook" and group_url:
                    kwargs["group_url"] = group_url
                _, rows = fn(db, fetch_per_source, 0, **kwargs)
                all_results.extend(rows)
            except Exception as exc:
                logger.error("recent_all fetch failed for %s: %s", source, exc)

        # Sort by most recent date across all sources
        all_results.sort(
            key=lambda r: (
                r.get("scraped_at") or r.get("created_at") or
                r.get("published_at") or r.get("timestamp") or ""
            ),
            reverse=True,
        )

        return {
            "total":         grand_total,
            "source_totals": source_totals,
            "results":       all_results[offset: offset + limit],
        }

    @staticmethod
    def recent_one(db: Session, source: str, limit: int = 50, offset: int = 0,
                   date_range: str | None = None, scrape_keyword: str | None = None,
                   group_url: str | None = None) -> dict:
        cutoff = _cutoff_from_range(date_range)
        fn = _RECENT_FETCHERS.get(source)
        if fn is None:
            raise ValueError(f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
        kwargs = dict(cutoff=cutoff, scrape_keyword=scrape_keyword)
        if source == "facebook" and group_url:
            kwargs["group_url"] = group_url
        total, results = fn(db, limit, offset, **kwargs)
        return {"total": total, "results": results}

    @staticmethod
    def export_one(db: Session, source: str,
                   keyword: str | None = None, limit: int = 100_000) -> dict:
        fn = _EXPORTERS.get(source)
        if fn is None:
            raise ValueError(f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
        rows = fn(db, keyword, limit)
        return {"total": len(rows), "results": rows}

    @staticmethod
    def export_all(db: Session, keyword: str | None = None,
                   limit: int = 100_000) -> dict:
        out           = {}
        source_totals = {}
        for source in ALL_SOURCES:
            try:
                rows = _EXPORTERS[source](db, keyword, limit)
                if rows:
                    out[source]           = rows
                    source_totals[source] = len(rows)
                else:
                    source_totals[source] = 0
            except Exception:
                source_totals[source] = 0
        return {
            "total":         sum(source_totals.values()),
            "source_totals": source_totals,
            "by_source":     out,
        }

    @staticmethod
    def export_selected(db: Session, selections: dict) -> dict:
        out           = {}
        source_totals = {}
        for source, ids in selections.items():
            if not ids:
                source_totals[source] = 0
                continue
            fn = _SELECTED_EXPORTERS.get(source)
            if fn is None:
                source_totals[source] = 0
                continue
            try:
                rows = fn(db, ids)
                if rows:
                    out[source]           = rows
                    source_totals[source] = len(rows)
                else:
                    source_totals[source] = 0
            except Exception:
                source_totals[source] = 0
        return {
            "total":         sum(source_totals.values()),
            "source_totals": source_totals,
            "by_source":     out,
        }
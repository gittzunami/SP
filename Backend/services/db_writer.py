"""
services/db_writer.py
=====================
Saves scraped payloads directly into PostgreSQL.

All scrapers now return the full payload including posts/questions/articles
directly from run() — no JSON file reading needed.

All inserts use ON CONFLICT DO NOTHING — safe to re-run, no duplicates.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

logger = logging.getLogger("db_writer")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _since_dt(since_date: Optional[str]) -> Optional[datetime]:
    """Parse since_date string into a timezone-aware datetime, or None."""
    if not since_date:
        return None
    try:
        dt = datetime.fromisoformat(since_date)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _after_since(item: dict, cutoff: Optional[datetime], *date_keys: str) -> bool:
    """Return True if item's date is >= cutoff (or cutoff is None, or no date found)."""
    if cutoff is None:
        return True
    for key in date_keys:
        raw = item.get(key)
        if not raw:
            continue
        dt = _parse_dt(raw)
        if dt is not None:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt >= cutoff
    return True  # no date field → don't filter out


def _parse_dt(value) -> Optional[datetime]:
    """Parse ISO-8601, Twitter, or human-readable date string into datetime, or return None."""
    if not value:
        return None
    try:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str):
            return None
        # Twitter format: "Thu Mar 26 13:04:38 +0000 2026"
        if value.count(":") == 2 and "+" in value and len(value) > 25:
            return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y")
        # Human-readable: "October 21, 2022" or "21 October 2022"
        for fmt in ("%B %d, %Y", "%d %B %Y"):
            try:
                return datetime.strptime(value.strip(), fmt)
            except ValueError:
                pass
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _j(value) -> Optional[str]:
    """Serialise a list/dict to JSON string, or return None."""
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _create_run(db: Session, scraper: str, payload: dict, task_id: str) -> int:
    """Insert a ScrapeRun audit row and return its id."""
    from db_models import ScrapeRun

    keyword = payload.get("keyword", "")
    if not keyword and isinstance(payload.get("keywords"), list):
        keyword = payload["keywords"][0] if payload["keywords"] else ""
    keyword = keyword.lower().strip()

    run = ScrapeRun(
        scraper     = scraper,
        keyword     = keyword,
        scraped_at  = _parse_dt(payload.get("scraped_at")) or datetime.now(tz=timezone.utc),
        total_items = (
            payload.get("total_posts")
            or payload.get("total_questions")
            or payload.get("total_items")
            or payload.get("total_tweets")
            or payload.get("total_articles")
            or len(payload.get("posts",      []))
            or len(payload.get("questions",  []))
            or len(payload.get("articles",   []))
            or len(payload.get("tweets",     []))
            or 0
        ),
        task_id = task_id,
    )
    db.add(run)
    db.flush()
    return run.id


# ══════════════════════════════════════════════════════════════════════════════
#  Reddit
# ══════════════════════════════════════════════════════════════════════════════

def save_reddit(db: Session, payload: dict, task_id: str = "",
                since_date: Optional[str] = None) -> int:
    from db_models import RedditPost

    cutoff = _since_dt(since_date)
    posts  = [p for p in payload.get("posts", []) if _after_since(p, cutoff, "created_at")]
    if not posts:
        logger.warning("Reddit: no posts in payload (after date filter)")
        return 0

    run_id = _create_run(db, "reddit", payload, task_id)
    saved  = 0

    for post_data in posts:
        stmt = pg_insert(RedditPost).values(
            run_id       = run_id,
            reddit_id    = post_data["id"],
            url          = post_data.get("url"),
            subreddit    = post_data.get("subreddit"),
            title        = post_data.get("title"),
            body         = post_data.get("body"),
            flair        = post_data.get("flair"),
            is_nsfw      = post_data.get("is_nsfw", False),
            url_content  = post_data.get("url_content"),
            author       = post_data.get("author"),
            score        = post_data.get("score", 0),
            upvote_ratio = post_data.get("upvote_ratio", 0),
            num_comments = len(post_data.get("comments", [])) or post_data.get("num_comments", 0),
            created_at   = _parse_dt(post_data.get("created_at")),
        ).on_conflict_do_nothing(constraint="uq_reddit_post_id")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        post_row = db.query(RedditPost).filter_by(reddit_id=post_data["id"]).first()
        if not post_row:
            continue

        _save_reddit_comments(db, post_row.id, post_data.get("comments", []), None)
        if is_new:
            saved += 1

    db.commit()
    logger.info("Reddit: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


def _save_reddit_comments(db: Session, post_id: int, comments: list,
                           parent_comment_id: Optional[int]) -> None:
    from db_models import RedditComment
    for c in comments:
        comment = RedditComment(
            post_id           = post_id,
            parent_comment_id = parent_comment_id,
            reddit_id         = c.get("id", ""),
            author            = c.get("author"),
            body              = c.get("body"),
            score             = c.get("score", 0),
            depth             = c.get("depth", 0),
            created_at        = _parse_dt(c.get("created_at")),
        )
        db.add(comment)
        db.flush()
        _save_reddit_comments(db, post_id, c.get("replies", []), comment.id)


# ══════════════════════════════════════════════════════════════════════════════
#  TikTok
# ══════════════════════════════════════════════════════════════════════════════

def save_tiktok(db: Session, payload: dict, task_id: str = "",
                since_date: Optional[str] = None) -> int:
    from db_models import TikTokPost, TikTokComment

    posts = payload.get("posts", [])
    if not posts:
        logger.warning("TikTok: no posts in payload")
        return 0

    run_id = _create_run(db, "tiktok", payload, task_id)
    saved  = 0

    for p in posts:
        auth  = p.get("author", {})
        stats = p.get("stats",  {})
        video = p.get("video",  {})
        music = p.get("music",  {})

        stmt = pg_insert(TikTokPost).values(
            run_id           = run_id,
            tiktok_id        = p["id"],
            url              = p.get("url"),
            title            = p.get("title"),
            created_at       = _parse_dt(p.get("created_at")),
            author_username  = auth.get("username"),
            author_nickname  = auth.get("nickname"),
            author_verified  = auth.get("verified", False),
            author_followers = auth.get("followers", 0),
            author_following = auth.get("following", 0),
            author_likes     = auth.get("likes", 0),
            author_bio       = auth.get("bio"),
            plays            = stats.get("plays", 0),
            likes            = stats.get("likes", 0),
            comments_count   = stats.get("comments", 0),
            shares           = stats.get("shares", 0),
            saves            = stats.get("saves", 0),
            duration_sec     = video.get("duration_sec", 0),
            music_title      = music.get("title"),
            music_artist     = music.get("artist"),
            hashtags         = _j(p.get("hashtags", [])),
        ).on_conflict_do_nothing(constraint="uq_tiktok_post_id")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        post_row = db.query(TikTokPost).filter_by(tiktok_id=p["id"]).first()
        if not post_row:
            continue

        for c in p.get("comments", []):
            ca = c.get("author", {})
            db.add(TikTokComment(
                post_id           = post_row.id,
                tiktok_comment_id = c.get("id", ""),
                text              = c.get("text"),
                likes             = c.get("likes", 0),
                reply_count       = c.get("reply_count", 0),
                author_username   = ca.get("username"),
                author_nickname   = ca.get("nickname"),
                created_at        = _parse_dt(c.get("created_at")),
            ))
        if is_new:
            saved += 1

    db.commit()
    logger.info("TikTok: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  EduGeek
# ══════════════════════════════════════════════════════════════════════════════

def save_edugeek(db: Session, payload: dict, task_id: str = "",
                 since_date: Optional[str] = None) -> int:
    from db_models import EduGeekPost, EduGeekReply

    cutoff     = _since_dt(since_date)
    categories = {
        cat: [i for i in items if _after_since(i, cutoff, "created_at")]
        for cat, items in payload.get("categories", {}).items()
    }
    if not any(categories.values()):
        logger.warning("EduGeek: no items in payload (after date filter)")
        return 0

    run_id = _create_run(db, "edugeek", payload, task_id)
    saved  = 0

    for category, items in categories.items():
        for item in items:
            author = item.get("author", "")
            if isinstance(author, dict):
                author_rep = author.get("rep", "")
                author     = author.get("username", "")
            else:
                author_rep = ""

            stmt = pg_insert(EduGeekPost).values(
                run_id      = run_id,
                edugeek_id  = str(item.get("id", "")),
                url         = item.get("url"),
                category    = category,
                title       = item.get("title"),
                body        = item.get("body"),
                author      = author,
                author_rep  = author_rep,
                created_at  = _parse_dt(item.get("created_at")),
                reply_count = len(item.get("replies", [])),
            ).on_conflict_do_nothing(constraint="uq_edugeek_post_id")
            res    = db.execute(stmt)
            is_new = res.rowcount > 0

            post_row = db.query(EduGeekPost).filter_by(
                edugeek_id=str(item.get("id", ""))
            ).first()
            if not post_row:
                continue

            for r in item.get("replies", []):
                db.add(EduGeekReply(
                    post_id    = post_row.id,
                    reply_id   = str(r.get("id", "")),
                    author     = r.get("author"),
                    body       = r.get("body"),
                    created_at = _parse_dt(r.get("date") or r.get("created_at")),
                ))
            if is_new:
                saved += 1

    db.commit()
    logger.info("EduGeek: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Autodesk
# ══════════════════════════════════════════════════════════════════════════════

def save_autodesk(db: Session, payload: dict, task_id: str = "",
                  since_date: Optional[str] = None) -> int:
    from db_models import AutodeskPost, AutodeskReply

    cutoff = _since_dt(since_date)
    posts  = [p for p in payload.get("posts", []) if _after_since(p, cutoff, "created_at")]
    if not posts:
        logger.warning("Autodesk: no posts in payload (after date filter)")
        return 0

    run_id = _create_run(db, "autodesk", payload, task_id)
    saved  = 0

    for p in posts:
        auth  = p.get("author", {})
        board = p.get("board",  {})

        replies = p.get("replies", [])

        stmt = pg_insert(AutodeskPost).values(
            run_id            = run_id,
            autodesk_id       = str(p["id"]),
            url               = p.get("url"),
            content_type      = p.get("content_type"),
            subject           = p.get("subject"),
            body              = p.get("body"),
            is_solved         = p.get("is_solved", False),
            reply_count       = p.get("reply_count", 0),
            board_id          = board.get("id"),
            board_title       = board.get("title"),
            author_id         = str(auth.get("id", "")),
            author_username   = auth.get("username"),
            author_rank       = auth.get("rank"),
            author_kudos      = auth.get("kudos", 0),
            author_messages   = auth.get("messages", 0),
            author_solutions  = auth.get("solutions", 0),
            author_registered = _parse_dt(auth.get("registered")),
            created_at        = _parse_dt(p.get("created_at")),
        ).on_conflict_do_nothing(constraint="uq_autodesk_post_id")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        post_row = db.query(AutodeskPost).filter_by(autodesk_id=str(p["id"])).first()
        if not post_row:
            continue

        for r in replies:
            ra = r.get("author", {})
            db.add(AutodeskReply(
                post_id         = post_row.id,
                autodesk_id     = str(r.get("id", "")),
                url             = r.get("url"),
                subject         = r.get("subject"),
                body            = r.get("body"),
                kudos           = r.get("kudos", 0),
                is_solved       = r.get("is_solved", False),
                author_id       = str(ra.get("id", "")),
                author_username = ra.get("username"),
                author_rank     = ra.get("rank"),
                created_at      = _parse_dt(r.get("created_at")),
            ))
        if is_new:
            saved += 1

    db.commit()
    logger.info("Autodesk: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  StackExchange
# ══════════════════════════════════════════════════════════════════════════════

def save_stackexchange(db: Session, payload: dict, task_id: str = "",
                       since_date: Optional[str] = None) -> int:
    from db_models import (
        StackExchangeQuestion, StackExchangeAnswer,
        StackExchangeQuestionComment, StackExchangeAnswerComment,
    )

    cutoff    = _since_dt(since_date)
    questions = [q for q in payload.get("questions", []) if _after_since(q, cutoff, "created_at")]
    if not questions:
        logger.warning("StackExchange: no questions in payload (after date filter)")
        return 0

    run_id = _create_run(db, "stackexchange", payload, task_id)
    saved  = 0

    for q in questions:
        auth  = q.get("author", {})
        stats = q.get("stats",  {})

        stmt = pg_insert(StackExchangeQuestion).values(
            run_id            = run_id,
            question_id       = q["id"],
            site              = q.get("site", "stackoverflow"),
            url               = q.get("url"),
            title             = q.get("title"),
            body              = q.get("body"),
            tags              = _j(q.get("tags", [])),
            is_answered       = stats.get("is_answered", False),
            author_username   = auth.get("username"),
            author_reputation = auth.get("reputation", 0),
            author_user_id    = auth.get("user_id"),
            score             = stats.get("score", 0),
            views             = stats.get("views", 0),
            answer_count      = len(q.get("answers", [])) or stats.get("answers", 0),
            created_at        = _parse_dt(q.get("created_at")),
            last_activity     = _parse_dt(q.get("last_activity")),
        ).on_conflict_do_nothing(constraint="uq_se_question_site")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        q_row = db.query(StackExchangeQuestion).filter_by(
            question_id=q["id"], site=q.get("site", "stackoverflow")
        ).first()
        if not q_row:
            continue

        # Question-level comments → stackexchange_question_comments
        for c in q.get("comments", []):
            ca = c.get("author", {})
            db.add(StackExchangeQuestionComment(
                question_id       = q_row.id,
                comment_id        = c.get("id"),
                body              = c.get("body"),
                score             = c.get("score", 0),
                author_username   = ca.get("username"),
                author_reputation = ca.get("reputation", 0),
                created_at        = _parse_dt(c.get("created_at")),
            ))

        # Answers + their comments → stackexchange_answers + stackexchange_answer_comments
        for a in q.get("answers", []):
            aa  = a.get("author", {})
            ans = StackExchangeAnswer(
                question_id       = q_row.id,
                answer_id         = a.get("id"),
                body              = a.get("body"),
                is_accepted       = a.get("is_accepted", False),
                score             = (a.get("stats") or {}).get("score", 0),
                author_username   = aa.get("username"),
                author_reputation = aa.get("reputation", 0),
                author_user_id    = aa.get("user_id"),
                created_at        = _parse_dt(a.get("created_at")),
            )
            db.add(ans)
            db.flush()

            for c in a.get("comments", []):
                ca = c.get("author", {})
                db.add(StackExchangeAnswerComment(
                    answer_id         = ans.id,
                    comment_id        = c.get("id"),
                    body              = c.get("body"),
                    score             = c.get("score", 0),
                    author_username   = ca.get("username"),
                    author_reputation = ca.get("reputation", 0),
                    created_at        = _parse_dt(c.get("created_at")),
                ))
        if is_new:
            saved += 1

    db.commit()
    logger.info("StackExchange: %d questions saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Google News
# ══════════════════════════════════════════════════════════════════════════════

def save_google_news(db: Session, payload: dict, task_id: str = "",
                     since_date: Optional[str] = None) -> int:
    from db_models import GoogleNewsArticle

    raw_articles = payload.get("articles", [])
    logger.info("Google News save: received %d articles", len(raw_articles))
    if raw_articles:
        sample = raw_articles[0]
        logger.info("Google News save: first article keys = %s", list(sample.keys()))

    cutoff   = _since_dt(since_date)
    articles = [a for a in raw_articles
                if _after_since(a, cutoff, "publishedAt", "published_at", "date", "datePublished")]
    logger.info("Google News save: %d articles after date filter (cutoff=%s)", len(articles), cutoff)

    if not articles:
        logger.warning("Google News: no articles in payload (after date filter)")
        return 0

    run_id = _create_run(db, "google_news", payload, task_id)
    saved  = 0
    skipped_empty_url = 0

    for a in articles:
        url = a.get("google_news_url") or a.get("url") or a.get("link") or ""
        if not url:
            skipped_empty_url += 1
            logger.warning("Google News: skipping article without URL, title: %s", a.get("title", "N/A")[:50])
            continue
        try:
            stmt = pg_insert(GoogleNewsArticle).values(
                run_id          = run_id,
                title           = a.get("title"),
                source_name     = a.get("source_name") or a.get("source"),
                google_news_url = url,
                description     = a.get("description"),
                image_url       = a.get("image_url"),
                search_query    = a.get("search_query") or a.get("query"),
                published_at    = _parse_dt(a.get("published_at")),
                scraped_at      = _parse_dt(a.get("scraped_at")) or _parse_dt(payload.get("scraped_at")),
            ).on_conflict_do_nothing(constraint="uq_gnews_url")
            res = db.execute(stmt)
            if res.rowcount:
                saved += 1
        except Exception as exc:
            logger.warning("Failed to insert article '%s': %s", a.get("title", "N/A")[:30], exc)

    db.commit()
    logger.info("Google News: %d articles saved to DB (run_id=%d), skipped: %d empty URL",
                saved, run_id, skipped_empty_url)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Instagram
# ══════════════════════════════════════════════════════════════════════════════

def save_instagram(db: Session, payload: dict, task_id: str = "",
                   since_date: Optional[str] = None) -> int:
    from db_models import InstagramPost, InstagramComment

    posts = payload.get("posts", [])
    if not posts:
        logger.warning("Instagram: no posts in payload")
        return 0

    run_id = _create_run(db, "instagram", payload, task_id)
    saved  = 0

    for p in posts:
        stmt = pg_insert(InstagramPost).values(
            run_id               = run_id,
            instagram_id         = str(p["id"]),
            short_code           = p.get("shortCode"),
            url                  = p.get("url"),
            post_type            = p.get("type"),
            caption              = p.get("caption"),
            hashtags             = _j(p.get("hashtags", [])),
            mentions             = _j(p.get("mentions", [])),
            alt_text             = p.get("alt"),
            display_url          = p.get("displayUrl"),
            image_url            = p.get("images", [None])[0] if p.get("images") else None,
            owner_username       = p.get("ownerUsername"),
            owner_full_name      = p.get("ownerFullName"),
            owner_id             = str(p.get("ownerId", "")),
            likes_count          = p.get("likesCount", 0),
            comments_count       = p.get("commentsCount", 0),
            first_comment        = p.get("firstComment"),
            is_comments_disabled = p.get("isCommentsDisabled", False),
            timestamp            = _parse_dt(p.get("timestamp")),
        ).on_conflict_do_nothing(constraint="uq_instagram_post_id")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        post_row = db.query(InstagramPost).filter_by(instagram_id=str(p["id"])).first()
        if not post_row:
            continue

        for c in p.get("latestComments", []):
            db.add(InstagramComment(
                post_id        = post_row.id,
                comment_id     = str(c.get("id", "")),
                text           = c.get("text"),
                owner_username = c.get("ownerUsername"),
            ))
        if is_new:
            saved += 1

    db.commit()
    logger.info("Instagram: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Twitter
# ══════════════════════════════════════════════════════════════════════════════

def save_twitter(db: Session, payload: dict, task_id: str = "",
                 since_date: Optional[str] = None) -> int:
    from db_models import TwitterTweet

    cutoff = _since_dt(since_date)
    tweets = [t for t in payload.get("tweets", [])
              if _after_since(t, cutoff, "created_at", "date", "createdAt")]
    if not tweets:
        logger.warning("Twitter: no tweets in payload (after date filter)")
        return 0

    run_id = _create_run(db, "twitter", payload, task_id)
    saved  = 0

    for t in tweets:
        # GetXAPI normalised format (from getxapi_twitter._normalise)
        tweet_id = t.get("tweet_id") or t.get("id")
        if not tweet_id:
            continue

        author = t.get("author") or {}

        stmt = pg_insert(TwitterTweet).values(
            run_id               = run_id,
            tweet_id             = str(tweet_id),
            conversation_id      = "",
            screen_name          = author.get("username") or t.get("screen_name") or t.get("username"),
            text                 = t.get("text"),
            lang                 = t.get("lang"),
            favorites            = int(t.get("likes",      t.get("favorites",  0)) or 0),
            retweets             = int(t.get("retweets",   0) or 0),
            replies              = int(t.get("replies",    0) or 0),
            quotes               = int(t.get("quotes",     0) or 0),
            bookmarks            = int(t.get("bookmarks",  0) or 0),
            views                = int(t.get("views",      0) or 0),
            user_name            = author.get("name"),
            user_description     = author.get("bio"),
            user_followers_count = int(author.get("followers", 0) or 0),
            user_friends_count   = int(author.get("following", 0) or 0),
            user_verified        = bool(author.get("verified", False)),
            user_verified_type   = None,
            user_location        = author.get("location"),
            user_avatar          = author.get("profile_image"),
            hashtags             = _j(t.get("hashtags") or []),
            user_mentions        = _j([]),
            media_url            = t.get("media_url"),
            created_at           = _parse_dt(t.get("created_at")),
            scraped_at           = _parse_dt(payload.get("scraped_at")),
        ).on_conflict_do_nothing(constraint="uq_twitter_tweet_id")
        res    = db.execute(stmt)
        saved += res.rowcount

    db.commit()
    logger.info("Twitter: %d tweets saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Spiceworks
# ══════════════════════════════════════════════════════════════════════════════

def save_spiceworks(db: Session, payload: dict, task_id: str = "",
                    since_date: Optional[str] = None) -> int:
    from db_models import SpiceworksPost

    cutoff = _since_dt(since_date)
    posts  = [p for p in payload.get("posts", []) if _after_since(p, cutoff, "date")]
    if not posts:
        logger.warning("Spiceworks: no posts in payload (after date filter)")
        return 0

    run_id = _create_run(db, "spiceworks", payload, task_id)
    saved  = 0

    for p in posts:
        url = p.get("url")
        if not url:
            continue
        tags = p.get("tags")
        stmt = pg_insert(SpiceworksPost).values(
            run_id     = run_id,
            url        = url,
            title      = p.get("title"),
            author     = p.get("author"),
            body       = p.get("body"),
            source     = p.get("source", "Article"),
            category   = p.get("category"),
            tags       = _j(tags) if isinstance(tags, list) else tags,
            thumbnail  = p.get("thumbnail"),
            created_at = _parse_dt(p.get("date")),
            scraped_at = _parse_dt(payload.get("scraped_at")),
        ).on_conflict_do_nothing(constraint="uq_spiceworks_url")
        res = db.execute(stmt)
        if res.rowcount:
            saved += 1

    db.commit()
    logger.info("Spiceworks: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Quora
# ══════════════════════════════════════════════════════════════════════════════

def save_quora(db: Session, payload: dict, task_id: str = "",
               since_date: Optional[str] = None) -> int:
    from db_models import QuoraQuestion, QuoraAnswer

    cutoff    = _since_dt(since_date)
    questions = payload.get("questions", [])
    if not questions:
        logger.warning("Quora: no questions in payload")
        return 0

    run_id = _create_run(db, "quora", payload, task_id)
    saved  = 0

    for q in questions:
        url = q.get("url")
        if not url:
            continue

        # Date filter — use first answer date as proxy for question date
        if cutoff:
            answers = q.get("answers", [])
            dates   = [a.get("date") for a in answers if a.get("date")]
            if dates:
                earliest = min(dates)
                dt = _parse_dt(earliest)
                if dt and dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt and dt < cutoff:
                    continue

        topics = q.get("topics")
        stmt = pg_insert(QuoraQuestion).values(
            run_id         = run_id,
            url            = url,
            question_title = q.get("question_title"),
            topics         = _j(topics) if isinstance(topics, list) else topics,
            answer_count   = q.get("answer_count", 0),
            scraped_at     = _parse_dt(q.get("scraped_at")) or _parse_dt(payload.get("scraped_at")),
        ).on_conflict_do_nothing(constraint="uq_quora_url")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        q_row = db.query(QuoraQuestion).filter_by(url=url).first()
        if not q_row:
            continue

        if is_new:
            for a in q.get("answers", []):
                db.add(QuoraAnswer(
                    question_id       = q_row.id,
                    author_name       = a.get("author_name"),
                    author_credential = a.get("author_credential"),
                    content           = a.get("content"),
                    upvotes           = a.get("upvotes", 0),
                    views             = a.get("views",   0),
                    shares            = a.get("shares",  0),
                    comments_count    = a.get("comments_count", 0),
                    is_ai_answer      = a.get("is_ai_answer", False),
                    created_at        = _parse_dt(a.get("date")),
                ))
            saved += 1

    db.commit()
    logger.info("Quora: %d questions saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Facebook
# ══════════════════════════════════════════════════════════════════════════════

def save_facebook(db: Session, payload: dict, task_id: str = "",
                  since_date: Optional[str] = None) -> int:
    from db_models import FacebookPost, FacebookComment

    cutoff = _since_dt(since_date)
    posts  = [p for p in payload.get("posts", []) if _after_since(p, cutoff, "created_at")]
    if not posts:
        logger.warning("Facebook: no posts in payload (after date filter)")
        return 0

    run_id = _create_run(db, "facebook", payload, task_id)
    saved  = 0

    for post in posts:
        post_id = str(post.get("post_id") or post.get("id") or "")
        if not post_id:
            continue

        stmt = pg_insert(FacebookPost).values(
            run_id           = run_id,
            post_id          = post_id,
            group_url        = post.get("group_url"),
            url              = post.get("url"),
            permalink        = post.get("permalink"),
            text             = post.get("text"),
            image_url        = post.get("image_url"),
            video_view_count = int(post.get("video_view_count", 0) or 0),
            video_details    = post.get("video_details"),
            reaction_counts  = post.get("reaction_counts"),
            author           = post.get("author"),
            author_id        = str(post.get("author_id", "")),
            likes_count      = int(post.get("likes_count", 0) or 0),
            comments_count   = int(post.get("comments_count", 0) or 0),
            created_at       = _parse_dt(post.get("created_at")),
            scraped_at       = _parse_dt(payload.get("scraped_at")),
        ).on_conflict_do_nothing(constraint="uq_facebook_post_id")
        res    = db.execute(stmt)
        is_new = res.rowcount > 0

        post_row = db.query(FacebookPost).filter_by(post_id=post_id).first()
        if not post_row:
            continue

        if is_new:
            for c in post.get("matched_comments", []):
                db.add(FacebookComment(
                    post_id    = post_row.id,
                    comment_id = str(c.get("comment_id", "")),
                    text       = c.get("text"),
                    author     = c.get("author"),
                    created_at = _parse_dt(c.get("created_at")),
                ))
            saved += 1

    db.commit()
    logger.info("Facebook: %d posts saved to DB (run_id=%d)", saved, run_id)
    return saved


# ══════════════════════════════════════════════════════════════════════════════
#  Dispatcher — all scrapers
# ══════════════════════════════════════════════════════════════════════════════

SAVERS = {
    "reddit":        save_reddit,
    "tiktok":        save_tiktok,
    "edugeek":       save_edugeek,
    "autodesk":      save_autodesk,
    "stackexchange": save_stackexchange,
    "google_news":   save_google_news,
    "instagram":     save_instagram,
    "twitter":       save_twitter,
    "spiceworks":    save_spiceworks,
    "quora":         save_quora,
    "facebook":      save_facebook,
}


def save(scraper: str, db: Session, payload: dict, task_id: str = "",
         since_date: Optional[str] = None) -> int:
    """Entry point called from main.py after every scraper run."""
    fn = SAVERS.get(scraper)
    if fn is None:
        logger.warning("No DB writer registered for scraper: %s", scraper)
        return 0
    if db is None:
        return 0
    try:
        return fn(db, payload, task_id, since_date=since_date) or 0
    except Exception as exc:
        logger.error("DB write failed for %s: %s", scraper, exc)
        try:
            db.rollback()
        except Exception:
            pass
        return 0
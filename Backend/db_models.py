"""
db_models.py
============
SQLAlchemy ORM models for TrendSense.

Tables
------
  scrape_runs                   — audit log of every scraper run
  api_spending                  — per-call cost tracking
  user_budget                   — single-row overall monthly budget config
  budget_alert_emails           — alert email recipients
  scraper_budgets               — per-scraper monthly budget allocations
  llm_provider_config           — LLM API keys and selected models
  llm_spending                  — LLM token usage and cost tracking
  newsletter_jobs               — Google News webhook approval flow
  generated_newsletters         — AI-generated newsletters per article date
  scraper_keywords              — saved keywords (shared pool + google_news pool)
  reddit_posts / reddit_comments
  tiktok_posts / tiktok_comments
  edugeek_posts / edugeek_replies
  autodesk_posts / autodesk_replies
  stackexchange_questions / answers / question_comments / answer_comments
  google_news_articles
  instagram_posts / instagram_comments
  twitter_tweets
"""

from __future__ import annotations

import logging

logger = logging.getLogger("db_models")

try:
    from sqlalchemy import (
        Boolean, Column, DateTime, Float, ForeignKey,
        Integer, String, Text, BigInteger, UniqueConstraint, text,
    )
    from sqlalchemy.orm import relationship, declarative_base

    Base = declarative_base()
    _DB_AVAILABLE = True
except ImportError:
    Base = object
    _DB_AVAILABLE = False
    logger.warning("SQLAlchemy not installed — database features disabled")


if _DB_AVAILABLE:

    # ── Audit / cost tables ───────────────────────────────────────────────────

    class ScrapeRun(Base):
        __tablename__ = "scrape_runs"
        id          = Column(Integer,    primary_key=True)
        scraper     = Column(String(50), nullable=False, index=True)
        keyword     = Column(String(255))
        scraped_at  = Column(DateTime(timezone=True))
        total_items = Column(Integer,    default=0)
        task_id     = Column(String(64), index=True)

    class TaskHistory(Base):
        __tablename__ = "task_history"
        id          = Column(Integer,     primary_key=True)
        task_id     = Column(String(64),  nullable=False, unique=True, index=True)
        scraper     = Column(String(50),  nullable=False)
        status      = Column(String(20),  nullable=False, default="queued")
        started_at  = Column(DateTime(timezone=True), nullable=True)
        finished_at = Column(DateTime(timezone=True), nullable=True)
        keyword     = Column(String(255), nullable=True)
        items_count = Column(Integer,     default=0)
        error       = Column(Text,        nullable=True)

    class ApiSpending(Base):
        """Per-call cost tracking for every API provider."""
        __tablename__ = "api_spending"
        id           = Column(Integer,     primary_key=True)
        provider     = Column(String(50),  nullable=False, index=True)
        service      = Column(String(200), nullable=False)
        operation    = Column(String(100), nullable=False)
        scraper      = Column(String(50),  nullable=False, index=True)
        task_id      = Column(String(64),  nullable=True,  index=True)
        cost_usd     = Column(Float,       nullable=False, default=0.0)
        cost_units   = Column(Float,       nullable=True)
        is_estimated = Column(Boolean,     default=False)
        items_count  = Column(Integer,     default=0)
        keyword      = Column(String(255), nullable=True)
        called_at    = Column(DateTime(timezone=True), nullable=False)

    class UserBudget(Base):
        """Single-row (id=1) overall monthly budget configuration."""
        __tablename__ = "user_budget"
        id                  = Column(Integer, primary_key=True)
        monthly_limit_usd   = Column(Float,   nullable=False, default=1000.0)
        alert_threshold_pct = Column(Integer, nullable=False, default=80)
        updated_at          = Column(DateTime(timezone=True))

    class BudgetAlertEmail(Base):
        """One row per alert email recipient."""
        __tablename__ = "budget_alert_emails"
        id       = Column(Integer,     primary_key=True)
        email    = Column(String(320), nullable=False, unique=True, index=True)
        added_at = Column(DateTime(timezone=True))

    class ScraperBudget(Base):
        """
        Per-scraper monthly budget allocation.
        One row per scraper — created/updated via POST /api/spending/scraper-budgets.

        scraper values:
          reddit | tiktok | edugeek | stackexchange |
          autodesk | twitter | instagram | google_news

        When budget_usd == 0 the scraper has no individual cap.

        Threshold behaviour:
          >= 77%  → warning email sent
          >= 97%  → scraper run is blocked
        """
        __tablename__ = "scraper_budgets"
        id         = Column(Integer,    primary_key=True)
        scraper    = Column(String(50), nullable=False, unique=True, index=True)
        budget_usd = Column(Float,      nullable=False, default=0.0)
        updated_at = Column(DateTime(timezone=True))

    class ScraperCostConfig(Base):
        """Per-scraper cost rate configuration. Editable from UI or seeded from .env."""
        __tablename__ = "scraper_cost_config"
        id         = Column(Integer,    primary_key=True)
        scraper    = Column(String(50), nullable=False, unique=True, index=True)
        # cost_mode:
        #   "apify_real" → use actual Apify compute units (google_news, twitter, instagram)
        #   "per_item"   → cost_value / cost_per * items_count
        #   "per_run"    → flat cost_value per run
        #   "free"       → $0.00
        cost_mode  = Column(String(20), nullable=False, default="free")
        cost_value = Column(Float,      nullable=True)   # e.g. 11.0
        cost_per   = Column(Integer,    nullable=True)   # e.g. 1000
        updated_at = Column(DateTime(timezone=True))

    # ── LLM tables ────────────────────────────────────────────────────────────

    class LLMAnalysis(Base):
        """Stores every AI trend analysis result for history sidebar."""
        __tablename__ = "llm_analyses"
        id              = Column(Integer,     primary_key=True)
        provider        = Column(String(50),  nullable=True)
        model           = Column(String(100), nullable=True)
        raw_prompt      = Column(Text,        nullable=True)
        enhanced_prompt = Column(Text,        nullable=True)
        response        = Column(Text,        nullable=False)
        record_count    = Column(Integer,     default=0)
        tokens_used     = Column(Integer,     default=0)
        cost_usd        = Column(Float,       default=0.0)
        platforms       = Column(Text,        nullable=True)   # JSON array as string
        generated_at    = Column(DateTime(timezone=True), nullable=False, index=True)

    class LLMProviderConfig(Base):
        """Stores API keys and selected model per LLM provider. One row per provider."""
        __tablename__ = "llm_provider_config"
        id         = Column(Integer,     primary_key=True)
        provider   = Column(String(50),  nullable=False, unique=True, index=True)
        api_key    = Column(Text,        nullable=True)
        model      = Column(String(100), nullable=True)
        is_active  = Column(Boolean,     default=False)
        updated_at = Column(DateTime(timezone=True))

    class LLMSpending(Base):
        """Tracks token usage and cost for every LLM call."""
        __tablename__ = "llm_spending"
        id                = Column(Integer,     primary_key=True)
        provider          = Column(String(50),  nullable=False, index=True)
        model             = Column(String(100), nullable=False)
        operation         = Column(String(100), nullable=False)
        prompt_tokens     = Column(Integer,     default=0)
        completion_tokens = Column(Integer,     default=0)
        total_tokens      = Column(Integer,     default=0)
        cost_usd          = Column(Float,       default=0.0)
        is_estimated      = Column(Boolean,     default=False)
        keyword           = Column(String(255), nullable=True)
        called_at         = Column(DateTime(timezone=True), nullable=False)

    # ── Newsletter tables ─────────────────────────────────────────────────────

    class NewsletterJob(Base):
        """Tracks each Google News scrape → webhook approval flow."""
        __tablename__ = "newsletter_jobs"
        id                = Column(Integer,     primary_key=True)
        job_id            = Column(String(64),  nullable=False, unique=True, index=True)
        task_id           = Column(String(64),  nullable=True,  index=True)
        status            = Column(String(30),  nullable=False, default="pending_approval")
        # pending_approval | approved | rejected | generating | completed | failed
        keyword           = Column(String(255), nullable=True)
        article_count     = Column(Integer,     default=0)
        webhook_sent_at   = Column(DateTime(timezone=True), nullable=True)
        responded_at      = Column(DateTime(timezone=True), nullable=True)
        completed_at      = Column(DateTime(timezone=True), nullable=True)
        error             = Column(Text,        nullable=True)
        raw_articles_json = Column(Text,        nullable=True)
        created_at        = Column(DateTime(timezone=True), nullable=False)

    class GeneratedNewsletter(Base):
        """One newsletter per date of articles, per approval job."""
        __tablename__ = "generated_newsletters"
        id            = Column(Integer,     primary_key=True)
        job_id        = Column(String(64),  nullable=False, index=True)
        title         = Column(String(300), nullable=False)
        article_date  = Column(String(20),  nullable=False)   # "2026-05-10"
        provider      = Column(String(50),  nullable=True)
        model         = Column(String(100), nullable=True)
        content_json  = Column(Text,        nullable=False)
        content_raw   = Column(Text,        nullable=True)
        article_count = Column(Integer,     default=0)
        created_at    = Column(DateTime(timezone=True), nullable=False)

    # ── Reddit ────────────────────────────────────────────────────────────────

    class RedditPost(Base):
        __tablename__  = "reddit_posts"
        __table_args__ = (UniqueConstraint("reddit_id", name="uq_reddit_post_id"),)
        id            = Column(Integer,     primary_key=True)
        run_id        = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        reddit_id     = Column(String(20),  nullable=False)
        url           = Column(Text)
        subreddit     = Column(String(100), index=True)
        title         = Column(Text)
        body          = Column(Text)
        flair         = Column(String(255))
        is_nsfw       = Column(Boolean,     default=False)
        url_content   = Column(Text)
        author        = Column(String(100))
        score         = Column(Integer,     default=0)
        upvote_ratio  = Column(Float,       default=0)
        num_comments  = Column(Integer,     default=0)
        created_at    = Column(DateTime(timezone=True))
        comments      = relationship(
            "RedditComment", back_populates="post", cascade="all, delete-orphan"
        )

    class RedditComment(Base):
        __tablename__ = "reddit_comments"
        id                = Column(Integer,    primary_key=True)
        post_id           = Column(Integer,    ForeignKey("reddit_posts.id"),    index=True)
        parent_comment_id = Column(Integer,    ForeignKey("reddit_comments.id"), nullable=True)
        reddit_id         = Column(String(20))
        author            = Column(String(100))
        body              = Column(Text)
        score             = Column(Integer,    default=0)
        depth             = Column(Integer,    default=0)
        created_at        = Column(DateTime(timezone=True))
        post    = relationship("RedditPost",    back_populates="comments")
        replies = relationship(
            "RedditComment", back_populates="parent",
            foreign_keys=[parent_comment_id],
        )
        parent  = relationship(
            "RedditComment", back_populates="replies", remote_side=[id]
        )

    # ── TikTok ────────────────────────────────────────────────────────────────

    class TikTokPost(Base):
        __tablename__  = "tiktok_posts"
        __table_args__ = (UniqueConstraint("tiktok_id", name="uq_tiktok_post_id"),)
        id               = Column(Integer,     primary_key=True)
        run_id           = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        tiktok_id        = Column(String(30),  nullable=False)
        url              = Column(Text)
        title            = Column(Text)
        created_at       = Column(DateTime(timezone=True))
        author_username  = Column(String(100), index=True)
        author_nickname  = Column(String(200))
        author_verified  = Column(Boolean,     default=False)
        author_followers = Column(BigInteger,  default=0)
        author_following = Column(BigInteger,  default=0)
        author_likes     = Column(BigInteger,  default=0)
        author_bio       = Column(Text)
        plays            = Column(BigInteger,  default=0)
        likes            = Column(BigInteger,  default=0)
        comments_count   = Column(Integer,     default=0)
        shares           = Column(BigInteger,  default=0)
        saves            = Column(BigInteger,  default=0)
        duration_sec     = Column(Integer,     default=0)
        music_title      = Column(String(300))
        music_artist     = Column(String(200))
        hashtags         = Column(Text)
        comments = relationship(
            "TikTokComment", back_populates="post", cascade="all, delete-orphan"
        )

    class TikTokComment(Base):
        __tablename__ = "tiktok_comments"
        id                = Column(Integer,    primary_key=True)
        post_id           = Column(Integer,    ForeignKey("tiktok_posts.id"), index=True)
        tiktok_comment_id = Column(String(30))
        text              = Column(Text)
        likes             = Column(Integer,    default=0)
        reply_count       = Column(Integer,    default=0)
        author_username   = Column(String(100))
        author_nickname   = Column(String(200))
        created_at        = Column(DateTime(timezone=True))
        post = relationship("TikTokPost", back_populates="comments")

    # ── EduGeek ───────────────────────────────────────────────────────────────

    class EduGeekPost(Base):
        __tablename__  = "edugeek_posts"
        __table_args__ = (UniqueConstraint("edugeek_id", name="uq_edugeek_post_id"),)
        id          = Column(Integer,     primary_key=True)
        run_id      = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        edugeek_id  = Column(String(100), nullable=False)
        url         = Column(Text)
        category    = Column(String(50),  index=True)
        title       = Column(Text)
        body        = Column(Text)
        author      = Column(String(200))
        author_rep  = Column(String(50))
        created_at  = Column(DateTime(timezone=True))
        reply_count = Column(Integer,     default=0)
        replies = relationship(
            "EduGeekReply", back_populates="post", cascade="all, delete-orphan"
        )

    class EduGeekReply(Base):
        __tablename__ = "edugeek_replies"
        id         = Column(Integer,    primary_key=True)
        post_id    = Column(Integer,    ForeignKey("edugeek_posts.id"), index=True)
        reply_id   = Column(String(50))
        author     = Column(String(200))
        body       = Column(Text)
        created_at = Column(DateTime(timezone=True))
        post = relationship("EduGeekPost", back_populates="replies")

    # ── Autodesk ──────────────────────────────────────────────────────────────

    class AutodeskPost(Base):
        __tablename__  = "autodesk_posts"
        __table_args__ = (UniqueConstraint("autodesk_id", name="uq_autodesk_post_id"),)
        id               = Column(Integer,    primary_key=True)
        run_id           = Column(Integer,    ForeignKey("scrape_runs.id"), index=True)
        autodesk_id      = Column(String(50), nullable=False)
        url              = Column(Text)
        content_type     = Column(String(20), index=True)
        subject          = Column(Text)
        body             = Column(Text)
        is_solved        = Column(Boolean,    default=False)
        reply_count      = Column(Integer,    default=0)
        kudos            = Column(Integer,    default=0)
        board_id         = Column(String(100))
        board_title      = Column(String(300))
        author_id        = Column(String(50))
        author_username  = Column(String(200))
        author_rank      = Column(String(100))
        author_kudos     = Column(Integer,    default=0)
        author_messages  = Column(Integer,    default=0)
        author_solutions = Column(Integer,    default=0)
        author_registered = Column(DateTime(timezone=True), nullable=True)
        created_at       = Column(DateTime(timezone=True))
        replies = relationship(
            "AutodeskReply", back_populates="post", cascade="all, delete-orphan"
        )

    class AutodeskReply(Base):
        __tablename__ = "autodesk_replies"
        id              = Column(Integer,    primary_key=True)
        post_id         = Column(Integer,    ForeignKey("autodesk_posts.id"), index=True)
        autodesk_id     = Column(String(50))
        url             = Column(Text)
        subject         = Column(Text)
        body            = Column(Text)
        kudos           = Column(Integer,    default=0)
        is_solved       = Column(Boolean,    default=False)
        author_id       = Column(String(50))
        author_username = Column(String(200))
        author_rank     = Column(String(100))
        created_at      = Column(DateTime(timezone=True))
        post = relationship("AutodeskPost", back_populates="replies")

    # ── StackExchange ─────────────────────────────────────────────────────────

    class StackExchangeQuestion(Base):
        __tablename__  = "stackexchange_questions"
        __table_args__ = (UniqueConstraint("question_id", "site", name="uq_se_question_site"),)
        id                = Column(Integer,     primary_key=True)
        run_id            = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        question_id       = Column(Integer,     nullable=False)
        site              = Column(String(100), nullable=False, index=True)
        url               = Column(Text)
        title             = Column(Text)
        body              = Column(Text)
        tags              = Column(Text)
        is_answered       = Column(Boolean,     default=False)
        author_username   = Column(String(200))
        author_reputation = Column(Integer,     default=0)
        author_user_id    = Column(Integer)
        score             = Column(Integer,     default=0)
        views             = Column(Integer,     default=0)
        answer_count      = Column(Integer,     default=0)
        created_at        = Column(DateTime(timezone=True))
        last_activity     = Column(DateTime(timezone=True))
        answers           = relationship(
            "StackExchangeAnswer", back_populates="question", cascade="all, delete-orphan"
        )
        question_comments = relationship(
            "StackExchangeQuestionComment", back_populates="question", cascade="all, delete-orphan"
        )

    class StackExchangeAnswer(Base):
        __tablename__ = "stackexchange_answers"
        id                = Column(Integer,     primary_key=True)
        question_id       = Column(Integer,     ForeignKey("stackexchange_questions.id"), index=True)
        answer_id         = Column(Integer)
        body              = Column(Text)
        is_accepted       = Column(Boolean,     default=False)
        score             = Column(Integer,     default=0)
        author_username   = Column(String(200))
        author_reputation = Column(Integer,     default=0)
        author_user_id    = Column(Integer)
        created_at        = Column(DateTime(timezone=True))
        question        = relationship("StackExchangeQuestion", back_populates="answers")
        answer_comments = relationship(
            "StackExchangeAnswerComment", back_populates="answer", cascade="all, delete-orphan"
        )

    class StackExchangeQuestionComment(Base):
        __tablename__ = "stackexchange_question_comments"
        id                = Column(Integer,     primary_key=True)
        question_id       = Column(Integer,     ForeignKey("stackexchange_questions.id"), index=True)
        comment_id        = Column(Integer)
        body              = Column(Text)
        score             = Column(Integer,     default=0)
        author_username   = Column(String(200))
        author_reputation = Column(Integer,     default=0)
        created_at        = Column(DateTime(timezone=True))
        question = relationship("StackExchangeQuestion", back_populates="question_comments")

    class StackExchangeAnswerComment(Base):
        __tablename__ = "stackexchange_answer_comments"
        id                = Column(Integer,     primary_key=True)
        answer_id         = Column(Integer,     ForeignKey("stackexchange_answers.id"), index=True)
        comment_id        = Column(Integer)
        body              = Column(Text)
        score             = Column(Integer,     default=0)
        author_username   = Column(String(200))
        author_reputation = Column(Integer,     default=0)
        created_at        = Column(DateTime(timezone=True))
        answer = relationship("StackExchangeAnswer", back_populates="answer_comments")

    # ── Google News ───────────────────────────────────────────────────────────

    class GoogleNewsArticle(Base):
        __tablename__  = "google_news_articles"
        __table_args__ = (UniqueConstraint("google_news_url", name="uq_gnews_url"),)
        id              = Column(Integer,     primary_key=True)
        run_id          = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        title           = Column(Text)
        source_name     = Column(String(300), index=True)
        google_news_url = Column(Text,        nullable=False)
        description     = Column(Text)
        image_url       = Column(Text)
        search_query    = Column(String(300))
        published_at    = Column(DateTime(timezone=True))
        scraped_at      = Column(DateTime(timezone=True))

    # ── Instagram ─────────────────────────────────────────────────────────────

    class InstagramPost(Base):
        __tablename__  = "instagram_posts"
        __table_args__ = (UniqueConstraint("instagram_id", name="uq_instagram_post_id"),)
        id                   = Column(Integer,    primary_key=True)
        run_id               = Column(Integer,    ForeignKey("scrape_runs.id"), index=True)
        instagram_id         = Column(String(30), nullable=False)
        short_code           = Column(String(30))
        url                  = Column(Text)
        post_type            = Column(String(30))
        caption              = Column(Text)
        hashtags             = Column(Text)
        mentions             = Column(Text)
        alt_text             = Column(Text)
        display_url          = Column(Text)
        image_url            = Column(Text)
        owner_username       = Column(String(200), index=True)
        owner_full_name      = Column(String(300))
        owner_id             = Column(String(50))
        likes_count          = Column(Integer,     default=0)
        comments_count       = Column(Integer,     default=0)
        first_comment        = Column(Text)
        is_comments_disabled = Column(Boolean,     default=False)
        timestamp            = Column(DateTime(timezone=True))
        comments = relationship(
            "InstagramComment", back_populates="post", cascade="all, delete-orphan"
        )

    class InstagramComment(Base):
        __tablename__ = "instagram_comments"
        id             = Column(Integer,    primary_key=True)
        post_id        = Column(Integer,    ForeignKey("instagram_posts.id"), index=True)
        comment_id     = Column(String(30))
        text           = Column(Text)
        owner_username = Column(String(200))
        post = relationship("InstagramPost", back_populates="comments")

    # ── Facebook ─────────────────────────────────────────────────────────────

    class FacebookPost(Base):
        __tablename__  = "facebook_posts"
        __table_args__ = (UniqueConstraint("post_id", name="uq_facebook_post_id"),)
        id               = Column(Integer,     primary_key=True)
        run_id           = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        post_id          = Column(String(50),  nullable=False)
        group_url        = Column(Text)
        url              = Column(Text)
        permalink        = Column(Text)
        text             = Column(Text)
        image_url        = Column(Text)
        video_view_count = Column(Integer,     default=0)
        video_details    = Column(Text)
        reaction_counts  = Column(Text)
        author           = Column(Text)
        author_id        = Column(Text)
        likes_count      = Column(Integer,     default=0)
        comments_count   = Column(Integer,     default=0)
        created_at       = Column(DateTime(timezone=True))
        scraped_at       = Column(DateTime(timezone=True))
        comments = relationship(
            "FacebookComment", back_populates="post", cascade="all, delete-orphan"
        )

    class FacebookComment(Base):
        __tablename__ = "facebook_comments"
        id         = Column(Integer,     primary_key=True)
        post_id    = Column(Integer,     ForeignKey("facebook_posts.id"), index=True)
        comment_id = Column(String(50))
        text       = Column(Text)
        author     = Column(String(300))
        created_at = Column(DateTime(timezone=True))
        post = relationship("FacebookPost", back_populates="comments")

    # ── Spiceworks ────────────────────────────────────────────────────────────

    class SpiceworksPost(Base):
        __tablename__  = "spiceworks_posts"
        __table_args__ = (UniqueConstraint("url", name="uq_spiceworks_url"),)
        id         = Column(Integer,     primary_key=True)
        run_id     = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        url        = Column(Text,        nullable=False)
        title      = Column(Text)
        author     = Column(String(300))
        body       = Column(Text)
        source     = Column(String(50),  default="Article")
        category   = Column(String(100), nullable=True)
        tags       = Column(Text,        nullable=True)   # JSON array string
        thumbnail  = Column(Text,        nullable=True)
        created_at = Column(DateTime(timezone=True))
        scraped_at = Column(DateTime(timezone=True))

    # ── Quora ─────────────────────────────────────────────────────────────────

    class QuoraQuestion(Base):
        __tablename__  = "quora_questions"
        __table_args__ = (UniqueConstraint("url", name="uq_quora_url"),)
        id             = Column(Integer,     primary_key=True)
        run_id         = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        url            = Column(Text,        nullable=False)
        question_title = Column(Text)
        topics         = Column(Text,        nullable=True)   # JSON array string
        answer_count   = Column(Integer,     default=0)
        scraped_at     = Column(DateTime(timezone=True))
        answers = relationship(
            "QuoraAnswer", back_populates="question", cascade="all, delete-orphan"
        )

    class QuoraAnswer(Base):
        __tablename__ = "quora_answers"
        id                 = Column(Integer,     primary_key=True)
        question_id        = Column(Integer,     ForeignKey("quora_questions.id"), index=True)
        author_name        = Column(String(300))
        author_credential  = Column(Text)
        content            = Column(Text)
        upvotes            = Column(Integer,     default=0)
        views              = Column(Integer,     default=0)
        shares             = Column(Integer,     default=0)
        comments_count     = Column(Integer,     default=0)
        is_ai_answer       = Column(Boolean,     default=False)
        created_at         = Column(DateTime(timezone=True))
        question = relationship("QuoraQuestion", back_populates="answers")

    # ── Twitter / X ───────────────────────────────────────────────────────────

    class TwitterTweet(Base):
        __tablename__  = "twitter_tweets"
        __table_args__ = (UniqueConstraint("tweet_id", name="uq_twitter_tweet_id"),)
        id                   = Column(Integer,     primary_key=True)
        run_id               = Column(Integer,     ForeignKey("scrape_runs.id"), index=True)
        tweet_id             = Column(String(30),  nullable=False)
        conversation_id      = Column(String(30))
        screen_name          = Column(String(100), index=True)
        text                 = Column(Text)
        lang                 = Column(String(10))
        favorites            = Column(Integer,     default=0)
        retweets             = Column(Integer,     default=0)
        replies              = Column(Integer,     default=0)
        quotes               = Column(Integer,     default=0)
        bookmarks            = Column(Integer,     default=0)
        views                = Column(BigInteger,  default=0)
        user_name            = Column(String(200))
        user_description     = Column(Text)
        user_followers_count = Column(Integer,     default=0)
        user_friends_count   = Column(Integer,     default=0)
        user_verified        = Column(Boolean,     default=False)
        user_verified_type   = Column(String(50))
        user_location        = Column(String(300))
        user_avatar          = Column(Text)
        hashtags             = Column(Text)
        user_mentions        = Column(Text)
        media_url            = Column(Text)
        created_at           = Column(DateTime(timezone=True))
        scraped_at           = Column(DateTime(timezone=True))


    class ScraperKeyword(Base):
        __tablename__ = "scraper_keywords"
        __table_args__ = (UniqueConstraint("keyword", "pool", name="uq_scraper_keyword_pool"),)
        id         = Column(Integer,     primary_key=True)
        keyword    = Column(String(500), nullable=False)
        pool       = Column(String(20),  nullable=False, default="shared")  # "shared" | "google_news"
        created_at = Column(DateTime(timezone=True))

    class ScraperKeywordSelection(Base):
        """Which keyword IDs are selected per scraper (persists across sessions)."""
        __tablename__  = "scraper_keyword_selections"
        __table_args__ = (UniqueConstraint("scraper", "keyword_id", name="uq_scraper_kw_sel"),)
        id         = Column(Integer,    primary_key=True)
        scraper    = Column(String(50), nullable=False, index=True)
        keyword_id = Column(Integer,    ForeignKey("scraper_keywords.id", ondelete="CASCADE"), nullable=False)

    class FacebookGroup(Base):
        """User-saved Facebook groups for the scraper (name + URL)."""
        __tablename__  = "facebook_groups"
        __table_args__ = (UniqueConstraint("url", name="uq_facebook_group_url"),)
        id         = Column(Integer,     primary_key=True)
        name       = Column(String(300), nullable=False)
        url        = Column(Text,        nullable=False)
        created_at = Column(DateTime(timezone=True))

    class SmartBrainAnalysis(Base):
        __tablename__ = "smart_brain_analyses"
        id              = Column(Integer,       primary_key=True, autoincrement=True)
        result          = Column(Text)
        provider        = Column(String(50))
        model           = Column(String(100))
        tokens_used     = Column(Integer,  default=0)
        cost_usd        = Column(Float,    default=0.0)
        enhanced_prompt = Column(Text)
        prompt_used     = Column(Text)
        record_count    = Column(Integer,  default=0)
        created_at      = Column(DateTime(timezone=True), server_default=text("now()"))


# ── Stub classes when SQLAlchemy is not installed ─────────────────────────────
else:
    class ScrapeRun: pass                       # type: ignore[no-redef]
    class ApiSpending: pass                     # type: ignore[no-redef]
    class UserBudget: pass                      # type: ignore[no-redef]
    class BudgetAlertEmail: pass                # type: ignore[no-redef]
    class ScraperBudget: pass                   # type: ignore[no-redef]
    class LLMAnalysis: pass                      # type: ignore[no-redef]
    class LLMProviderConfig: pass               # type: ignore[no-redef]
    class LLMSpending: pass                     # type: ignore[no-redef]
    class NewsletterJob: pass                   # type: ignore[no-redef]
    class GeneratedNewsletter: pass             # type: ignore[no-redef]
    class RedditPost: pass                      # type: ignore[no-redef]
    class RedditComment: pass                   # type: ignore[no-redef]
    class TikTokPost: pass                      # type: ignore[no-redef]
    class TikTokComment: pass                   # type: ignore[no-redef]
    class EduGeekPost: pass                     # type: ignore[no-redef]
    class EduGeekReply: pass                    # type: ignore[no-redef]
    class AutodeskPost: pass                    # type: ignore[no-redef]
    class AutodeskReply: pass                   # type: ignore[no-redef]
    class StackExchangeQuestion: pass           # type: ignore[no-redef]
    class StackExchangeAnswer: pass             # type: ignore[no-redef]
    class StackExchangeQuestionComment: pass    # type: ignore[no-redef]
    class StackExchangeAnswerComment: pass      # type: ignore[no-redef]
    class GoogleNewsArticle: pass               # type: ignore[no-redef]
    class InstagramPost: pass                   # type: ignore[no-redef]
    class InstagramComment: pass                # type: ignore[no-redef]
    class TwitterTweet: pass                    # type: ignore[no-redef]
    class FacebookPost: pass                    # type: ignore[no-redef]
    class FacebookComment: pass                # type: ignore[no-redef]
    class SpiceworksPost: pass                  # type: ignore[no-redef]
    class QuoraQuestion: pass                  # type: ignore[no-redef]
    class QuoraAnswer: pass                    # type: ignore[no-redef]
    class TaskHistory: pass                    # type: ignore[no-redef]
    class ScraperKeyword: pass                 # type: ignore[no-redef]
    class ScraperKeywordSelection: pass        # type: ignore[no-redef]
    class FacebookGroup: pass                  # type: ignore[no-redef]
    class SmartBrainAnalysis: pass             # type: ignore[no-redef]
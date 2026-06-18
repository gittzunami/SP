"""
infrastructure/database/models/newsletter.py
============================================
Newsletter domain tables:
  newsletter_jobs, generated_newsletters
"""

from __future__ import annotations

from .base import Base, DB_AVAILABLE

if DB_AVAILABLE:
    from sqlalchemy import (
        Column, DateTime, Integer, String, Text,
    )

    class NewsletterJob(Base):
        __tablename__ = "newsletter_jobs"
        id                = Column(Integer,     primary_key=True)
        job_id            = Column(String(64),  nullable=False, unique=True, index=True)
        task_id           = Column(String(64),  nullable=True,  index=True)
        status            = Column(String(30),  nullable=False, default="pending_approval")
        keyword           = Column(String(255), nullable=True)
        article_count     = Column(Integer,     default=0)
        webhook_sent_at   = Column(DateTime(timezone=True), nullable=True)
        responded_at      = Column(DateTime(timezone=True), nullable=True)
        completed_at      = Column(DateTime(timezone=True), nullable=True)
        error             = Column(Text,        nullable=True)
        raw_articles_json = Column(Text,        nullable=True)
        created_at        = Column(DateTime(timezone=True), nullable=False)

    class GeneratedNewsletter(Base):
        __tablename__ = "generated_newsletters"
        id            = Column(Integer,     primary_key=True)
        job_id        = Column(String(64),  nullable=False, index=True)
        title         = Column(String(300), nullable=False)
        article_date  = Column(String(20),  nullable=False)
        provider      = Column(String(50),  nullable=True)
        model         = Column(String(100), nullable=True)
        content_json  = Column(Text,        nullable=False)
        content_raw   = Column(Text,        nullable=True)
        article_count = Column(Integer,     default=0)
        created_at    = Column(DateTime(timezone=True), nullable=False)

else:
    class NewsletterJob: pass        # type: ignore[no-redef]
    class GeneratedNewsletter: pass  # type: ignore[no-redef]

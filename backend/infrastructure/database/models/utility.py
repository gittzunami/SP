"""
infrastructure/database/models/utility.py
==========================================
Utility / audit tables:
  scrape_runs, task_history,
  scraper_keywords, scraper_keyword_selections,
  facebook_groups, smart_brain_analyses
"""

from __future__ import annotations

from .base import Base, DB_AVAILABLE

if DB_AVAILABLE:
    from sqlalchemy import (
        Boolean, Column, DateTime, Float, ForeignKey,
        Integer, String, Text, UniqueConstraint, text,
    )
    from sqlalchemy.orm import relationship

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

    class ScraperKeyword(Base):
        __tablename__  = "scraper_keywords"
        __table_args__ = (UniqueConstraint("keyword", "pool", name="uq_scraper_keyword_pool"),)
        id         = Column(Integer,     primary_key=True)
        keyword    = Column(String(500), nullable=False)
        pool       = Column(String(20),  nullable=False, default="shared")
        created_at = Column(DateTime(timezone=True))

    class ScraperKeywordSelection(Base):
        __tablename__  = "scraper_keyword_selections"
        __table_args__ = (UniqueConstraint("scraper", "keyword_id", name="uq_scraper_kw_sel"),)
        id         = Column(Integer,    primary_key=True)
        scraper    = Column(String(50), nullable=False, index=True)
        keyword_id = Column(Integer,    ForeignKey("scraper_keywords.id", ondelete="CASCADE"), nullable=False)

    class FacebookGroup(Base):
        __tablename__  = "facebook_groups"
        __table_args__ = (UniqueConstraint("url", name="uq_facebook_group_url"),)
        id         = Column(Integer,     primary_key=True)
        name       = Column(String(300), nullable=False)
        url        = Column(Text,        nullable=False)
        created_at = Column(DateTime(timezone=True))

    class SmartBrainAnalysis(Base):
        __tablename__ = "smart_brain_analyses"
        id              = Column(Integer,  primary_key=True, autoincrement=True)
        result          = Column(Text)
        provider        = Column(String(50))
        model           = Column(String(100))
        tokens_used     = Column(Integer,  default=0)
        cost_usd        = Column(Float,    default=0.0)
        enhanced_prompt = Column(Text)
        prompt_used     = Column(Text)
        record_count    = Column(Integer,  default=0)
        created_at      = Column(DateTime(timezone=True), server_default=text("now()"))

else:
    class ScrapeRun: pass               # type: ignore[no-redef]
    class TaskHistory: pass             # type: ignore[no-redef]
    class ScraperKeyword: pass          # type: ignore[no-redef]
    class ScraperKeywordSelection: pass # type: ignore[no-redef]
    class FacebookGroup: pass           # type: ignore[no-redef]
    class SmartBrainAnalysis: pass      # type: ignore[no-redef]

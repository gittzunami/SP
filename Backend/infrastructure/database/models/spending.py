"""
infrastructure/database/models/spending.py
==========================================
Cost governance tables:
  api_spending, user_budget, budget_alert_emails,
  scraper_budgets, scraper_cost_config
"""

from __future__ import annotations

from .base import Base, DB_AVAILABLE

if DB_AVAILABLE:
    from sqlalchemy import (
        Boolean, Column, DateTime, Float, Integer, String, Text,
    )

    class ApiSpending(Base):
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
        __tablename__ = "user_budget"
        id                  = Column(Integer, primary_key=True)
        monthly_limit_usd   = Column(Float,   nullable=False, default=1000.0)
        alert_threshold_pct = Column(Integer, nullable=False, default=80)
        updated_at          = Column(DateTime(timezone=True))

    class BudgetAlertEmail(Base):
        __tablename__ = "budget_alert_emails"
        id       = Column(Integer,     primary_key=True)
        email    = Column(String(320), nullable=False, unique=True, index=True)
        added_at = Column(DateTime(timezone=True))

    class ScraperBudget(Base):
        __tablename__ = "scraper_budgets"
        id         = Column(Integer,    primary_key=True)
        scraper    = Column(String(50), nullable=False, unique=True, index=True)
        budget_usd = Column(Float,      nullable=False, default=0.0)
        updated_at = Column(DateTime(timezone=True))

    class ScraperCostConfig(Base):
        __tablename__ = "scraper_cost_config"
        id         = Column(Integer,    primary_key=True)
        scraper    = Column(String(50), nullable=False, unique=True, index=True)
        cost_mode  = Column(String(20), nullable=False, default="free")
        cost_value = Column(Float,      nullable=True)
        cost_per   = Column(Integer,    nullable=True)
        updated_at = Column(DateTime(timezone=True))

else:
    class ApiSpending: pass       # type: ignore[no-redef]
    class UserBudget: pass        # type: ignore[no-redef]
    class BudgetAlertEmail: pass  # type: ignore[no-redef]
    class ScraperBudget: pass     # type: ignore[no-redef]
    class ScraperCostConfig: pass # type: ignore[no-redef]

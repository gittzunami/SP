"""
infrastructure/database/models/base.py
=======================================
Declares the single SQLAlchemy declarative Base that all ORM models inherit from.
All model files import Base from here — never re-declare it elsewhere.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("db_models")

try:
    from sqlalchemy.orm import declarative_base

    Base = declarative_base()
    DB_AVAILABLE = True
except ImportError:
    Base = object  # type: ignore[assignment,misc]
    DB_AVAILABLE = False
    logger.warning("SQLAlchemy not installed — database features disabled")

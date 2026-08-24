"""
infrastructure/database/models/user_preferences.py
====================================================
Generic key-value store for UI/user preferences.
Replaces all localStorage-based UI state persistence.

infrastructure/database/models/saved_prompt.py
=================================================
Stores user-saved Smart Brain prompt templates.
Each "Save Prompt" action inserts a new row — full history preserved.
"""

from __future__ import annotations

from .base import Base, DB_AVAILABLE

if DB_AVAILABLE:
    from datetime import datetime, timezone
    from sqlalchemy import Column, DateTime, Integer, String, Text

    class UserPreferences(Base):
        __tablename__ = "user_preferences"

        id         = Column(Integer, primary_key=True, autoincrement=True)
        key        = Column(String(100), unique=True, nullable=False, index=True)
        value      = Column(Text, nullable=True)
        updated_at = Column(
            DateTime(timezone=True),
            default=lambda: datetime.now(timezone.utc),
            onupdate=lambda: datetime.now(timezone.utc),
        )

else:
    class UserPreferences:  # type: ignore[no-redef]
        pass

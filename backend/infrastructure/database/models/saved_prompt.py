"""
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

    class SavedPrompt(Base):
        __tablename__ = "saved_prompts"

        id         = Column(Integer, primary_key=True, autoincrement=True)
        text       = Column(Text, nullable=False)
        label      = Column(String(255), nullable=True)
        created_at = Column(
            DateTime(timezone=True),
            default=lambda: datetime.now(timezone.utc),
        )
        updated_at = Column(
            DateTime(timezone=True),
            default=lambda: datetime.now(timezone.utc),
            onupdate=lambda: datetime.now(timezone.utc),
        )

else:
    class SavedPrompt:  # type: ignore[no-redef]
        pass

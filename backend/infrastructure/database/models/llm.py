"""
infrastructure/database/models/llm.py
======================================
LLM domain tables:
  llm_analyses, llm_provider_config, llm_spending
"""

from __future__ import annotations

from .base import Base, DB_AVAILABLE

if DB_AVAILABLE:
    from sqlalchemy import (
        Boolean, Column, DateTime, Float, Integer, String, Text,
    )

    class LLMAnalysis(Base):
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
        platforms       = Column(Text,        nullable=True)
        generated_at    = Column(DateTime(timezone=True), nullable=False, index=True)

    class LLMProviderConfig(Base):
        __tablename__ = "llm_provider_config"
        id         = Column(Integer,     primary_key=True)
        provider   = Column(String(50),  nullable=False, unique=True, index=True)
        api_key    = Column(Text,        nullable=True)
        model      = Column(String(100), nullable=True)
        is_active  = Column(Boolean,     default=False)
        updated_at = Column(DateTime(timezone=True))

    class LLMSpending(Base):
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

else:
    class LLMAnalysis: pass        # type: ignore[no-redef]
    class LLMProviderConfig: pass  # type: ignore[no-redef]
    class LLMSpending: pass        # type: ignore[no-redef]

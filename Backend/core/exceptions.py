"""
core/exceptions.py
==================
Domain-specific exceptions for TrendSense.

Usage:
    raise ScraperNotFoundError("twitterx")
    raise BudgetExceededError("monthly cap reached")
"""

from __future__ import annotations


class TrendSenseError(Exception):
    """Base for all application-level errors."""


class ScraperNotFoundError(TrendSenseError, ValueError):
    """Raised when an unknown scraper name is requested."""


class BudgetExceededError(TrendSenseError, RuntimeError):
    """Raised when a spending budget cap has been reached."""


class TaskNotFoundError(TrendSenseError, KeyError):
    """Raised when a task ID is not found in the registry."""


class LLMNotConfiguredError(TrendSenseError, RuntimeError):
    """Raised when no active LLM provider is configured."""


class ScheduleNotFoundError(TrendSenseError, KeyError):
    """Raised when a schedule job ID does not exist."""

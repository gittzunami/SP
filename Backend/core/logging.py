"""
core/logging.py
===============
Centralized logging configuration for TrendSense.

Call `setup_logging()` once at process startup (inside create_app).
All loggers acquired with `logging.getLogger(__name__)` inherit this format.
"""

from __future__ import annotations

import logging
import sys


class _WindowsConnectionResetFilter(logging.Filter):
    """
    Silences the harmless WinError 10054 noise that asyncio/uvicorn emits on
    Windows when a browser tab closes or cancels a request mid-flight.
    The error is in the OS transport layer — no application code is at fault.
    """
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "WinError 10054" not in msg and "ConnectionResetError" not in msg


def setup_logging(level: str = "INFO") -> None:
    """Configure root logger with a structured human-readable format."""
    numeric = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        level   = numeric,
        format  = "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
        datefmt = "%Y-%m-%d %H:%M:%S",
        stream  = sys.stdout,
        force   = True,   # override any earlier basicConfig call
    )

    # Filter WinError 10054 from asyncio — benign Windows transport noise
    _filter = _WindowsConnectionResetFilter()
    logging.getLogger("asyncio").addFilter(_filter)

    # Suppress noisy third-party loggers
    for noisy in (
        "uvicorn.access",
        "httpx",
        "httpcore",
        "apscheduler.scheduler",
        "apscheduler.executors.default",
        "multipart.multipart",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Convenience wrapper: returns a named logger."""
    return logging.getLogger(name)

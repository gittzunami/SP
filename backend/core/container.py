"""
core/container.py
=================
Application state container — holds shared mutable state that was previously
scattered as module-level globals in main.py.

Import `state` anywhere to access or mutate task_registry and scraper_status.
"""

from __future__ import annotations
from typing import Any, Dict, Optional


VALID_SCRAPERS: frozenset = frozenset({
    "reddit", "tiktok", "edugeek", "stackexchange", "autodesk",
    "twitter", "instagram", "google_news", "spiceworks", "quora", "facebook",
})


class AppState:
    """Single shared-state object instantiated once at module import."""

    def __init__(self) -> None:
        self.task_registry: Dict[str, Dict[str, Any]] = {}
        # batch_id of the currently in-flight auto-scrape webhook batch, or
        # None if no batch is active. Prevents the webhook from starting an
        # overlapping batch while a previous one (which can legitimately run
        # for many hours) is still working — resets to None on process
        # restart, so a stuck batch never permanently blocks future runs.
        self.auto_scrape_batch_id: Optional[str] = None
        self.scraper_status: Dict[str, Dict[str, Any]] = {
            s: {
                "last_run":               None,
                "last_file":              None,
                "total_runs":             0,
                "running":                False,
                "last_total_items":       None,
                "last_newsletters_created": None,
            }
            for s in VALID_SCRAPERS
        }


# Module-level singleton — import this everywhere
state = AppState()

"""api/routers/results.py — JSON result file browser endpoints."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi import Path as FPath
from fastapi.responses import FileResponse, JSONResponse

RESULTS_DIR = Path("results")
RESULTS_DIR.mkdir(exist_ok=True)

VALID_SCRAPERS = frozenset({
    "reddit", "tiktok", "edugeek", "stackexchange", "autodesk",
    "twitter", "instagram", "google_news", "spiceworks", "quora", "facebook",
})

router = APIRouter(prefix="/api/results", tags=["Results"])


@router.get("")
def list_results():
    files = sorted(
        [f for f in RESULTS_DIR.glob("*.json") if not f.name.startswith("seen_ids")],
        key=lambda f: f.stat().st_mtime, reverse=True,
    )
    return {
        "total": len(files),
        "files": [
            {
                "name":        f.name,
                "scraper":     f.name.split("_")[0],
                "size_kb":     round(f.stat().st_size / 1024, 1),
                "modified_at": datetime.fromtimestamp(
                    f.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            }
            for f in files
        ],
    }


@router.get("/download/{filename}")
def download_result(filename: str = FPath(...)):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename.")
    path = RESULTS_DIR / filename
    if not path.exists():
        raise HTTPException(404, f"File '{filename}' not found.")
    return FileResponse(
        path=path, media_type="application/json", filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/view/{filename}")
def view_result(filename: str = FPath(...)):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename.")
    path = RESULTS_DIR / filename
    if not path.exists():
        raise HTTPException(404, f"File '{filename}' not found.")
    return JSONResponse(content=json.loads(path.read_text(encoding="utf-8")))


@router.get("/{scraper}")
def list_results_for_scraper(scraper: str = FPath(...)):
    if scraper not in VALID_SCRAPERS:
        raise HTTPException(400, f"Unknown scraper '{scraper}'. Valid: {sorted(VALID_SCRAPERS)}")
    files = sorted(
        RESULTS_DIR.glob(f"{scraper}_*.json"),
        key=lambda f: f.stat().st_mtime, reverse=True,
    )
    return {
        "scraper": scraper,
        "total":   len(files),
        "files": [
            {
                "name":        f.name,
                "size_kb":     round(f.stat().st_size / 1024, 1),
                "modified_at": datetime.fromtimestamp(
                    f.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            }
            for f in files
        ],
    }

"""api/routers/search.py — Search, export, and single-record endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Path as FPath
from sqlalchemy.orm import Session

from database import get_db

logger = logging.getLogger("search")
router = APIRouter(tags=["Search"])


@router.get("/api/keywords/used")
def get_used_keywords(db: Session = Depends(get_db)):
    from db_models import ScrapeRun, GoogleNewsArticle
    run_kws   = [r[0] for r in db.query(ScrapeRun.keyword).filter(
        ScrapeRun.keyword.isnot(None), ScrapeRun.keyword != ""
    ).all()]
    gnews_kws = [r[0] for r in db.query(GoogleNewsArticle.search_query).filter(
        GoogleNewsArticle.search_query.isnot(None), GoogleNewsArticle.search_query != ""
    ).all()]
    seen: dict = {}
    for kw in run_kws + gnews_kws:
        seen[kw.lower().strip()] = kw.lower().strip()
    all_kws = sorted(seen.values(), key=str.lower)
    return {"keywords": all_kws}


@router.get("/search")
def search(
    keyword:        str | None = Query(None),
    source:         str | None = Query(None),
    limit:          int        = Query(50, le=100),
    offset:         int        = Query(0),
    date_range:     str | None = Query(None),
    scrape_keyword: str | None = Query(None),
    group_url:      str | None = Query(None),
    db:             Session    = Depends(get_db),
):
    from services.search_service import SearchService, ALL_SOURCES
    if source and source not in ALL_SOURCES:
        raise HTTPException(400, f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
    sk = scrape_keyword.strip() if scrape_keyword and scrape_keyword.strip() else None
    gu = group_url.strip()      if group_url      and group_url.strip()      else None
    if keyword and len(keyword.strip()) >= 2:
        result = (
            SearchService.search_one(db, keyword, source, limit, offset, date_range=date_range, scrape_keyword=sk, group_url=gu)
            if source else
            SearchService.search_all(db, keyword, limit, offset, date_range=date_range, scrape_keyword=sk, group_url=gu)
        )
    else:
        result = (
            SearchService.recent_one(db, source, limit, offset, date_range=date_range, scrape_keyword=sk, group_url=gu)
            if source else
            SearchService.recent_all(db, limit, offset, date_range=date_range, scrape_keyword=sk, group_url=gu)
        )
    return {
        "status":  "success",
        "keyword": keyword or "",
        "source":  source or "all",
        "mode":    "search" if keyword else "recent",
        "limit":   limit,
        "offset":  offset,
        **result,
    }


@router.post("/export/selected")
async def export_selected(request: Request, db: Session = Depends(get_db)):
    from services.search_service import SearchService, ALL_SOURCES
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")
    selections = body.get("selections", {})
    if not selections:
        raise HTTPException(400, "Provide 'selections': { source: [id, ...] }")
    bad = [s for s in selections if s not in ALL_SOURCES]
    if bad:
        raise HTTPException(400, f"Unknown source(s): {bad}")
    result = SearchService.export_selected(db, selections)
    return {
        "status":        "success",
        "total":         result["total"],
        "source_totals": result["source_totals"],
        "by_source":     result["by_source"],
    }


@router.get("/api/record/{source}/{record_id:path}")
def get_record(
    source:    str = FPath(...),
    record_id: str = FPath(...),
    db:        Session = Depends(get_db),
):
    from services.search_service import _SELECTED_EXPORTERS, ALL_SOURCES
    if source not in ALL_SOURCES:
        raise HTTPException(400, f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
    fn = _SELECTED_EXPORTERS.get(source)
    if fn is None:
        raise HTTPException(400, f"No exporter for source '{source}'")
    try:
        rows = fn(db, [record_id])
    except Exception as exc:
        raise HTTPException(500, str(exc))
    if not rows:
        raise HTTPException(404, "Record not found")
    return {"status": "success", "source": source, "data": rows[0]}


@router.delete("/api/record/{source}/{record_id:path}")
def delete_record(
    source:    str = FPath(...),
    record_id: str = FPath(...),
    db:        Session = Depends(get_db),
):
    from services.search_service import ALL_SOURCES
    if source not in ALL_SOURCES:
        raise HTTPException(400, f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
    try:
        from services.search_service import _get_table_and_id_column
        from sqlalchemy import Integer as _SAInt
        table, id_col = _get_table_and_id_column(source)

        typed_id: object = record_id
        if isinstance(id_col.type, _SAInt):
            try:
                typed_id = int(record_id)
            except ValueError:
                raise HTTPException(400, f"record_id '{record_id}' must be an integer for source '{source}'")

        instance = db.query(table).filter(id_col == typed_id).first()
        if instance is None:
            raise HTTPException(404, "Record not found")
        db.delete(instance)
        db.commit()
        return {"status": "success", "message": "Deleted 1 record"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/export")
def export_data(
    keyword: str | None = Query(None),
    source:  str | None = Query(None),
    db:      Session    = Depends(get_db),
):
    from services.search_service import SearchService, ALL_SOURCES
    if source and source not in ALL_SOURCES:
        raise HTTPException(400, f"Unknown source '{source}'. Valid: {ALL_SOURCES}")
    kw = keyword.strip() if keyword and keyword.strip() else None
    if source:
        result = SearchService.export_one(db, source, keyword=kw, limit=100_000)
        return {
            "status": "success", "keyword": kw or "",
            "source": source, "total": result["total"], "results": result["results"],
        }
    result = SearchService.export_all(db, keyword=kw, limit=100_000)
    return {
        "status": "success", "keyword": kw or "", "source": "all",
        "total": result["total"], "source_totals": result["source_totals"],
        "by_source": result["by_source"],
    }

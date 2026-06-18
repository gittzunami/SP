"""
quora.py
========
Quora scraper — two-step approach:
  Step 1: Scrappa (Google site:quora.com search) → discover question URLs
  Step 2: Scrape.do (JS render + residential proxy) → fetch each page
  Step 3: JSON parser → extract from embedded script tags (NOT HTML elements)

Quora is a React SPA. All data lives in JSON blobs inside <script> tags.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

from models import QuoraConfig

logger = logging.getLogger("scraper.quora")

SCRAPPA_KEY    = os.environ.get("SCRAPPA_API_KEY", "")
SCRAPEDO_TOKEN = os.environ.get("SCRAPEDO_KEY", "")
SCRAPPA_BASE   = "https://scrappa.co/api/search"
SCRAPEDO_BASE  = "http://api.scrape.do"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _get_words(kw: str) -> List[str]:
    return re.findall(r"[a-zA-Z0-9']+", kw.lower())


def _text_matches(keyword: str, *texts: str) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    return fuzzy_match(keyword, *texts)


def _ts_to_date(ts_microseconds) -> str:
    if not ts_microseconds:
        return ""
    try:
        dt = datetime.fromtimestamp(int(ts_microseconds) / 1_000_000, tz=timezone.utc)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return ""


def _parse_qtext(qtext_str) -> str:
    """Parse Quora's QText JSON format into plain text."""
    if not qtext_str:
        return ""
    try:
        doc = json.loads(qtext_str)
        parts = []
        for section in doc.get("sections", []):
            for span in section.get("spans", []):
                t = span.get("text", "")
                if t:
                    parts.append(t)
        return _clean(" ".join(parts))
    except Exception:
        return _clean(str(qtext_str))


# ── Step 1: Fetch one Scrappa page of results ─────────────────────────────────

def _scrappa_page(keyword: str, page: int) -> List[dict]:
    """Return raw organic results from one Scrappa page, or [] on error."""
    try:
        resp = requests.get(
            SCRAPPA_BASE,
            params={"query": f"site:quora.com {keyword}", "page": page},
            headers={"X-API-KEY": SCRAPPA_KEY},
            timeout=30,
        )
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrappa unreachable: {exc}"
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrappa timed out: {exc}"
        ) from exc
    except Exception as exc:
        logger.error("Quora: Scrappa request failed (page %d) — %s", page, exc)
        return []
    if resp.status_code != 200:
        logger.warning("Quora: Scrappa HTTP %d on page %d", resp.status_code, page)
        return []
    try:
        data = resp.json()
    except Exception:
        return []
    return data.get("organic_results") or data.get("results") or data.get("organic") or []


# ── Step 2: Fetch via Scrape.do ───────────────────────────────────────────────

def _fetch_page(url: str) -> Optional[str]:
    """Fetch a Quora page via Scrape.do with JS rendering + residential proxy."""
    if not SCRAPEDO_TOKEN:
        logger.error("Quora: SCRAPEDO_KEY not configured")
        return None

    params = {
        "token":   SCRAPEDO_TOKEN,
        "url":     url,
        "render":  "true",
        "super":   "true",    # residential IPs — required for Quora
        "geoCode": "us",
        "waitFor": "5000",    # wait 5s for React to render
    }

    for attempt in range(1, 4):
        try:
            resp = requests.get(SCRAPEDO_BASE, params=params, timeout=60)
            if resp.status_code == 200:
                logger.info("Quora: fetched %d chars — %s", len(resp.text), url[:60])
                return resp.text
            if resp.status_code == 401:
                raise RuntimeError(
                    "Scrape.do: Invalid token or credits exhausted (401) — "
                    "check your SCRAPEDO_KEY and account balance at scrape.do/dashboard"
                )
            logger.warning("Quora: Scrape.do HTTP %d (attempt %d) — %s",
                           resp.status_code, attempt, url[:60])
        except RuntimeError:
            raise
        except requests.exceptions.ConnectionError as exc:
            raise RuntimeError(
                f"Server is on maintenance, Please try again later.|||Scrape.do unreachable: {exc}"
            ) from exc
        except requests.exceptions.Timeout as exc:
            raise RuntimeError(
                f"Server is on maintenance, Please try again later.|||Scrape.do timed out: {exc}"
            ) from exc
        except Exception as exc:
            logger.warning("Quora: fetch error (attempt %d) — %s", attempt, exc)

    return None


# ── Step 3: Parse JSON from embedded script tags ───────────────────────────────

def _extract_inline_json(html: str) -> List[dict]:
    objects = []
    pattern = re.compile(r'\.push\("((?:[^"\\]|\\.)*)"\)', re.DOTALL)

    for match in pattern.finditer(html):
        raw = match.group(1)
        try:
            unescaped = raw.encode("utf-8").decode("unicode_escape")
        except Exception:
            try:
                unescaped = (raw.replace('\\"', '"')
                               .replace("\\\\", "\\")
                               .replace("\\n", "\n")
                               .replace("\\t", "\t"))
            except Exception:
                continue
        try:
            obj = json.loads(unescaped)
            objects.append(obj)
        except Exception:
            pass

    logger.info("Quora: extracted %d inline JSON objects", len(objects))
    return objects


def _parse_question(html: str, url: str, fallback_title: str = "") -> dict:
    objects = _extract_inline_json(html)

    question_title = fallback_title
    topics:        List[str]  = []
    answers:       List[dict] = []
    seen_aids:     set        = set()

    for obj in objects:
        data = obj.get("data", {})

        # ── Question metadata ──────────────────────────────────────────────────
        q = data.get("question", {})
        if q:
            if not question_title or question_title == fallback_title:
                raw_title = q.get("title", "")
                if raw_title:
                    question_title = _parse_qtext(raw_title)
            if not topics:
                for t in q.get("topics", []) or q.get("navigationTopics", []):
                    name = t.get("name", "")
                    if name:
                        topics.append(name)

        # ── Answers from edges ─────────────────────────────────────────────────
        answers_data = None
        if "question" in data and isinstance(data["question"], dict):
            answers_data = data["question"].get("answers", {})

        if answers_data and "edges" in answers_data:
            for edge in answers_data["edges"]:
                node   = edge.get("node", {})
                answer = node.get("answer", {})
                if not answer:
                    continue
                aid = answer.get("aid")
                if not aid or aid in seen_aids:
                    continue
                seen_aids.add(aid)
                answers.append(_build_answer(answer))

        # ── Streaming answer items ─────────────────────────────────────────────
        node = data.get("node", {})
        if node and node.get("__typename") in (
            "QuestionAnswerItem2", "QuestionRelevantAnswerItem2"
        ):
            answer = node.get("answer", {})
            if answer:
                aid = answer.get("aid")
                if aid and aid not in seen_aids:
                    seen_aids.add(aid)
                    a = _build_answer(answer)
                    if a["content"]:
                        answers.append(a)

    # Fallback: parse title from <title> tag
    if not question_title or question_title == fallback_title:
        soup = BeautifulSoup(html, "html.parser")
        el = soup.find("title")
        if el:
            question_title = re.sub(
                r"\s*[-–|]\s*Quora\s*$", "", _clean(el.get_text())
            ).strip()

    answers.sort(key=lambda a: a["upvotes"], reverse=True)

    return {
        "url":            url,
        "question_title": question_title,
        "topics":         topics[:15],
        "answer_count":   len(answers),
        "answers":        answers,
    }


def _build_answer(answer: dict) -> dict:
    content   = _parse_qtext(answer.get("content", ""))
    author    = answer.get("author", {})
    names     = author.get("names", [])
    if names:
        n = names[0]
        author_name = _clean(
            f"{n.get('givenName', '')} {n.get('familyName', '')}".strip()
        )
    else:
        author_name = ""

    cred_obj   = answer.get("authorCredential") or {}
    credential = _clean(cred_obj.get("translatedString", ""))

    return {
        "author_name":       author_name,
        "author_credential": credential,
        "content":           content,
        "upvotes":           answer.get("numUpvotes", 0) or 0,
        "views":             answer.get("numViews",   0) or 0,
        "shares":            answer.get("numShares",  0) or 0,
        "comments_count":    answer.get("numDisplayComments", 0) or 0,
        "date":              _ts_to_date(answer.get("creationTime")),
        "is_ai_answer":      bool(answer.get("isMachineAnswer", False)),
    }


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: QuoraConfig) -> dict:
    scraped_at = datetime.now(tz=timezone.utc)
    questions: List[dict] = []

    if not SCRAPPA_KEY:
        logger.error("Quora: SCRAPPA_API_KEY not configured — aborting")
        return {"keyword": cfg.keyword, "scraped_at": scraped_at.isoformat(),
                "total_items": 0, "questions": []}

    if not SCRAPEDO_TOKEN:
        logger.error("Quora: SCRAPEDO_KEY not configured — aborting")
        return {"keyword": cfg.keyword, "scraped_at": scraped_at.isoformat(),
                "total_items": 0, "questions": []}

    logger.info("Quora: keyword=%r, max_results=%d", cfg.keyword, cfg.max_results)

    keyword  = cfg.keyword
    seen_urls: set = set()
    MAX_PAGES      = 10

    for page in range(1, MAX_PAGES + 1):
        if len(questions) >= cfg.max_results:
            break

        logger.info("Quora: Scrappa page %d — %r", page, cfg.keyword)
        raw = _scrappa_page(cfg.keyword, page)
        if not raw:
            logger.info("Quora: no results on page %d — stopping", page)
            break

        found_any = False
        for r in raw:
            if len(questions) >= cfg.max_results:
                break

            url     = r.get("url") or r.get("link") or ""
            title   = r.get("title") or r.get("name") or ""
            snippet = r.get("snippet") or r.get("description") or ""
            if not url or "quora.com" not in url:
                continue
            if url in seen_urls:
                continue
            if any(s in url for s in ["/profile/", "/topic/", "/search?", "/spaces/"]):
                continue
            if not _text_matches(keyword, title, snippet):
                continue

            seen_urls.add(url)
            found_any = True
            idx = len(questions) + 1
            logger.info("Quora: [%d/%d] fetching — %s", idx, cfg.max_results, title[:65])

            html = _fetch_page(url)
            if not html:
                logger.warning("Quora: [%d/%d] fetch failed, skipping", idx, cfg.max_results)
                continue

            parsed = _parse_question(html, url, title)
            parsed["scraped_at"] = scraped_at.isoformat()
            questions.append(parsed)
            logger.info("Quora: [%d/%d] saved — %d answers, topics: %s",
                        idx, cfg.max_results, parsed["answer_count"],
                        ", ".join(parsed["topics"][:3]) or "none")

        if not found_any:
            logger.info("Quora: no matching URLs on page %d — stopping", page)
            break

    logger.info("Quora: done — %d questions for %r", len(questions), cfg.keyword)
    return {
        "keyword":     cfg.keyword,
        "scraped_at":  scraped_at.isoformat(),
        "total_items": len(questions),
        "questions":   questions,
    }

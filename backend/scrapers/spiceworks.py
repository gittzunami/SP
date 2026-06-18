"""
spiceworks.py
=============
Spiceworks scraper — uses Scrape.do API (HTTP, no browser needed).

Flow:
  1. Build paginated search URLs directly (&paged=N) — no Next-link parsing needed
  2. Fetch each search page with render=True (JS SPA requires it)
  3. Visit only title-matched pages with render=False (static HTML, cheap credits)
"""

from __future__ import annotations

import logging
import os
import re
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

from models import SpiceworksConfig

logger   = logging.getLogger("scraper.spiceworks")
BASE_URL = "https://www.spiceworks.com/search/"

SCRAPEDO_TOKEN = os.environ.get("SCRAPEDO_KEY", "")
SCRAPEDO_API   = "http://api.scrape.do/"

_SKIP_PATHS = {
    "/search", "/login", "/signup", "/register", "/about",
    "/contact", "/privacy", "/terms", "/sitemap", "/tag", "/author",
    "/newsletter", "/advertise",
}
_SKIP_TEXTS = {
    "read more", "learn more", "click here", "see more", "view all",
    "sign up", "log in", "subscribe", "newsletter", "back to top",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _fetch(url: str, render: bool = False) -> Optional[BeautifulSoup]:
    """Fetch a URL via Scrape.do and return a BeautifulSoup, or None on failure."""
    if not SCRAPEDO_TOKEN:
        logger.error("Spiceworks: SCRAPEDO_TOKEN not set in environment")
        return None
    params = {
        "token":  SCRAPEDO_TOKEN,
        "url":    url,
        "render": "true" if render else "false",
    }
    try:
        resp = requests.get(SCRAPEDO_API, params=params, timeout=60)
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrape.do unreachable: {exc}"
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrape.do timed out: {exc}"
        ) from exc
    except Exception as exc:
        logger.warning("Spiceworks: _fetch failed for %s — %s", url, exc)
        return None
    if resp.status_code == 401:
        raise RuntimeError(
            "Scrape.do: Invalid token or credits exhausted (401) — "
            "check your SCRAPEDO_KEY and account balance at scrape.do/dashboard"
        )
    if resp.status_code >= 500:
        raise RuntimeError(
            f"Server is on maintenance, Please try again later.|||Scrape.do server error {resp.status_code}"
        )
    if resp.status_code != 200:
        logger.warning("Spiceworks: Scrape.do returned %d for %s", resp.status_code, url)
        return None
    return BeautifulSoup(resp.text, "html.parser")


def _is_content_url(url: str) -> bool:
    if "spiceworks.com" not in url:
        return False
    path = url.split("spiceworks.com", 1)[-1]
    if any(path.startswith(s) for s in _SKIP_PATHS):
        return False
    if path.count("/") < 2:
        return False
    return True


def _title_matches(keyword: str, title: str) -> bool:
    from scrapers.keyword_utils import fuzzy_match
    return fuzzy_match(keyword, title)


def _extract_author(soup: BeautifulSoup) -> Optional[str]:
    el = soup.select_one("[class*='author'], [rel='author']")
    if el:
        return el.get_text(strip=True)
    text  = soup.get_text(" ", strip=True)
    match = re.search(r"\bby\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)", text)
    return match.group(1) if match else None


def _extract_date(soup: BeautifulSoup) -> Optional[str]:
    t = soup.find("time")
    if t:
        return t.get("datetime") or t.get_text(strip=True)
    meta = soup.find("meta", {"property": "article:published_time"})
    if meta and meta.get("content"):
        return meta["content"]
    text = soup.get_text(" ", strip=True)
    for pat in [
        r"\b\d{4}-\d{2}-\d{2}\b",
        r"\b\d{1,2}\s[A-Z][a-z]+\s\d{4}\b",
        r"\b[A-Z][a-z]+\s\d{1,2},\s\d{4}\b",
    ]:
        m = re.search(pat, text)
        if m:
            return m.group(0)
    return None


def _extract_category(url: str) -> Optional[str]:
    """Extract category from URL path, e.g. /tech/security/... → 'security'."""
    parts = [p for p in url.split("spiceworks.com", 1)[-1].split("/") if p]
    return parts[1] if len(parts) >= 2 else (parts[0] if parts else None)


def _extract_tags(soup: BeautifulSoup) -> List[str]:
    tags = []
    for el in soup.select("a[href*='/tag/'], a[class*='tag'], [class*='tag-list'] a"):
        t = el.get_text(strip=True)
        if t and len(t) < 50:
            tags.append(t)
    return list(dict.fromkeys(tags))[:10]   # deduplicate, cap at 10


def _extract_thumbnail(soup: BeautifulSoup) -> Optional[str]:
    og = soup.find("meta", {"property": "og:image"})
    if og and og.get("content"):
        return og["content"]
    img = soup.find("img", {"class": re.compile(r"thumbnail|featured|hero", re.I)})
    if img and img.get("src"):
        return img["src"]
    return None


# ── Public entry point ────────────────────────────────────────────────────────

def run(cfg: SpiceworksConfig) -> dict:
    scraped_at = datetime.now(tz=timezone.utc)
    posts: List[dict] = []

    if not SCRAPEDO_TOKEN:
        logger.error("Spiceworks: SCRAPEDO_TOKEN not configured — aborting")
        return {"keyword": cfg.keyword, "scraped_at": scraped_at.isoformat(),
                "total_items": 0, "posts": []}

    logger.info("Spiceworks: keyword='%s', max_results=%d", cfg.keyword, cfg.max_results)

    search_url = BASE_URL + "?query=" + urllib.parse.quote(cfg.keyword)
    logger.info("Spiceworks: loading search page — %s", search_url)

    # ── Single pass: find a match → scrape it immediately → repeat ────────
    # Spiceworks uses ?paged=N — construct URLs directly, no Next-link parsing.
    # render=True for search pages (JS SPA), render=False for article pages (static HTML).
    seen_urls:     set = set()
    consecutive_empty  = 0

    for page_num in range(1, 51):   # 50-page safety cap
        page_url = search_url if page_num == 1 else (search_url + f"&paged={page_num}")
        logger.info("Spiceworks: fetching search page %d — %s", page_num, page_url)

        try:
            search_soup = _fetch(page_url, render=True)
        except RuntimeError as exc:
            # Timeout or server error on search page — return what we have so far
            logger.warning("Spiceworks: search page %d failed (%s) — returning %d partial results",
                           page_num, str(exc).split("|||")[0], len(posts))
            break
        if search_soup is None:
            logger.warning("Spiceworks: failed to load page %d, stopping", page_num)
            break

        scraped_this_page = 0

        for a in search_soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith("#") or href.startswith("mailto:"):
                continue
            abs_url = href if href.startswith("http") else "https://www.spiceworks.com" + href
            if not _is_content_url(abs_url) or abs_url in seen_urls:
                continue
            seen_urls.add(abs_url)

            link_title = _clean(a.get_text())
            if len(link_title) < 15 or link_title.lower() in _SKIP_TEXTS:
                continue

            if not _title_matches(cfg.keyword, link_title):
                continue

            # Title matches — scrape the article immediately
            logger.info("Spiceworks: [%d/%d] match found, scraping — %s",
                        len(posts) + 1, cfg.max_results, link_title[:70])

            try:
                article_soup = _fetch(abs_url, render=False)
            except RuntimeError:
                logger.warning("Spiceworks: article fetch failed for %s, skipping", abs_url)
                continue
            if article_soup is None:
                logger.warning("Spiceworks: retry for %s", abs_url)
                try:
                    article_soup = _fetch(abs_url, render=False)
                except RuntimeError:
                    logger.warning("Spiceworks: article retry failed for %s, skipping", abs_url)
                    continue
            if article_soup is None:
                continue   # skip this match, try the next one on the page

            for tag in article_soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()

            h1    = article_soup.find("h1")
            title = h1.get_text(strip=True) if h1 else link_title
            body  = _clean(" ".join(
                t.get_text(" ", strip=True)
                for t in article_soup.find_all(["p", "li"])
                if len(t.get_text(strip=True)) > 30
            ))

            posts.append({
                "url":       abs_url,
                "title":     title,
                "author":    _extract_author(article_soup),
                "date":      _extract_date(article_soup),
                "source":    "Article",
                "body":      body[:4_000],
                "category":  _extract_category(abs_url),
                "tags":      _extract_tags(article_soup),
                "thumbnail": _extract_thumbnail(article_soup),
            })
            scraped_this_page += 1
            logger.info("Spiceworks: [%d/%d] saved — %s", len(posts), cfg.max_results, title[:70])

            if len(posts) >= cfg.max_results:
                break   # done — stop scanning this search page

        if len(posts) >= cfg.max_results:
            break

        if scraped_this_page == 0:
            consecutive_empty += 1
            logger.info("Spiceworks: page %d — 0 scraped (%d consecutive empty)",
                        page_num, consecutive_empty)
            if consecutive_empty >= 2:
                logger.info("Spiceworks: 2 consecutive empty pages, stopping")
                break
        else:
            consecutive_empty = 0

    logger.info("Spiceworks: done — %d articles saved for '%s'", len(posts), cfg.keyword)
    return {
        "keyword":     cfg.keyword,
        "scraped_at":  scraped_at.isoformat(),
        "total_items": len(posts),
        "posts":       posts,
    }

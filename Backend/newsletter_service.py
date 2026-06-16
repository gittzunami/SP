"""
newsletter_service.py
=====================
Handles the full Google News → Webhook → Approval → LLM → Newsletter pipeline.

Flow:
  1. Google News scraper finishes → call send_to_webhook()
  2. Power Automate displays Adaptive Card with article checkboxes in Teams
  3. User selects articles and submits → Power Automate POSTs selected IDs to backend
  4. process_webhook_response() → saves ONLY selected articles to DB → generates newsletters
  5. Newsletters stored in generated_newsletters table, one per article date
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import requests
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.poolmanager import PoolManager

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger("newsletter_service")

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "").rstrip("/")

# Values treated as "no data" — fields with these values are dropped
_NULL_VALUES = {"", "n/a", "null", "none", "undefined", "unknown", "na", "not available"}


def _clean_article(article: dict) -> dict:
    """Strip null/N/A fields from a raw Apify article dict."""
    cleaned = {}
    for key, val in article.items():
        if val is None:
            continue
        if isinstance(val, str):
            stripped = val.strip()
            if stripped.lower() in _NULL_VALUES:
                continue
            cleaned[key] = stripped
        else:
            cleaned[key] = val
    return cleaned


def _clean_articles(articles: list[dict]) -> list[dict]:
    return [_clean_article(a) for a in articles]


def build_adaptive_card(job_id: str, keyword: str, article_count: int, articles: list[dict]) -> dict:
    """
    Build an Adaptive Card for Microsoft Teams via Power Automate.

    Each article is rendered as a labelled ToggleInput (checkbox).
    The user selects which articles to keep, then clicks Submit.

    The card's submit action sends back:
        {
          "action":      "approve" | "reject",
          "job_id":      "<job_id>",
          "selected_<i>": "true" | "false"   (one per article)
        }

    Power Automate reads those fields and POSTs to /webhook/google-news/response.
    """

    body: list[dict] = [
        # ── Header ────────────────────────────────────────────────────────────
        {
            "type": "Container",
            "items": [
                {
                    "type": "TextBlock",
                    "text": f"📰 Google News Alert: {keyword.title()}",
                    "weight": "Bolder",
                    "size": "Large",
                    "wrap": True,
                },
                {
                    "type": "TextBlock",
                    "text": (
                        f"**{article_count} articles found** — "
                        f"tick the ones you want saved, then click **Save Selected**.\n\n"
                        f"Job ID: `{job_id[:8]}…`"
                    ),
                    "wrap": True,
                    "isSubtle": True,
                },
            ],
        },
        # ── Separator ─────────────────────────────────────────────────────────
        {"type": "TextBlock", "text": "---", "separator": True},
        # ── Instructions ──────────────────────────────────────────────────────
        {
            "type": "TextBlock",
            "text": "✅ Check each article you want to store in the database:",
            "weight": "Bolder",
            "wrap": True,
        },
    ]

    # ── One ToggleInput per article (checkbox) ────────────────────────────────
    # We index from 0 to match the original articles list order.
    # The toggle id is  selected_<index>  and value when checked is "true".
    display_articles = articles[:25]  # Teams card size limit — adjust as needed

    for i, article in enumerate(display_articles):
        title = (article.get("title") or "").strip() or f"Article {i + 1}"
        source = (article.get("source_name") or article.get("source") or "").strip()
        url = (article.get("google_news_url") or article.get("url") or article.get("link") or "").strip()
        published = (article.get("published_at") or article.get("publishedAt") or "").strip()

        # Build the label shown next to the checkbox
        meta_parts: list[str] = []
        if source and source.lower() not in _NULL_VALUES:
            meta_parts.append(source)
        if published:
            try:
                dt = datetime.fromisoformat(published.replace("Z", "+00:00"))
                meta_parts.append(dt.strftime("%d %b %Y"))
            except Exception:
                meta_parts.append(published[:10])

        meta_line = " · ".join(meta_parts)

        # Container for one article row
        article_body: list[dict] = [
            {
                "type": "Input.Toggle",
                "id": f"selected_{i}",           # <<< Power Automate reads this key
                "title": f"**{i + 1}. {title}**",
                "value": "false",                 # unchecked by default
                "valueOn": "true",
                "valueOff": "false",
                "wrap": True,
            },
        ]

        if meta_line:
            article_body.append({
                "type": "TextBlock",
                "text": meta_line,
                "isSubtle": True,
                "size": "Small",
                "spacing": "None",
                "wrap": True,
            })

        if url:
            article_body.append({
                "type": "TextBlock",
                "text": f"[Read more]({url})",
                "isSubtle": True,
                "size": "Small",
                "spacing": "None",
                "wrap": True,
            })

        body.append({
            "type": "Container",
            "spacing": "Medium",
            "separator": i == 0,   # separator before first article only
            "items": article_body,
        })

    if len(articles) > 25:
        body.append({
            "type": "TextBlock",
            "text": f"⚠️ Only the first 25 articles are shown due to card size limits.",
            "isSubtle": True,
            "wrap": True,
            "color": "Warning",
        })

    # ── Hidden field carrying job_id so Power Automate can route the response ─
    # We embed it as a hidden Input.Text (Teams ignores it visually but submits it).
    body.append({
        "type": "Input.Text",
        "id": "job_id",
        "value": job_id,
        "isVisible": False,         # hidden from user
        "label": "job_id",
    })

    # ── Actions ───────────────────────────────────────────────────────────────
    actions = [
        {
            "type": "Action.Submit",
            "title": "💾 Save Selected Articles",
            "style": "positive",
            "data": {
                "action": "approve",
                "job_id": job_id,   # also in data so it survives even if Input is stripped
            },
        },
        {
            "type": "Action.Submit",
            "title": "❌ Reject All",
            "style": "destructive",
            "data": {
                "action": "reject",
                "job_id": job_id,
            },
        },
    ]

    return {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": body,
        "actions": actions,
    }


class _SSLAdapter(HTTPAdapter):
    """Adapter that ignores unexpected EOF during TLS handshake."""

    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        try:
            ctx.options |= ssl.OP_IGNORE_UNEXPECTED_EOF
        except AttributeError:
            pass
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)


def _make_webhook_session() -> requests.Session:
    """Create a session with retry logic and headers for Power Automate."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    session.mount("https://", _SSLAdapter())
    return session


def _webhook_via_powershell(payload: dict) -> bool:
    """Send webhook payload via PowerShell Invoke-RestMethod (uses Windows SChannel)."""
    script = f'''
$body = $input | ConvertFrom-Json
try {{
    $resp = Invoke-RestMethod -Uri "{WEBHOOK_URL}" -Method Post -Body ($body | ConvertTo-Json -Compress) -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
    Write-Output "OK"
}} catch {{
    Write-Output "FAIL: $($_.Exception.Message)"
}}
'''
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", script],
            input=json.dumps(payload),
            capture_output=True, text=True, timeout=60,
        )
        output = result.stdout.strip()
        if output == "OK":
            return True
        logger.error("PowerShell webhook failed: %s", output or result.stderr.strip())
        return False
    except subprocess.TimeoutExpired:
        logger.error("PowerShell webhook timed out")
        return False
    except Exception as exc:
        logger.error("PowerShell invocation error: %s", exc)
        return False


def send_to_teams_webhook(job_id: str, keyword: str, article_count: int, articles: list[dict]) -> bool:
    """Send Adaptive Card directly to Power Automate webhook."""
    if not WEBHOOK_URL:
        logger.warning("WEBHOOK_URL not set")
        return False

    adaptive_card = build_adaptive_card(job_id, keyword, article_count, articles)

    # Power Automate "Post Adaptive Card and wait for response" trigger
    # expects the card wrapped under the key "adaptiveCard"
    payload = {"adaptiveCard": adaptive_card}

    # Attempt 1: Python requests with custom SSL adapter
    session = _make_webhook_session()
    try:
        logger.info("Sending Adaptive Card to Power Automate — job %s", job_id)
        resp = session.post(WEBHOOK_URL, json=payload, timeout=30)
        logger.info("Power Automate webhook status: %d — %s",
                    resp.status_code, resp.text[:300] if resp.text else "empty")

        if resp.status_code in (200, 201, 202):
            logger.info("Adaptive Card sent successfully")
            return True
        else:
            logger.warning("Unexpected status from Power Automate: %d", resp.status_code)
            return False
    except Exception as exc:
        logger.error("Python requests failed: %s — falling back to PowerShell", exc)
    finally:
        session.close()

    # Attempt 2: PowerShell Invoke-RestMethod (uses Windows SChannel, avoids OpenSSL)
    logger.info("Falling back to PowerShell for webhook — job %s", job_id)
    return _webhook_via_powershell(payload)


# ── Article content fetcher ───────────────────────────────────────────────────

_FETCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
_FETCH_TIMEOUT   = 12          # seconds
_CONTENT_MAX_CHR = 3_000       # chars sent to LLM


def _fetch_article_content(url: str) -> str:
    """
    Fetch the article at *url* and return cleaned body text (up to _CONTENT_MAX_CHR chars).
    Returns an empty string on any failure (timeout, paywall, 4xx/5xx …).
    """
    if not url:
        return ""
    try:
        from bs4 import BeautifulSoup
        resp = requests.get(url, headers=_FETCH_HEADERS, timeout=_FETCH_TIMEOUT,
                            allow_redirects=True)
        if resp.status_code != 200:
            logger.warning("_fetch_article_content: HTTP %d for %s", resp.status_code, url[:80])
            return ""

        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove boilerplate tags
        for tag in soup(["script", "style", "nav", "header", "footer",
                          "aside", "form", "noscript", "iframe"]):
            tag.decompose()

        # Prefer <article> or <main>; fall back to <body>
        container = (soup.find("article")
                     or soup.find("main")
                     or soup.find("body")
                     or soup)

        text = container.get_text(separator="\n", strip=True)

        # Collapse blank lines and normalise whitespace
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        cleaned = "\n".join(lines)

        if len(cleaned) > _CONTENT_MAX_CHR:
            cleaned = cleaned[:_CONTENT_MAX_CHR] + "…"

        logger.info("_fetch_article_content: fetched %d chars from %s", len(cleaned), url[:80])
        return cleaned

    except Exception as exc:
        logger.warning("_fetch_article_content failed for %s: %s", url[:80], exc)
        return ""


# ── Newsletter generation prompt ──────────────────────────────────────────────
NEWSLETTER_SYSTEM = """You are a marketing newsletter writer for Cloudsfer, a cloud migration platform.
You will receive ONE Google News article — its title, description, source, and (when available) the full article body text.

Your job:
1. Read the full article content carefully to understand the specific topic, concern, or finding it reports.
2. Write a skeptical question a reader might ask after reading this article — it must sound like a genuine concern or doubt triggered by the article's content, NOT a generic summary or restatement of it.
3. Write a confident, concise answer from Cloudsfer's perspective that directly addresses that concern.
4. Extract a short, specific 2-5 word term from the question that captures the core topic (e.g. "cloud data migration", "photo transfer", "storage costs"). This will be used in a CTA button: "Get Reliable <term> Support with Cloudsfer".

Return ONLY valid JSON — no markdown, no code fences, nothing outside the JSON:
{
  "question": "A specific skeptical question a reader would ask after reading this article (1-2 sentences, genuine concern, not a summary)",
  "answer": "Cloudsfer's confident answer (2-3 sentences, authoritative and reassuring)",
  "cta_term": "2-5 word specific term from the question for the CTA button"
}"""


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


# ══════════════════════════════════════════════════════════════════════════════
#  Helpers — parse selected article indices from Power Automate payload
# ══════════════════════════════════════════════════════════════════════════════

def parse_selected_indices(response_data: dict) -> list[int] | None:
    """
    Power Automate POSTs back the card's submitted form values.

    Expected shape:
        {
          "action":       "approve",
          "job_id":       "<job_id>",
          "selected_0":   "true",
          "selected_1":   "false",
          "selected_2":   "true",
          ...
        }

    Returns a sorted list of integer indices where value == "true",
    or None if the action is "reject".
    """
    action = response_data.get("action", "approve")
    if action == "reject":
        return None

    selected: list[int] = []
    for key, val in response_data.items():
        if key.startswith("selected_"):
            try:
                idx = int(key.split("_", 1)[1])
            except (ValueError, IndexError):
                continue
            if str(val).lower() == "true":
                selected.append(idx)

    return sorted(selected)


def filter_articles_by_selection(articles: list[dict], selected_indices: list[int]) -> list[dict]:
    """Return only the articles whose position is in selected_indices."""
    return [articles[i] for i in selected_indices if i < len(articles)]


# ══════════════════════════════════════════════════════════════════════════════
#  Step 1: Send scraped articles to webhook
# ══════════════════════════════════════════════════════════════════════════════

def send_to_webhook(db, task_id: str, keyword: str, articles: list[dict]) -> dict:
    """
    Called immediately after Google News scraper finishes.
    Creates a NewsletterJob record, POSTs Adaptive Card to Power Automate,
    then waits indefinitely for approval before returning.
    """
    from db_models import NewsletterJob

    # Clean null/N/A values before anything touches the data
    articles = _clean_articles(articles)
    logger.info("send_to_webhook: %d articles after cleaning", len(articles))

    job_id = uuid.uuid4().hex

    job = NewsletterJob(
        job_id=job_id,
        task_id=task_id,
        status="pending_approval",
        keyword=keyword,
        article_count=len(articles),
        webhook_sent_at=_now(),
        raw_articles_json=json.dumps(articles, ensure_ascii=False),
        created_at=_now(),
    )
    db.add(job)
    db.commit()

    # Save ALL scraped articles to DB immediately (before user selection)
    try:
        _save_articles_to_db(db, articles, task_id, keyword)
        logger.info("NewsletterJob %s: %d articles saved to DB", job_id, len(articles))
    except Exception as exc:
        logger.error("NewsletterJob %s: failed to save articles to DB: %s", job_id, exc)

    sorted_articles = sorted(articles, key=lambda a: a.get("publishedAt") or a.get("published_at") or "", reverse=True)
    webhook_articles = sorted_articles[:25]
    logger.info("NewsletterJob %s created — %d articles, sending Adaptive Card with %d newest", job_id, len(articles), len(webhook_articles))

    send_to_teams_webhook(job_id, keyword, len(articles), webhook_articles)

    if not WEBHOOK_URL:
        logger.warning("WEBHOOK_URL not set — job %s created but not sent", job_id)
        job.status = "pending_approval"
        job.error = "WEBHOOK_URL not configured in .env"
        db.commit()
        return _job_dict(job)

    logger.info("Waiting for approval on job %s...", job_id)

    try:
        while True:
            time.sleep(10)
            db.expire_all()
            db.commit()
            job = db.query(NewsletterJob).filter_by(job_id=job_id).first()
            if not job:
                logger.error("Job %s not found in DB", job_id)
                return {"job_id": job_id, "status": "error", "error": "Job not found"}
            logger.info("Job %s status: %s", job_id, job.status)

            if job.status in ("pending_approval", "approved", "generating"):
                # process_webhook_response is handling the approval — just wait
                continue

            elif job.status == "completed":
                from db_models import GeneratedNewsletter
                nl_count = db.query(GeneratedNewsletter).filter_by(job_id=job_id).count()
                logger.info("Job %s completed — %d newsletters in DB", job_id, nl_count)
                return {**_job_dict(job), "newsletters_created": nl_count}

            elif job.status in ("rejected", "failed"):
                logger.info("Job %s %s: %s", job_id, job.status, job.error)
                return _job_dict(job)

            else:
                logger.info("Job %s unexpected status: %s", job_id, job.status)
                return _job_dict(job)
    except (KeyboardInterrupt, SystemExit):
        logger.warning("Job %s: interrupted — keeping job in pending_approval", job_id)
        return _job_dict(job)


# ══════════════════════════════════════════════════════════════════════════════
#  Step 2: Process webhook response (selection submitted from Teams)
# ══════════════════════════════════════════════════════════════════════════════

def process_webhook_response(db, job_id: str, approved: bool,
                              reason: str = "",
                              response_data: dict | None = None) -> dict:
    """
    Called when Power Automate POSTs the card submission back to the backend.

    response_data is the full body from Power Automate, e.g.:
        {
          "action":     "approve",
          "job_id":     "abc123",
          "selected_0": "true",
          "selected_1": "false",
          ...
        }

    Only the articles whose checkbox was ticked are saved to DB.
    """
    from db_models import NewsletterJob

    job = db.query(NewsletterJob).filter_by(job_id=job_id).first()
    if not job:
        raise ValueError(f"Job {job_id} not found")

    if job.status not in ("pending_approval",):
        raise ValueError(f"Job {job_id} already processed (status: {job.status})")

    job.responded_at = _now()

    # ── Rejected ──────────────────────────────────────────────────────────────
    if not approved:
        job.status = "rejected"
        job.error = reason or "Rejected by reviewer"
        db.commit()
        logger.info("Job %s rejected: %s", job_id, reason)
        return _job_dict(job)

    # ── Approved: filter to selected articles ─────────────────────────────────
    job.status = "generating"
    db.commit()

    try:
        all_articles: list[dict] = json.loads(job.raw_articles_json or "[]")
        if not all_articles:
            raise ValueError("No articles found in job")

        # Determine which articles the user selected
        selected_articles: list[dict]
        if response_data:
            selected_indices = parse_selected_indices(response_data)
            if selected_indices is None:
                # parse_selected_indices returns None only for "reject" — shouldn't
                # reach here, but guard anyway
                job.status = "rejected"
                job.error = "Rejected via response_data"
                db.commit()
                return _job_dict(job)

            if selected_indices:
                selected_articles = filter_articles_by_selection(all_articles, selected_indices)
                logger.info(
                    "Job %s: user selected %d/%d articles (indices: %s)",
                    job_id, len(selected_articles), len(all_articles), selected_indices
                )
            else:
                # No checkboxes ticked — treat as reject
                logger.warning("Job %s: no articles selected — rejecting", job_id)
                job.status = "rejected"
                job.error = "No articles selected by reviewer"
                db.commit()
                return _job_dict(job)
        else:
            # Backwards-compatible: no checkbox data → use all articles
            logger.warning("Job %s: no response_data — saving all articles", job_id)
            selected_articles = all_articles

        # Persist the filtered list so the polling loop in send_to_webhook can use it
        job.selected_articles_json = json.dumps(selected_articles, ensure_ascii=False)
        job.status = "approved"
        db.commit()

        # Generate newsletters for selected articles only
        newsletters = _generate_newsletters(db, job_id, selected_articles, job.keyword or "")
        logger.info("Job %s: %d newsletters generated", job_id, len(newsletters))

        job.status = "completed"
        job.completed_at = _now()
        db.commit()

        return {
            **_job_dict(job),
            "selected_count": len(selected_articles),
            "newsletters_created": len(newsletters),
        }

    except Exception as exc:
        logger.error("Job %s processing failed: %s", job_id, exc)
        job.status = "failed"
        job.error = str(exc)
        db.commit()
        raise


# ══════════════════════════════════════════════════════════════════════════════
#  Step 2b: Webhook endpoint helper — parse raw HTTP body from Power Automate
# ══════════════════════════════════════════════════════════════════════════════

def handle_teams_submission(db, raw_body: dict) -> dict:
    """
    Convenience wrapper called directly by the FastAPI /webhook/google-news/response
    endpoint when Power Automate POSTs the Teams card submission.

    raw_body example:
        {
          "action":     "approve",
          "job_id":     "a1b2c3d4...",
          "selected_0": "true",
          "selected_1": "false",
          "selected_2": "true"
        }
    """
    action = raw_body.get("action", "approve")
    job_id = raw_body.get("job_id", "")

    if not job_id:
        raise ValueError("job_id missing from Power Automate payload")

    approved = action == "approve"
    reason = "" if approved else raw_body.get("reason", "Rejected via Teams")

    return process_webhook_response(
        db,
        job_id=job_id,
        approved=approved,
        reason=reason,
        response_data=raw_body,
    )


# ══════════════════════════════════════════════════════════════════════════════
#  Save articles to google_news_articles table
# ══════════════════════════════════════════════════════════════════════════════

def _save_articles_to_db(db, articles: list[dict],
                          task_id: str, keyword: str) -> None:
    """Reuse existing db_writer logic for Google News."""
    try:
        from services.db_writer import save_google_news
        enriched_articles = []
        for a in articles:
            a = dict(a)
            search_q = a.get("search_query") or a.get("query") or keyword
            if search_q:
                a["search_query"] = search_q
            enriched_articles.append(a)
        if enriched_articles:
            sample = enriched_articles[0]
            sample_url = sample.get("google_news_url") or sample.get("url") or sample.get("link") or "NONE"
            logger.info("_save_articles_to_db: saving %d articles, first URL: %s", len(enriched_articles), sample_url[:80])
        payload = {
            "keywords": [keyword],
            "scraped_at": _now().isoformat(),
            "total_articles": len(enriched_articles),
            "articles": enriched_articles,
        }
        save_google_news(db, payload, task_id)
    except Exception as exc:
        logger.error("Failed to save articles to DB: %s", exc)
        raise


# ══════════════════════════════════════════════════════════════════════════════
#  Generate newsletters grouped by article date
# ══════════════════════════════════════════════════════════════════════════════

def _generate_newsletters(db, job_id: str, articles: list[dict],
                           keyword: str) -> list[dict]:
    """Generates ONE newsletter per article."""
    from llm_service import get_active_config

    config = get_active_config(db)
    if not config:
        raise RuntimeError(
            "No active LLM provider configured. "
            "Please configure one in LLM Configuration."
        )

    newsletters = []
    for article in articles:
        try:
            nl = _generate_one_newsletter(db, job_id, article, keyword, config)
            newsletters.append(nl)
            logger.info("Newsletter generated for article '%s'", article.get("title", "")[:60])
        except Exception as exc:
            logger.error("Failed to generate newsletter for article '%s': %s",
                         article.get("title", "")[:60], exc)

    logger.info("%d newsletters generated for job %s", len(newsletters), job_id)
    return newsletters


def _generate_one_newsletter(db, job_id: str, article: dict,
                              keyword: str, config: dict) -> dict:
    """Calls LLM to generate one newsletter for a single article."""
    from db_models import GeneratedNewsletter

    provider = config["provider"]
    model    = config["model"]
    api_key  = config["api_key"]

    # Try to fetch the full article body so the LLM has richer context
    article_url = (article.get("google_news_url")
                   or article.get("url")
                   or article.get("link")
                   or "")
    full_text = _fetch_article_content(article_url)

    user_msg = (
        f"Topic: {keyword}\n"
        f"Article title: {article.get('title', '')}\n"
        f"Article description: {article.get('description', '')}\n"
        f"Source: {article.get('source_name', '')}\n"
    )
    if full_text:
        user_msg += f"\nFull article content:\n{full_text}"
    else:
        logger.info("_generate_one_newsletter: no full text fetched, using metadata only")

    content, p_tok, c_tok = _call_llm_for_newsletter(provider, model, api_key, user_msg)

    try:
        content_parsed = json.loads(content)
    except json.JSONDecodeError:
        content_parsed = {
            "question": f"What's really happening with {keyword}?",
            "answer": content[:500] if content else "",
        }

    content_parsed["keyword"] = keyword

    try:
        from llm_service import _record_llm_spend
        _record_llm_spend(db, provider, model, "newsletter_generation", p_tok, c_tok, keyword)
    except Exception:
        pass

    today = _now().strftime("%Y-%m-%d")
    raw_title = article.get("title") or keyword or "Google News"
    title = f"{raw_title[:60]} — {today}"

    newsletter = GeneratedNewsletter(
        job_id=job_id,
        title=title,
        article_date=today,
        provider=provider,
        model=model,
        content_json=json.dumps(content_parsed, ensure_ascii=False),
        content_raw=content,
        article_count=1,
        created_at=_now(),
    )
    db.add(newsletter)
    db.commit()

    return {
        "id": newsletter.id,
        "title": newsletter.title,
        "article_date": newsletter.article_date,
        "article_count": newsletter.article_count,
    }


def _call_llm_for_newsletter(provider: str, model: str, api_key: str,
                              user_msg: str) -> tuple[str, int, int]:
    """Returns (content, prompt_tokens, completion_tokens)."""
    if provider == "openai":
        import openai
        client = openai.OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model,
            temperature=0,
            messages=[
                {"role": "system", "content": NEWSLETTER_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
        )
        return (
            resp.choices[0].message.content,
            resp.usage.prompt_tokens,
            resp.usage.completion_tokens,
        )

    elif provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=model,
            max_tokens=4096,
            system=NEWSLETTER_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )
        return (
            resp.content[0].text,
            resp.usage.input_tokens,
            resp.usage.output_tokens,
        )

    elif provider == "gemini":
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        MODEL_MAP = {
            "gemini-nano": "gemini-nano",
            "gemini-pro": "gemini-1.0-pro",
            "gemini-ultra": "gemini-ultra",
            "gemini-1.5-flash": "gemini-1.5-flash",
            "gemini-1.5-pro": "gemini-1.5-pro",
            "gemini-2.0": "gemini-2.0-flash-exp",
        }
        gmodel = genai.GenerativeModel(
            model_name=MODEL_MAP.get(model, model),
            system_instruction=NEWSLETTER_SYSTEM,
        )
        resp = gmodel.generate_content(
            user_msg,
            generation_config=genai.GenerationConfig(temperature=0),
        )
        p_tok = getattr(resp.usage_metadata, "prompt_token_count", 0) or 0
        c_tok = getattr(resp.usage_metadata, "candidates_token_count", 0) or 0
        return resp.text, p_tok, c_tok

    else:
        raise RuntimeError(f"Unknown provider: {provider}")


# ══════════════════════════════════════════════════════════════════════════════
#  Query helpers for API endpoints
# ══════════════════════════════════════════════════════════════════════════════

def get_all_newsletters(db) -> list[dict]:
    """Returns all generated newsletters ordered by date desc."""
    from db_models import GeneratedNewsletter
    rows = (
        db.query(GeneratedNewsletter)
          .order_by(GeneratedNewsletter.article_date.desc(),
                    GeneratedNewsletter.created_at.desc())
          .all()
    )
    return [_newsletter_dict(r) for r in rows]


def get_newsletter_by_id(db, newsletter_id: int) -> dict | None:
    from db_models import GeneratedNewsletter
    row = db.query(GeneratedNewsletter).filter_by(id=newsletter_id).first()
    return _newsletter_dict(row) if row else None


def get_pending_jobs(db) -> list[dict]:
    """Returns jobs awaiting approval — shown on Scraping page."""
    from db_models import NewsletterJob
    rows = (
        db.query(NewsletterJob)
          .filter(NewsletterJob.status == "pending_approval")
          .order_by(NewsletterJob.created_at.desc())
          .all()
    )
    return [_job_dict(r) for r in rows]


def get_all_jobs(db) -> list[dict]:
    from db_models import NewsletterJob
    rows = (
        db.query(NewsletterJob)
          .order_by(NewsletterJob.created_at.desc())
          .limit(50)
          .all()
    )
    return [_job_dict(r) for r in rows]


# ── Serialisers ───────────────────────────────────────────────────────────────

def _job_dict(job) -> dict:
    return {
        "job_id": job.job_id,
        "task_id": job.task_id,
        "status": job.status,
        "keyword": job.keyword,
        "article_count": job.article_count,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "webhook_sent_at": job.webhook_sent_at.isoformat() if job.webhook_sent_at else None,
        "responded_at": job.responded_at.isoformat() if job.responded_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


def _newsletter_dict(n) -> dict:
    try:
        content = json.loads(n.content_json or "{}")
    except Exception:
        content = {}
    return {
        "id": n.id,
        "job_id": n.job_id,
        "title": n.title,
        "article_date": n.article_date,
        "provider": n.provider,
        "model": n.model,
        "article_count": n.article_count,
        "content": content,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }
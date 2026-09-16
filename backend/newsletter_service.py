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
import re
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

from core.config import settings

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger("newsletter_service")

WEBHOOK_URL = getattr(settings, "WEBHOOK_URL", os.environ.get("WEBHOOK_URL", "")).rstrip("/")


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
                    "text": "📰 Google News Alert",
                    "weight": "Bolder",
                    "size": "Large",
                    "wrap": True,
                },
                {
                    "type": "TextBlock",
                    "text": (
                        f"**{article_count} articles found** across selected keywords — "
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

    # ── Group articles by keyword (up to 30 articles) ─────────────────────────
    display_articles = articles[:30]

    from collections import OrderedDict
    grouped: OrderedDict[str, list[tuple[int, dict]]] = OrderedDict()

    for idx, article in enumerate(display_articles):
        kw = (
            article.get("keyword")
            or article.get("search_query")
            or (keyword.split(",")[0] if keyword else "General")
        ).strip()
        if kw not in grouped:
            grouped[kw] = []
        grouped[kw].append((idx, article))

    # Render each keyword section with articles listed beneath it
    for kw_idx, (kw_name, kw_articles) in enumerate(grouped.items(), 1):
        # Section Heading for Keyword
        body.append({
            "type": "Container",
            "style": "emphasis",
            "spacing": "Medium",
            "separator": True,
            "items": [
                {
                    "type": "TextBlock",
                    "text": f"📂 **{kw_idx}. {kw_name.title()}** ({len(kw_articles)} posts)",
                    "weight": "Bolder",
                    "size": "Medium",
                    "wrap": True,
                },
            ],
        })

        # Render individual article checkboxes under this keyword
        for post_num, (global_i, article) in enumerate(kw_articles, 1):
            title = (article.get("title") or "").strip() or f"Article {global_i + 1}"
            source = (article.get("source_name") or article.get("source") or "").strip()
            url = (article.get("google_news_url") or article.get("url") or article.get("link") or "").strip()
            published = (article.get("published_at") or article.get("publishedAt") or "").strip()

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

            article_body: list[dict] = [
                {
                    "type": "Input.Toggle",
                    "id": f"selected_{global_i}",
                    "title": f"**{post_num}. {title}**",
                    "value": "false",
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
                    "text": f"[Read article]({url})",
                    "isSubtle": True,
                    "size": "Small",
                    "spacing": "None",
                    "wrap": True,
                })




            body.append({
                "type": "Container",
                "spacing": "Small",
                "items": article_body,
            })

    if len(articles) > 30:
        body.append({
            "type": "TextBlock",
            "text": "⚠️ Display capped at 30 articles due to card size limits.",
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


def build_newsletter_teams_card(newsletter: Any, db: Any = None) -> dict:
    """
    Builds an interactive Microsoft Teams Adaptive Card (v1.4) for a Generated Newsletter.
    Delegates to build_newsletter_action_adaptive_card.
    """
    return build_newsletter_action_adaptive_card(newsletter, db=db)


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


def _webhook_via_powershell(payload: dict, target_url: str = "") -> bool:
    """Send webhook payload via PowerShell Invoke-RestMethod (uses Windows SChannel)."""
    url = target_url or settings.WEBHOOK_URL or WEBHOOK_URL
    if not url:
        return False
    script = f'''
$body = $input | ConvertFrom-Json
try {{
    $resp = Invoke-RestMethod -Uri "{url}" -Method Post -Body ($body | ConvertTo-Json -Compress -Depth 10) -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
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


def _send_card_payload(payload: dict, target_url: str = "") -> bool:
    """
    Sends an Adaptive Card payload to a target Power Automate / Teams webhook.
    Uses Python requests with SSLAdapter, falling back to PowerShell on handshake errors.
    """
    url = target_url or settings.WEBHOOK_URL or WEBHOOK_URL
    if not url:
        logger.warning("No webhook URL configured — skipping Adaptive Card transmission.")
        return False

    session = _make_webhook_session()
    try:
        resp = session.post(url, json=payload, timeout=30)
        logger.info("Adaptive Card POST status: %d (%s)", resp.status_code, url[:50])
        if resp.status_code in (200, 201, 202):
            return True
        else:
            logger.warning("Unexpected status from webhook: %d — %s", resp.status_code, resp.text[:200])
            return False
    except Exception as exc:
        logger.error("Python requests failed: %s — falling back to PowerShell", exc)
    finally:
        session.close()

    return _webhook_via_powershell(payload, target_url=url)


def send_to_teams_webhook(job_id: str, keyword: str, article_count: int, articles: list[dict]) -> bool:
    """Send article selection Adaptive Card directly to Power Automate webhook."""
    target_url = settings.WEBHOOK_URL or WEBHOOK_URL
    if not target_url:
        logger.warning("WEBHOOK_URL not set")
        return False

    adaptive_card = build_adaptive_card(job_id, keyword, article_count, articles)
    payload = {"adaptiveCard": adaptive_card}
    logger.info("Sending initial article selection card for job %s to Teams", job_id)
    return _send_card_payload(payload, target_url)


# ── Individual Generated Newsletter Adaptive Card Builder ─────────────────────

# ── Individual Generated Newsletter Adaptive Card Builder ─────────────────────

def build_newsletter_action_adaptive_card(newsletter: Any, frontend_url: str = "", db: Any = None) -> dict:
    """
    Build an individual interactive Adaptive Card for a generated newsletter with 4 choices:
      1. Action.OpenUrl  -> '👁️ View Full Preview' (Opens standalone HTML email preview in browser tab)
      2. Action.OpenUrl  -> '✏️ Edit in App' (Opens frontend directly in live edit mode without double URLs)
      3. Action.ShowCard -> '✈️ Send via Mailchimp' (Expands audience selection + broadcast confirmation)
      4. Action.ShowCard -> '📁 Save as Draft' (Expands audience selection + save draft confirmation)
    """
    import re

    if isinstance(newsletter, dict):
        nl_id = newsletter.get("id")
        title = (newsletter.get("title") or "Generated Newsletter").strip()
        article_date = newsletter.get("article_date") or ""
        content = newsletter.get("content") or {}
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except Exception:
                content = {}
        mailchimp_status = newsletter.get("mailchimp_status")
    else:
        nl_id = getattr(newsletter, "id", None)
        title = (getattr(newsletter, "title", None) or "Generated Newsletter").strip()
        article_date = getattr(newsletter, "article_date", "") or ""
        try:
            content = json.loads(getattr(newsletter, "content_json", None) or "{}")
        except Exception:
            content = {}
        mailchimp_status = getattr(newsletter, "mailchimp_status", None)

    f_url = (frontend_url or getattr(settings, "FRONTEND_URL", "") or "http://localhost:5173").rstrip("/")
    base_f_url = re.sub(r"/newsletter/?$", "", f_url).rstrip("/")
    edit_url = f"{base_f_url}/newsletter?id={nl_id}&edit=true"

    b_url = (getattr(settings, "BACKEND_URL", "") or "http://localhost:8000").rstrip("/")
    preview_url = f"{b_url}/api/newsletters/{nl_id}/preview"

    hook = str(content.get("hook_paragraph") or "").strip()
    stat = str(content.get("stat_paragraph") or "").strip()
    highlight_stat = str(content.get("highlight_stat") or "").strip()
    context = str(content.get("context_paragraph") or "").strip()
    solution = str(content.get("solution_paragraph") or "").strip()
    cta_label = "👉 Schedule a discovery call"
    full_text = str(content.get("full_text") or "").strip()
    subject_line = str(content.get("email_subject_line") or title or "TrendSense Industry Digest").strip()
    preview_snippet = str(content.get("preview_text") or (content.get("hook_paragraph") or "")[:120]).strip()

    # Load audience choices strictly from DB UserPreferences
    audience_choices = []
    if db is not None:
        try:
            from db_models import UserPreferences
            pref_row = db.query(UserPreferences).filter_by(key="mailchimp_custom_audiences").first()
            if pref_row and pref_row.value:
                custom_list = json.loads(pref_row.value)
                for item in custom_list:
                    if item.get("id"):
                        audience_choices.append({
                            "title": f"{item.get('name', item.get('id'))} ({item.get('id')})",
                            "value": str(item.get("id")),
                        })
        except Exception as exc:
            logger.warning("Could not load audience choices for Teams card: %s", exc)

    body_items: list[dict] = [
        {
            "type": "Container",
            "style": "emphasis",
            "items": [
                {
                    "type": "TextBlock",
                    "text": f"📰 **Newsletter #{nl_id}: {title}**",
                    "weight": "Bolder",
                    "size": "Medium",
                    "wrap": True,
                },
                {
                    "type": "TextBlock",
                    "text": f"📅 Date: {article_date} · Tzunami Marketing Digest",
                    "isSubtle": True,
                    "size": "Small",
                    "spacing": "None",
                    "wrap": True,
                },
                {
                    "type": "TextBlock",
                    "text": f"**Subject:** {subject_line}\n\n**Preview:** {preview_snippet}",
                    "wrap": True,
                    "isSubtle": True,
                    "spacing": "Small",
                },
            ],
        },
    ]

    # Render clean continuous newsletter paragraphs
    if full_text:
        body_text = full_text[:1200]
    else:
        paras = [hook, stat, context, solution]
        body_text = "\n\n".join(p for p in paras if p)

    if body_text:
        body_items.append({
            "type": "TextBlock",
            "text": body_text,
            "wrap": True,
            "spacing": "Medium",
        })

    body_items.append({
        "type": "TextBlock",
        "text": f"**CTA Action:** `{cta_label}`",
        "isSubtle": True,
        "size": "Small",
        "spacing": "Medium",
        "wrap": True,
    })

    cta_url = str(content.get("cta_url") or getattr(settings, "NEWSLETTER_DEFAULT_CTA_URL", "")).strip()

    # Full-preview body: mirrors the actual newsletter content (same fields used
    # to render the real email) plus a genuine, clickable CTA button — shown
    # inline via Action.ShowCard so it expands within Teams instead of
    # navigating away to a browser tab. The standalone HTML preview URL is
    # still offered inside it for anyone who wants the pixel-exact email render.
    preview_body: list[dict] = [
        {
            "type": "TextBlock",
            "text": f"📰 **{subject_line}**",
            "weight": "Bolder",
            "size": "Medium",
            "wrap": True,
        },
    ]
    if full_text:
        preview_body.append({
            "type": "TextBlock",
            "text": full_text,
            "wrap": True,
            "spacing": "Small",
        })
    else:
        if hook:
            preview_body.append({"type": "TextBlock", "text": hook, "wrap": True, "spacing": "Small"})
        if stat:
            stat_text = stat
            if highlight_stat and highlight_stat in stat:
                stat_text = stat.replace(highlight_stat, f"**{highlight_stat}**")
            preview_body.append({"type": "TextBlock", "text": stat_text, "wrap": True, "spacing": "Small", "color": "Attention"})
        if context:
            preview_body.append({"type": "TextBlock", "text": context, "wrap": True, "spacing": "Small"})
        if solution:
            preview_body.append({"type": "TextBlock", "text": solution, "wrap": True, "spacing": "Small"})

    preview_actions = []
    if cta_url:
        preview_actions.append({
            "type": "Action.OpenUrl",
            "title": cta_label,
            "url": cta_url,
        })
    preview_actions.append({
        "type": "Action.OpenUrl",
        "title": "🌐 Open Full Preview in Browser",
        "url": preview_url,
    })

    actions = [
        {
            "type": "Action.ShowCard",
            "title": "👁️ View Full Preview",
            "card": {
                "type": "AdaptiveCard",
                "body": preview_body,
                "actions": preview_actions,
            },
        },
        {
            "type": "Action.OpenUrl",
            "title": "✏️ Edit in App",
            "url": edit_url,
        },
    ]

    if mailchimp_status == "sent":
        body_items.append({
            "type": "TextBlock",
            "text": "🔒 **This newsletter has already been broadcasted via Mailchimp.** (Campaign locked)",
            "isSubtle": True,
            "color": "Good",
            "weight": "Bolder",
            "spacing": "Medium",
        })
    else:
        # Configure & Send Sub-Card
        send_card_items: list[dict] = [
            {
                "type": "TextBlock",
                "text": "📢 **Confirm Campaign Broadcast Details**",
                "weight": "Bolder",
                "size": "Medium",
            },
            {
                "type": "Input.Text",
                "id": "send_subject",
                "label": "Email Subject Line",
                "value": subject_line,
            },
        ]
        if audience_choices:
            send_card_items.append({
                "type": "Input.ChoiceSet",
                "id": "send_audiences",
                "isMultiSelect": True,
                "style": "expanded",
                "label": "👥 Target Audience(s) (Select 1 or more):",
                "choices": audience_choices,
            })
        else:
            send_card_items.append({
                "type": "TextBlock",
                "text": "⚠️ *No audiences saved in DB. Go to Newsletter portal -> 'Manage Audiences' to add audience IDs before sending.*",
                "color": "Warning",
                "wrap": True,
            })

        actions.append({
            "type": "Action.ShowCard",
            "title": "✈️ Send via Mailchimp",
            "card": {
                "type": "AdaptiveCard",
                "body": send_card_items,
                "actions": [
                    {
                        "type": "Action.Submit",
                        "title": "🚀 Confirm & Broadcast Now",
                        "style": "positive",
                        "data": {
                            "action": "newsletter_send",
                            "newsletter_id": nl_id,
                        },
                    },
                ],
            },
        })

        # Configure & Save Draft Sub-Card
        draft_card_items: list[dict] = [
            {
                "type": "TextBlock",
                "text": "📝 **Save Campaign as Mailchimp Draft**",
                "weight": "Bolder",
                "size": "Medium",
            },
            {
                "type": "Input.Text",
                "id": "draft_subject",
                "label": "Draft Subject Line",
                "value": subject_line,
            },
        ]
        if audience_choices:
            draft_card_items.append({
                "type": "Input.ChoiceSet",
                "id": "draft_audiences",
                "isMultiSelect": True,
                "style": "expanded",
                "label": "👥 Target Audience(s) (Select 1 or more):",
                "choices": audience_choices,
            })
        else:
            draft_card_items.append({
                "type": "TextBlock",
                "text": "⚠️ *No audiences saved in DB. Go to Newsletter portal -> 'Manage Audiences' to add audience IDs before drafting.*",
                "color": "Warning",
                "wrap": True,
            })

        actions.append({
            "type": "Action.ShowCard",
            "title": "📁 Save as Draft",
            "card": {
                "type": "AdaptiveCard",
                "body": draft_card_items,
                "actions": [
                    {
                        "type": "Action.Submit",
                        "title": "💾 Save Draft in Mailchimp",
                        "data": {
                            "action": "newsletter_draft",
                            "newsletter_id": nl_id,
                        },
                    },
                ],
            },
        })

    return {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": body_items,
        "actions": actions,
    }


def send_newsletter_cards_to_teams(db, newsletters: list[dict]) -> int:
    """
    Sends an individual Adaptive Card for each newly generated newsletter to Microsoft Teams.
    Includes a 300ms inter-card pacing delay to protect against rate limiting.
    """
    target_url = getattr(settings, "NEWSLETTER_ACTIONS_WEBHOOK_URL", "") or getattr(settings, "WEBHOOK_URL", "") or WEBHOOK_URL
    if not target_url:
        logger.warning("No webhook URL configured — skipping Teams newsletter card dispatch.")
        return 0

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173")
    sent_count = 0

    for idx, nl in enumerate(newsletters):
        try:
            card = build_newsletter_action_adaptive_card(nl, frontend_url=frontend_url, db=db)
            payload = {"adaptiveCard": card}
            ok = _send_card_payload(payload, target_url)
            if ok:
                sent_count += 1
                logger.info("Sent newsletter action card %d/%d (ID: %s) to Teams", idx + 1, len(newsletters), nl.get("id"))
            else:
                logger.warning("Failed to send newsletter action card %d/%d (ID: %s) to Teams", idx + 1, len(newsletters), nl.get("id"))
            if idx < len(newsletters) - 1:
                time.sleep(0.3)
        except Exception as exc:
            logger.error("Error sending newsletter action card for ID %s to Teams: %s", nl.get("id"), exc)

    logger.info("Dispatched %d/%d newsletter action Adaptive Cards to Microsoft Teams.", sent_count, len(newsletters))
    return sent_count



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


# ── Image generation (Disabled — newsletters are text + CTA only) ─────────────

def _generate_newsletter_image(prompt: str = "", api_key: str = "") -> str:
    """Images are disabled for newsletters to maximize email deliverability and avoid policy issues."""
    return ""


# ── Newsletter generation prompt ──────────────────────────────────────────────
NEWSLETTER_SYSTEM = """You are a marketing newsletter writer for Tzunami, a cloud data governance and compliance platform.
You will receive ONE Google News article — its title, description, source, and (when available) the full article body text.

Write a newsletter body in exactly 4 paragraphs, totaling 250-300 words:

Paragraph1 (Hook): Introduce the problem or finding from the article in a relatable, engaging way. Make the reader feel the urgency. 2-3 sentences.

Paragraph2 (Stats): Cite a specific source with concrete statistics. Format: "According to [Source Name], who [credibility statement], [statistic]..." Include one key statistic that should be highlighted in red (plain text only, DO NOT output any HTML tags). 2-3 sentences.

Paragraph3 (Context): Connect the article's topic to current trends — AI adoption, Microsoft Copilot, compliance regulations, data security, or cloud governance. Show why this matters NOW. 2-3 sentences.

Paragraph4 (Solution): Introduce Tzunami as the solution. Position Tzunami as the platform that gives organizations visibility and control. Be authoritative but not salesy. 2-3 sentences.

Also generate:
- email_subject_line: A professional, engaging, high-converting email subject line (under 60 characters) strictly compliant with Mailchimp Acceptable Use and CAN-SPAM policies. AVOID ALL spam trigger words, panic/alarmist phrasing, ALL-CAPS, or clickbait (e.g. do NOT write 'URGENT', 'data breach confirmed', 'hacked', 'act now', 'alert'). Instead, frame the subject around industry insights, data governance, and strategic value (e.g. '[TrendSense] Identity Verification & Cloud Governance Trends').
- preview_text: A compelling 1-sentence inbox preview snippet (under 100 characters) that complements the subject line.
- A short CTA button label (e.g. "👉 Schedule a discovery call")

Return ONLY valid JSON — no markdown, no HTML tags (no <span>, no <style>, no <font>, no <b>), no code fences:
{
  "email_subject_line": "Professional, policy-safe email subject line (under 60 chars)",
  "preview_text": "Engaging 1-sentence inbox preview text (under 100 chars)",
  "hook_paragraph": "2-3 sentences introducing the problem",
  "stat_paragraph": "2-3 sentences with source citation and statistics",
  "source_name": "Name of the source you cited",
  "source_url": "URL to the source article or study (use the article URL if no other source)",
  "highlight_stat": "The key statistic to display in red (e.g. '60-80%' or '3x more')",
  "context_paragraph": "2-3 sentences connecting to current trends",
  "solution_paragraph": "2-3 sentences introducing Tzunami as the solution",
  "cta_label": "Button text (e.g. '👉 Schedule a discovery call')"
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

    # Sort newest-first and cap at the Adaptive Card display limit. This exact
    # list/order is what the card shows and indexes as selected_<i>, so it must
    # also be what raw_articles_json stores — process_webhook_response() later
    # filters by those same indices, and any mismatch here silently saves the
    # wrong articles (or ones the user never even saw on the card).
    sorted_articles = sorted(articles, key=lambda a: a.get("publishedAt") or a.get("published_at") or "", reverse=True)
    webhook_articles = sorted_articles[:25]

    job_id = uuid.uuid4().hex

    job = NewsletterJob(
        job_id=job_id,
        task_id=task_id,
        status="pending_approval",
        keyword=keyword,
        article_count=len(articles),
        webhook_sent_at=_now(),
        raw_articles_json=json.dumps(webhook_articles, ensure_ascii=False),
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

    logger.info("NewsletterJob %s created — %d articles, sending Adaptive Card with %d newest", job_id, len(articles), len(webhook_articles))

    send_to_teams_webhook(job_id, keyword, len(articles), webhook_articles)

    if not WEBHOOK_URL:
        logger.warning("WEBHOOK_URL not set — job %s created but not sent", job_id)
        job.status = "pending_approval"
        job.error = "WEBHOOK_URL not configured in .env"
        db.commit()

    logger.info("Job %s created — returning immediately (approval handled by webhook)", job_id)
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
        # Update TaskHistory so System Activity shows "failed"
        if job.task_id:
            try:
                from db_models import TaskHistory
                task_row = db.query(TaskHistory).filter_by(task_id=job.task_id).first()
                if task_row:
                    task_row.status      = "failed"
                    task_row.finished_at = _now()
                    task_row.error       = (reason or "Rejected by reviewer")[:500]
                    db.commit()
            except Exception:
                pass
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

        if not newsletters:
            # Every article failed to generate (bad/expired LLM key, provider
            # outage, etc.) — surface this as a real failure instead of
            # silently reporting "completed" with zero newsletters, since
            # _generate_newsletters swallows per-article errors internally.
            raise RuntimeError(
                f"Newsletter generation failed for all {len(selected_articles)} selected "
                "article(s) — check LLM Configuration (API key may be invalid/expired) "
                "and backend logs for the underlying error."
            )

        # Dispatch individual Adaptive Cards for each generated newsletter to Teams
        try:
            cards_sent = send_newsletter_cards_to_teams(db, newsletters)
            logger.info("Job %s: dispatched %d newsletter action cards to Teams", job_id, cards_sent)
        except Exception as exc:
            logger.error("Job %s: failed to dispatch newsletter cards to Teams: %s", job_id, exc)

        # Send automated batch completion notification email
        try:
            email_sent = send_batch_completion_email(newsletters, job.keyword or "")
            if email_sent:
                logger.info("Job %s: batch completion notification email dispatched successfully", job_id)
        except Exception as exc:
            logger.error("Job %s: failed to send batch completion email: %s", job_id, exc)

        job.status = "completed"
        job.completed_at = _now()
        db.commit()

        # Update TaskHistory so System Activity shows "completed"
        if job.task_id:
            try:
                from db_models import TaskHistory
                task_row = db.query(TaskHistory).filter_by(task_id=job.task_id).first()
                if task_row:
                    task_row.status      = "completed"
                    task_row.finished_at = _now()
                    task_row.items_count = len(selected_articles)
                    db.commit()
                    logger.info("TaskHistory %s updated to completed (%d items)",
                                job.task_id[:8], len(selected_articles))
            except Exception as exc:
                logger.warning("Could not update TaskHistory for job %s: %s", job_id, exc)

        return {
            **_job_dict(job),
            "selected_count": len(selected_articles),
            "newsletters_created": len(newsletters),
        }

    except Exception as exc:
        logger.error("Job %s processing failed: %s", job_id, exc)
        # If the exception came from a failed flush/commit above, the session
        # is left in "rolled back" state and refuses any further use until
        # explicitly rolled back — without this, marking the job failed below
        # raises its own error and the job is left stuck instead of "failed".
        db.rollback()
        job.status = "failed"
        job.error = str(exc)
        db.commit()
        raise


# ══════════════════════════════════════════════════════════════════════════════
#  Step 2b: Batch Completion Notification Email
# ══════════════════════════════════════════════════════════════════════════════

def send_batch_completion_email(newsletters: list[dict], keyword: str = "") -> bool:
    """
    Sends a clean, professional, and well-structured email notification to
    the configured notification address (e.g. AI@tzunami.com / omratnani83@gmail.com)
    alerting the team that all newsletters for the current batch are ready for review.
    """
    recipient = getattr(settings, "NEWSLETTER_NOTIFICATION_EMAIL", "") or os.environ.get("NEWSLETTER_NOTIFICATION_EMAIL", "omratnani83@gmail.com")
    if not recipient:
        return False

    if not settings.ALERT_SMTP_USER or not settings.ALERT_SMTP_PASS:
        logger.info("SMTP credentials not configured — skipping batch completion email to %s", recipient)
        return False

    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
    subject = "📰 TrendSense: Your Newsletters are Ready for Review on Microsoft Teams"

    html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{subject}</title>
</head>
<body style="margin:0;padding:24px;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="background:#0f172a;padding:24px 28px;text-align:left;">
      <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;letter-spacing:-0.02em;">TrendSense Intelligence</h1>
    </div>
    <div style="padding:32px 28px;color:#334155;line-height:1.65;font-size:15px;">
      <p style="margin-top:0;font-weight:600;color:#0f172a;font-size:16px;">Hello Team,</p>
      <p>Your marketing newsletters have been generated successfully by TrendSense and are now ready for your review.</p>
      <p>You can preview the complete email layouts, make live edits, save drafts, or broadcast directly to subscribers via <strong>Microsoft Teams</strong> or through the <strong>TrendSense Portal</strong>.</p>
      <div style="margin:28px 0;text-align:left;">
        <a href="{frontend_url}/newsletter" style="background-color:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;display:inline-block;">Open TrendSense Portal</a>
      </div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;">
      <p style="margin-bottom:0;color:#64748b;font-size:13px;">TrendSense Automated Intelligence System &bull; Tzunami Inc.</p>
    </div>
  </div>
</body>
</html>"""

    try:
        with smtplib.SMTP(settings.ALERT_SMTP_HOST, settings.ALERT_SMTP_PORT, timeout=15) as srv:
            srv.ehlo()
            srv.starttls()
            srv.ehlo()
            srv.login(settings.ALERT_SMTP_USER, settings.ALERT_SMTP_PASS)
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"]    = f"TrendSense <{settings.ALERT_SMTP_USER}>"
            msg["To"]      = recipient
            msg.attach(MIMEText(html, "html"))
            srv.sendmail(settings.ALERT_SMTP_USER, recipient, msg.as_string())
            logger.info("Batch completion notification email dispatched successfully to %s", recipient)
            return True
    except Exception as exc:
        logger.error("Failed to send batch completion email to %s: %s", recipient, exc)
        return False


# ══════════════════════════════════════════════════════════════════════════════
#  Step 2c: Webhook endpoint helper — parse raw HTTP body from Power Automate
# ══════════════════════════════════════════════════════════════════════════════

def extract_newsletter_ids(raw_body: dict) -> list[int]:
    """
    Extracts all target newsletter IDs from single values, lists, comma strings,
    or checkbox payload keys (e.g. selected_nl_1, newsletter_ids: [1, 2, 3], selected_ids: [1, 2]).
    """
    ids = set()

    # 1. Single ID: "newsletter_id" or "id"
    for key in ("newsletter_id", "id", "target_id"):
        if key in raw_body and raw_body[key]:
            val = str(raw_body[key]).strip()
            for part in val.split(","):
                part = part.strip()
                if part.isdigit():
                    ids.add(int(part))

    # 2. List or comma-delimited string: "newsletter_ids", "selected_ids", "ids", "target_ids"
    for key in ("newsletter_ids", "selected_ids", "ids", "target_ids"):
        if key in raw_body and raw_body[key]:
            val = raw_body[key]
            if isinstance(val, (list, set, tuple)):
                for v in val:
                    try:
                        ids.add(int(str(v).strip()))
                    except (ValueError, TypeError):
                        pass
            elif isinstance(val, str):
                for part in val.split(","):
                    part = part.strip()
                    if part.isdigit():
                        ids.add(int(part))

    # 3. Checkbox format: "selected_nl_123": "true" or "newsletter_123": "true"
    for k, v in raw_body.items():
        if (k.startswith("selected_nl_") or k.startswith("selected_newsletter_") or k.startswith("newsletter_selected_")) and str(v).lower() == "true":
            try:
                nl_id = int(k.rsplit("_", 1)[-1])
                ids.add(nl_id)
            except ValueError:
                pass

    return sorted(list(ids))


def handle_teams_submission(db, raw_body: dict) -> dict:
    """
    Convenience wrapper called directly by the FastAPI webhook endpoints.
    Handles:
      1. Single or Multi-Newsletter Batch Actions from Teams (Draft or Send):
         - action in ("newsletter_draft", "newsletter_send", "newsletter_draft_batch", "newsletter_send_batch")
         - Loops through ALL extracted newsletter IDs and processes each to Mailchimp with rate-limit pacing.
      2. Initial article selection approval / rejection from Teams.
    """
    action = raw_body.get("action", "")
    target_ids = extract_newsletter_ids(raw_body)

    # ── Handle Newsletter Actions (Single or Batch Draft / Send from Teams) ────
    if action in ("newsletter_draft", "newsletter_send", "newsletter_draft_batch", "newsletter_send_batch") and target_ids:
        from services.mailchimp_service import create_and_send_campaign
        from db_models import GeneratedNewsletter

        is_draft = "draft" in action
        # Extract audience selection and customized fields from Teams Adaptive Card payload.
        # The card has two separate Send/Draft sub-cards (Action.ShowCard) with distinct
        # field ids — Adaptive Cards rejects the whole card if two elements anywhere in it
        # share an id, even across collapsed sub-cards, so only one of each pair is ever
        # actually present depending on which sub-card the user submitted.
        selected_aud_raw = (
            raw_body.get("send_audiences")
            or raw_body.get("draft_audiences")
            or raw_body.get("selected_audiences")
            or raw_body.get("audience_ids")
            or raw_body.get("audience_id")
        )
        target_audiences: list[str] = []
        if isinstance(selected_aud_raw, list):
            target_audiences = [str(a).strip() for a in selected_aud_raw if str(a).strip() and str(a).strip().lower() != "default"]
        elif isinstance(selected_aud_raw, str):
            target_audiences = [a.strip() for a in selected_aud_raw.split(",") if a.strip() and a.strip().lower() != "default"]

        custom_subject = (
            raw_body.get("send_subject")
            or raw_body.get("draft_subject")
            or raw_body.get("subject")
            or raw_body.get("custom_subject")
            or ""
        ).strip() or None
        custom_preview = (raw_body.get("preview_text") or "").strip() or None
        custom_from_name = (raw_body.get("from_name") or "").strip() or None
        custom_from_email = (raw_body.get("from_email") or "").strip() or None

        results = []
        errors = []

        for idx, nl_id in enumerate(target_ids):
            nl_row = db.query(GeneratedNewsletter).filter_by(id=nl_id).first()
            if not nl_row:
                errors.append({"newsletter_id": nl_id, "error": "Newsletter not found in database"})
                continue

            # Prevent re-sending already-sent newsletters
            if nl_row.mailchimp_status == "sent":
                logger.info("Newsletter #%d is already sent — skipping duplicate dispatch", nl_id)
                results.append({
                    "newsletter_id": nl_id,
                    "status": "already_sent",
                    "title": nl_row.title,
                    "detail": f"Newsletter #{nl_id} was already broadcasted on {nl_row.mailchimp_sent_at}.",
                })
                continue

            try:
                res = create_and_send_campaign(
                    db,
                    newsletter_id=nl_id,
                    audience_ids=target_audiences if target_audiences else None,
                    subject=custom_subject,
                    preview_text=custom_preview,
                    from_name=custom_from_name,
                    from_email=custom_from_email,
                    draft_only=is_draft,
                )
                results.append({
                    "newsletter_id": nl_id,
                    "status": "ok",
                    "action": "draft" if is_draft else "send",
                    "campaign_id": res.get("campaign_id"),
                    "web_id": res.get("web_id"),
                    "title": nl_row.title,
                    "audiences_count": res.get("audiences_count", 1),
                })
                logger.info("Processed newsletter #%d (%s) [%d/%d]", nl_id, "draft" if is_draft else "send", idx + 1, len(target_ids))
            except Exception as exc:
                logger.error("Failed to process newsletter #%d in batch: %s", nl_id, exc)
                errors.append({"newsletter_id": nl_id, "error": str(exc)})

            # 300ms inter-campaign pacing to respect Mailchimp API rate limits
            if idx < len(target_ids) - 1:
                time.sleep(0.3)

        success_count = len([r for r in results if r.get("status") == "ok"])
        return {
            "status": "ok" if success_count > 0 or not errors else "error",
            "action": "draft" if is_draft else "send",
            "total_requested": len(target_ids),
            "processed_count": success_count,
            "error_count": len(errors),
            "results": results,
            "errors": errors,
            "detail": f"Successfully processed {success_count}/{len(target_ids)} newsletters.",
        }

    # ── Initial Article Selection Approval / Rejection ────────────────────────
    action = action or "approve"
    job_id = raw_body.get("job_id", "")

    if not job_id:
        raise ValueError("job_id or valid newsletter_id is required")

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
            "email_subject_line": f"[TrendSense] {keyword.title()} Industry Digest",
            "preview_text": f"Latest trends, security insights, and data governance updates regarding {keyword}.",
            "hook_paragraph": f"What's really happening with {keyword}?",
            "stat_paragraph": content[:300] if content else "",
            "source_name": article.get("source_name", ""),
            "source_url": article_url,
            "highlight_stat": "",
            "context_paragraph": "",
            "solution_paragraph": "Tzunami provides the visibility and control organizations need.",
            "cta_label": "👉 Schedule a discovery call",
        }

    # Auto-sanitize all text fields to guarantee zero raw HTML tags
    for key in ("email_subject_line", "preview_text", "hook_paragraph", "stat_paragraph", "context_paragraph", "solution_paragraph", "highlight_stat", "full_text"):
        if key in content_parsed and isinstance(content_parsed[key], str):
            content_parsed[key] = re.sub(r"<[^>]+>", "", content_parsed[key]).strip()

    content_parsed["keyword"] = keyword
    content_parsed["cta_label"] = "👉 Schedule a discovery call"
    content_parsed["cta_url"] = "https://calendly.com/d/d3q6-qmw-zp9/cloudsfer-sales-discovery-call"

    try:
        from llm_service import _record_llm_spend
        _record_llm_spend(db, provider, model, "newsletter_generation", p_tok, c_tok, keyword)
    except Exception:
        pass

    today = _now().strftime("%Y-%m-%d")
    clean_subject = content_parsed.get("email_subject_line") or article.get("title") or keyword or "Google News"
    title = f"{clean_subject[:80]} — {today}"

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
    try:
        db.refresh(newsletter)
    except Exception:
        pass

    nl_id = newsletter.id
    if not nl_id:
        try:
            row = (
                db.query(GeneratedNewsletter)
                .filter_by(job_id=job_id, title=title)
                .order_by(GeneratedNewsletter.created_at.desc())
                .first()
            )
            if row:
                nl_id = row.id
        except Exception:
            pass

    return {
        "id": nl_id,
        "title": newsletter.title,
        "article_date": newsletter.article_date,
        "article_count": newsletter.article_count,
        "content": content_parsed,
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
        "mailchimp_campaign_id": getattr(n, "mailchimp_campaign_id", None),
        "mailchimp_status": getattr(n, "mailchimp_status", None),
        "mailchimp_sent_at": n.mailchimp_sent_at.isoformat() if getattr(n, "mailchimp_sent_at", None) else None,
        "mailchimp_web_id": getattr(n, "mailchimp_web_id", None),
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }

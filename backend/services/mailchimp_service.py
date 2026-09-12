"""
services/mailchimp_service.py
=============================
Mailchimp Marketing API (v3) client for TrendSense.

Handles:
  - Account health check & ping
  - Audience / List discovery
  - Responsive HTML email rendering with merge tags
  - Campaign draft creation
  - Campaign content upload
  - Instant dispatch & scheduled dispatch
  - Campaign analytics & engagement reports (opens, clicks, bounces)
"""

from __future__ import annotations

import html
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests.auth import HTTPBasicAuth

from core.config import settings

logger = logging.getLogger("mailchimp_service")

# ── CTA & Brand Defaults ──────────────────────────────────────────────────────
DEFAULT_CTA_URL = "https://booking.cloudsfer.com/meetings/book-tzunami/cloudsfer-sales-discovery-?uuid=9c89c0bf-3626-47ed-831c-f5e2a8ce1380"

SOCIAL_LINKS = [
    {
        "name": "Facebook",
        "url": "https://www.facebook.com/TzunamiDeployer?locale=he_IL",
        "icon": "https://cdn-images.mailchimp.com/icons/social-block-v2/color-facebook-48.png",
    },
    {
        "name": "X",
        "url": "https://twitter.com/tzunami",
        "icon": "https://cdn-images.mailchimp.com/icons/social-block-v2/color-twitter-48.png",
    },
    {
        "name": "Website",
        "url": "https://tzunami.com/",
        "icon": "https://cdn-images.mailchimp.com/icons/social-block-v2/color-link-48.png",
    },
    {
        "name": "LinkedIn",
        "url": "https://www.linkedin.com/company/126996/admin/feed/posts/",
        "icon": "https://cdn-images.mailchimp.com/icons/social-block-v2/color-linkedin-48.png",
    },
]


def extract_server_prefix(api_key: str, explicit_prefix: str = "") -> str:
    """Extract Mailchimp data center prefix (e.g. us19, us21) from the API key suffix if needed."""
    if explicit_prefix and explicit_prefix.strip():
        return explicit_prefix.strip()
    if api_key and "-" in api_key:
        return api_key.split("-")[-1].strip()
    return "us1"


def get_mailchimp_credentials(
    api_key: Optional[str] = None,
    server_prefix: Optional[str] = None,
) -> Tuple[str, str]:
    """Resolve API key and server prefix from explicit params, Settings, or os.environ."""
    key = (
        api_key
        or getattr(settings, "MAILCHIMP_API_KEY", "")
        or os.environ.get("MAILCHIMP_API_KEY", "")
    ).strip()

    prefix = (
        server_prefix
        or getattr(settings, "MAILCHIMP_SERVER_PREFIX", "")
        or os.environ.get("MAILCHIMP_SERVER_PREFIX", "")
    ).strip()

    resolved_prefix = extract_server_prefix(key, prefix)
    return key, resolved_prefix


def _get_auth_session(api_key: str) -> requests.Session:
    """Create a requests session authenticated for Mailchimp HTTP Basic Auth."""
    session = requests.Session()
    session.auth = HTTPBasicAuth("anystring", api_key)
    session.headers.update({
        "User-Agent": "TrendSense-Mailchimp-Client/1.0",
        "Content-Type": "application/json",
    })
    return session


# ══════════════════════════════════════════════════════════════════════════════
#  1. Health & Connection Checks
# ══════════════════════════════════════════════════════════════════════════════

def ping_connection(
    api_key: Optional[str] = None,
    server_prefix: Optional[str] = None,
) -> Dict[str, Any]:
    """Test connection with Mailchimp using /3.0/ping."""
    key, prefix = get_mailchimp_credentials(api_key, server_prefix)
    if not key:
        return {
            "ok": False,
            "configured": False,
            "error": "MAILCHIMP_API_KEY is not set in environment or settings.",
        }

    url = f"https://{prefix}.api.mailchimp.com/3.0/ping"
    try:
        session = _get_auth_session(key)
        resp = session.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            return {
                "ok": True,
                "configured": True,
                "server_prefix": prefix,
                "health_status": data.get("health_status", "Everything's Chimpy!"),
            }
        else:
            try:
                err_data = resp.json()
                detail = err_data.get("detail") or err_data.get("title") or resp.text
            except Exception:
                detail = resp.text
            return {
                "ok": False,
                "configured": True,
                "status_code": resp.status_code,
                "error": detail,
            }
    except Exception as exc:
        logger.exception("Mailchimp ping failed: %s", exc)
        return {
            "ok": False,
            "configured": True,
            "error": str(exc),
        }


# ══════════════════════════════════════════════════════════════════════════════
#  2. Audience (List) Management
# ══════════════════════════════════════════════════════════════════════════════

def get_audiences(
    api_key: Optional[str] = None,
    server_prefix: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Retrieve all audiences/lists in the Mailchimp account."""
    key, prefix = get_mailchimp_credentials(api_key, server_prefix)
    if not key:
        raise ValueError("Mailchimp API key is not configured.")

    url = f"https://{prefix}.api.mailchimp.com/3.0/lists?count=50"
    session = _get_auth_session(key)
    resp = session.get(url, timeout=15)

    if resp.status_code != 200:
        try:
            err = resp.json().get("detail", resp.text)
        except Exception:
            err = resp.text
        raise RuntimeError(f"Mailchimp API error ({resp.status_code}): {err}")

    data = resp.json()
    lists = []
    for item in data.get("lists", []):
        stats = item.get("stats", {})
        lists.append({
            "id": item.get("id"),
            "web_id": item.get("web_id"),
            "name": item.get("name"),
            "member_count": stats.get("member_count", 0),
            "unsubscribe_count": stats.get("unsubscribe_count", 0),
            "open_rate": stats.get("open_rate", 0),
            "click_rate": stats.get("click_rate", 0),
            "date_created": item.get("date_created"),
        })
    return lists


# ══════════════════════════════════════════════════════════════════════════════
#  3. HTML Template Rendering
# ══════════════════════════════════════════════════════════════════════════════

def render_newsletter_html(newsletter_dict: Dict[str, Any]) -> str:
    """
    Renders an inline-styled, responsive HTML email compatible with Mailchimp standards.
    Includes merge tags (*|UNSUB|*, *|UPDATE_PROFILE|*) and Tzunami branding.
    """
    title = str(newsletter_dict.get("title") or "TrendSense Newsletter")
    c = newsletter_dict.get("content") or {}

    hook = str(c.get("hook_paragraph") or "")
    stat = str(c.get("stat_paragraph") or "")
    highlight = str(c.get("highlight_stat") or "")
    context = str(c.get("context_paragraph") or "")
    solution = str(c.get("solution_paragraph") or "")
    cta_label = str(c.get("cta_label") or "👉 Schedule a discovery call")
    image_data = str(c.get("image_data") or "")

    def _strip_html(s: str) -> str:
        if not s:
            return ""
        cleaned = re.sub(r"<[^>]+>", "", str(s))
        return html.unescape(cleaned).strip()

    def _esc(s: str) -> str:
        return html.escape(_strip_html(s))

    def _highlight_stat(text: str, highlight_target: str) -> str:
        clean_text = _strip_html(text)
        clean_target = _strip_html(highlight_target)

        if not clean_target or not clean_text:
            return f'<span style="font-size:18px">{html.escape(clean_text)}</span>'
        escaped_target = re.escape(clean_target)
        try:
            parts = re.split(f"({escaped_target})", clean_text, flags=re.IGNORECASE)
            result = []
            for p in parts:
                if p.lower() == clean_target.lower():
                    result.append(f'<span style="color:#B22222;font-weight:bold;">{html.escape(p)}</span>')
                else:
                    result.append(f'<span style="font-size:18px">{html.escape(p)}</span>')
            return "".join(result)
        except Exception:
            return f'<span style="font-size:18px">{html.escape(clean_text)}</span>'

    social_cells = []
    for s in SOCIAL_LINKS:
        social_cells.append(f"""
        <td align="center" valign="top" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
          <!--[if mso]><td align="center" valign="top"><![endif]-->
          <table align="left" border="0" cellpadding="0" cellspacing="0" style="display:inline;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;float:left;">
            <tr>
              <td valign="top" style="padding-right:10px;padding-bottom:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                  <tr>
                    <td align="left" valign="middle" style="padding-top:5px;padding-right:10px;padding-bottom:5px;padding-left:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                      <table align="left" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;float:left;">
                        <tr>
                          <td align="center" valign="middle" width="24" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                            <a href="{_esc(s['url'])}" target="_blank" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;"><img src="{_esc(s['icon'])}" alt="{_esc(s['name'])}" style="display:block;border:0;height:auto;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" height="24" width="24"></a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <!--[if mso]></td><![endif]-->
        </td>
        """)
    social_icons_html = "\n".join(social_cells)

    image_section = (
        f'<p dir="ltr" style="color:#222222;margin:10px 0;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:150%;text-align:left;"><img src="data:image/png;base64,{image_data}" style="border:0;width:600px;max-width:100%;height:auto;margin:0;outline:none;text-decoration:none;" width="600"></p>'
        if image_data
        else ""
    )

    full_text = str(c.get("full_text") or c.get("body_text") or "").strip()
    if full_text:
        paras = [p.strip() for p in re.split(r"\n\s*\n", full_text) if p.strip()]
        body_paras_html = "\n".join(
            f'<p dir="ltr" style="color:#222222;margin:14px 0;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:160%;text-align:left;">{_highlight_stat(p, highlight)}</p>'
            for p in paras
        )
    else:
        hook_html = f'<p dir="ltr" style="color:#222222;margin:14px 0;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:160%;text-align:left;"><span style="font-size:18px">{_esc(hook)}</span></p>' if hook else ""
        stat_html = f'<p dir="ltr" style="color:#222222;margin:14px 0;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:160%;text-align:left;">{_highlight_stat(stat, highlight)}</p>' if stat else ""
        context_html = f'<p dir="ltr" style="color:#222222;margin:14px 0;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:160%;text-align:left;"><span style="font-size:18px">{_esc(context)}</span></p>' if context else ""
        solution_html = f'<p dir="ltr" style="color:#222222;margin:14px 0;padding:0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:160%;text-align:left;"><span style="font-size:18px">{_esc(solution)}</span></p>' if solution else ""
        body_paras_html = "\n".join(filter(None, [hook_html, stat_html, context_html, solution_html]))

    return f"""<!doctype html>

<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{_esc(title)}</title>
    <style type="text/css">
      p{{margin:10px 0;padding:0;}}
      table{{border-collapse:collapse;}}
      h1,h2,h3,h4,h5,h6{{display:block;margin:0;padding:0;}}
      img,a img{{border:0;height:auto;outline:none;text-decoration:none;}}
      body,#bodyTable,#bodyCell{{height:100%;margin:0;padding:0;width:100%;}}
      .mcnPreviewText{{display:none !important;}}
      #outlook a{{padding:0;}}
      img{{-ms-interpolation-mode:bicubic;}}
      table{{mso-table-lspace:0pt;mso-table-rspace:0pt;}}
      .templateContainer{{max-width:600px !important;}}
      a.mcnButton{{display:block;}}
      @media only screen and (min-width:768px){{.templateContainer{{width:600px !important;}}}}
      @media only screen and (max-width:480px){{body,table,td,p,a,li,blockquote{{-webkit-text-size-adjust:none !important;}}}}
      @media only screen and (max-width:480px){{body{{width:100% !important;min-width:100% !important;}}}}
    </style>
  </head>
  <body style="height:100%;margin:0;padding:0;width:100%;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:#F7F7F7;">
    <span class="mcnPreviewText" style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;visibility:hidden;mso-hide:all;">{_esc(hook[:150])}</span>
    <center>
      <table align="center" border="0" cellpadding="0" cellspacing="0" height="100%" width="100%" id="bodyTable" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;height:100%;margin:0;padding:0;width:100%;background-color:#F7F7F7;">
        <tr>
          <td align="center" valign="top" id="bodyCell" style="height:100%;margin:0;padding:20px 0;width:100%;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:600px !important;background-color:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);" class="templateContainer">
              <!-- BODY -->
              <tr>
                <td align="center" valign="top" style="padding:32px 24px 20px 24px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                    <tr>
                      <td valign="top" style="font-family:Helvetica,Arial,sans-serif;color:#222222;font-size:16px;line-height:150%;">
                        {image_section}
                        {body_paras_html}

                      </td>
                    </tr>
                  </table>
                  <!-- CTA Button -->
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;">
                    <tr>
                      <td align="center" valign="top" style="padding:12px 0;">
                        <table border="0" cellpadding="0" cellspacing="0" style="border-radius:26px;background-color:#2BAADF;">
                          <tr>
                            <td align="center" valign="middle" style="font-family:Helvetica,Arial,sans-serif;font-size:16px;padding:16px 32px;">
                              <a class="mcnButton" title="{_esc(cta_label)}" href="{DEFAULT_CTA_URL}" target="_blank" style="font-weight:bold;letter-spacing:normal;line-height:100%;text-align:center;text-decoration:none;color:#FFFFFF;display:block;">{_esc(cta_label)}</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <!-- Social Bar -->
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px;border-radius:6px;background-color:#31AFE2;">
                    <tr>
                      <td align="center" valign="top" style="padding:10px 0;">
                        <table align="center" border="0" cellpadding="0" cellspacing="0">
                          <tr>
                            {social_icons_html}
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- FOOTER (CAN-SPAM / Mailchimp Merge Tags) -->
              <tr>
                <td align="center" valign="top" style="background-color:#333333;padding:24px 20px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:150%;color:#FFFFFF;text-align:center;">
                  <em>Copyright &copy; *|CURRENT_YEAR|* Tzunami Inc. All rights reserved.</em><br><br>
                  <strong>Our mailing address:</strong><br>
                  *|LIST:COMPANY|* &bull; *|LIST:ADDRESSLINE|*<br><br>
                  Want to change how you receive these emails?<br>
                  You can <a href="*|UPDATE_PROFILE|*" style="color:#2BAADF;text-decoration:underline;">update your preferences</a> or <a href="*|UNSUB|*" style="color:#2BAADF;text-decoration:underline;">unsubscribe from this list</a>.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </center>
  </body>
</html>""".strip()


# ══════════════════════════════════════════════════════════════════════════════
#  4. Campaign Creation, Sending & Scheduling
# ══════════════════════════════════════════════════════════════════════════════

def create_and_send_campaign(
    db,
    newsletter_id: int,
    audience_id: Optional[str] = None,
    subject: Optional[str] = None,
    preview_text: Optional[str] = None,
    from_name: Optional[str] = None,
    from_email: Optional[str] = None,
    schedule_time_iso: Optional[str] = None,
    draft_only: bool = False,
) -> Dict[str, Any]:
    """
    Main pipeline:
      1. Load GeneratedNewsletter from DB
      2. Render HTML template
      3. Create Mailchimp Campaign draft
      4. Set campaign content (HTML)
      5. Send immediately OR schedule for later OR leave as draft
      6. Update DB record with campaign_id and status
    """
    from db_models import GeneratedNewsletter

    row = db.query(GeneratedNewsletter).filter_by(id=newsletter_id).first()
    if not row:
        raise ValueError(f"Newsletter with id {newsletter_id} not found.")

    key, prefix = get_mailchimp_credentials()
    if not key:
        raise ValueError("Mailchimp API key is not configured. Please set MAILCHIMP_API_KEY in your .env file.")

    target_audience = (
        audience_id
        or getattr(settings, "MAILCHIMP_AUDIENCE_ID", "")
        or os.environ.get("MAILCHIMP_AUDIENCE_ID", "")
    ).strip()

    if not target_audience:
        audiences = get_audiences(key, prefix)
        if audiences:
            target_audience = audiences[0]["id"]
            logger.info("Auto-selected first Mailchimp audience: %s (%s)", audiences[0]["name"], target_audience)
        else:
            raise ValueError("No Mailchimp Audience found. Please provide an Audience ID or create one in Mailchimp.")

    sender_name = (
        from_name
        or getattr(settings, "MAILCHIMP_FROM_NAME", "TrendSense Newsletter")
        or os.environ.get("MAILCHIMP_FROM_NAME", "TrendSense Newsletter")
    ).strip()

    sender_email = (
        from_email
        or getattr(settings, "MAILCHIMP_FROM_EMAIL", "")
        or os.environ.get("MAILCHIMP_FROM_EMAIL", "")
    ).strip()

    if not sender_email:
        raise ValueError("Sender email is required. Please set MAILCHIMP_FROM_EMAIL in your .env file.")

    try:
        content_dict = json.loads(row.content_json or "{}")
    except Exception:
        content_dict = {}

    campaign_subject = (
        (subject or "").strip()
        or str(content_dict.get("email_subject_line") or "").strip()
        or (row.title or "").strip()
        or "TrendSense Industry Digest"
    )
    snippet = (
        (preview_text or "").strip()
        or str(content_dict.get("preview_text") or "").strip()
        or str(content_dict.get("hook_paragraph") or "")[:120].strip()
    )

    session = _get_auth_session(key)

    campaign_payload = {
        "type": "regular",
        "recipients": {
            "list_id": target_audience,
        },
        "settings": {
            "subject_line": campaign_subject,
            "preview_text": snippet,
            "title": f"TrendSense: {campaign_subject[:80]}",
            "from_name": sender_name,
            "reply_to": sender_email,
            "authenticate": True,
            "auto_footer": False,
            "inline_css": True,
        },
    }

    create_url = f"https://{prefix}.api.mailchimp.com/3.0/campaigns"
    logger.info("Creating Mailchimp campaign for newsletter #%d (%s) [draft_only=%s]", newsletter_id, campaign_subject, draft_only)
    resp = session.post(create_url, json=campaign_payload, timeout=20)
    if resp.status_code not in (200, 201):
        try:
            err = resp.json().get("detail", resp.text)
        except Exception:
            err = resp.text
        raise RuntimeError(f"Failed to create Mailchimp campaign ({resp.status_code}): {err}")

    camp_data = resp.json()
    campaign_id = camp_data.get("id")
    web_id = str(camp_data.get("web_id") or "")

    newsletter_dict = {
        "title": campaign_subject,
        "content": content_dict,
    }
    rendered_html = render_newsletter_html(newsletter_dict)

    content_url = f"https://{prefix}.api.mailchimp.com/3.0/campaigns/{campaign_id}/content"
    content_resp = session.put(content_url, json={"html": rendered_html}, timeout=20)
    if content_resp.status_code not in (200, 201):
        try:
            err = content_resp.json().get("detail", content_resp.text)
        except Exception:
            err = content_resp.text
        raise RuntimeError(f"Failed to set campaign content ({content_resp.status_code}): {err}")

    now = datetime.now(tz=timezone.utc)
    status = "sent"

    if draft_only:
        status = "draft"
        logger.info("Successfully created Mailchimp draft campaign %s (web_id: %s)", campaign_id, web_id)
    elif schedule_time_iso:
        try:
            dt = datetime.fromisoformat(schedule_time_iso.replace("Z", "+00:00"))
            # Mailchimp requires minutes to be 00, 15, 30, or 45
            rem = dt.minute % 15
            if rem != 0:
                dt = dt + timedelta(minutes=(15 - rem))
            dt = dt.replace(second=0, microsecond=0)
            formatted_sched_time = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
        except Exception:
            formatted_sched_time = schedule_time_iso

        sched_url = f"https://{prefix}.api.mailchimp.com/3.0/campaigns/{campaign_id}/actions/schedule"
        logger.info("Scheduling Mailchimp campaign %s for %s", campaign_id, formatted_sched_time)
        sched_resp = session.post(sched_url, json={"schedule_time": formatted_sched_time}, timeout=20)
        if sched_resp.status_code not in (200, 204):
            try:
                err = sched_resp.json().get("detail", sched_resp.text)
            except Exception:
                err = sched_resp.text
            raise RuntimeError(f"Failed to schedule campaign ({sched_resp.status_code}): {err}")
        status = "scheduled"

    else:
        send_url = f"https://{prefix}.api.mailchimp.com/3.0/campaigns/{campaign_id}/actions/send"
        send_resp = session.post(send_url, timeout=20)
        if send_resp.status_code not in (200, 204):
            try:
                err = send_resp.json().get("detail", send_resp.text)
            except Exception:
                err = send_resp.text
            raise RuntimeError(f"Failed to send campaign ({send_resp.status_code}): {err}")
        status = "sent"

    row.mailchimp_campaign_id = campaign_id
    row.mailchimp_status = status
    row.mailchimp_sent_at = now if status == "sent" else None
    row.mailchimp_web_id = web_id
    db.commit()

    return {
        "status": "ok",
        "campaign_id": campaign_id,
        "web_id": web_id,
        "action": "draft" if draft_only else ("scheduled" if schedule_time_iso else "sent"),
        "mailchimp_status": status,
        "sent_at": now.isoformat() if status == "sent" else None,
        "audience_id": target_audience,
        "subject": campaign_subject,
        "mailchimp_url": f"https://admin.mailchimp.com/campaigns/edit?id={web_id}" if web_id else None,
    }



# ══════════════════════════════════════════════════════════════════════════════
#  5. Campaign Engagement Reports
# ══════════════════════════════════════════════════════════════════════════════

def get_campaign_report(campaign_id: str) -> Dict[str, Any]:
    """Fetch real-time delivery and engagement metrics from Mailchimp."""
    if not campaign_id:
        raise ValueError("Campaign ID is required.")

    key, prefix = get_mailchimp_credentials()
    if not key:
        raise ValueError("Mailchimp API key is not configured.")

    url = f"https://{prefix}.api.mailchimp.com/3.0/reports/{campaign_id}"
    session = _get_auth_session(key)
    resp = session.get(url, timeout=15)

    if resp.status_code != 200:
        try:
            err = resp.json().get("detail", resp.text)
        except Exception:
            err = resp.text
        raise RuntimeError(f"Mailchimp report error ({resp.status_code}): {err}")

    data = resp.json()
    opens = data.get("opens", {})
    clicks = data.get("clicks", {})
    bounces = data.get("bounces", {})

    return {
        "campaign_id": campaign_id,
        "campaign_title": data.get("campaign_title", ""),
        "subject_line": data.get("subject_line", ""),
        "emails_sent": data.get("emails_sent", 0),
        "abuse_reports": data.get("abuse_reports", 0),
        "unsubscribed": data.get("unsubscribed", 0),
        "opens": {
            "opens_total": opens.get("opens_total", 0),
            "unique_opens": opens.get("unique_opens", 0),
            "open_rate": opens.get("open_rate", 0.0),
            "last_open": opens.get("last_open"),
        },
        "clicks": {
            "clicks_total": clicks.get("clicks_total", 0),
            "unique_clicks": clicks.get("unique_clicks", 0),
            "click_rate": clicks.get("click_rate", 0.0),
            "last_click": clicks.get("last_click"),
        },
        "bounces": {
            "hard_bounces": bounces.get("hard_bounces", 0),
            "soft_bounces": bounces.get("soft_bounces", 0),
        },
    }

"""
llm_service.py
==============
Handles all LLM interactions:
  - Provider config CRUD (keys stored in DB)
  - Prompt enhancement via GPT-4o (or env-configured model)
  - Feed-to-LLM: sends scraped data + user prompt to selected provider

Cost tracking is written to llm_spending table.

Supported providers: openai, anthropic, gemini
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("llm_service")

# ── Default prompt enhancer (can be overridden in .env) ──────────────────────
PROMPT_ENHANCER_MODEL = os.environ.get("PROMPT_ENHANCER_MODEL", "gpt-4o")

# ── Pricing (per 1M tokens, USD) ─────────────────────────────────────────────
# Prices per 1M tokens (USD). Updated from official provider pricing pages.
# Gemini 2.5 Pro / 3.1 Pro Preview use the ≤200k context tier (lower rate).
LLM_PRICING = {
    # ── OpenAI ────────────────────────────────────────────────────────────────
    "gpt-4o-mini":  {"input": 0.15,  "output": 0.60},
    "gpt-4o":       {"input": 2.50,  "output": 10.00},
    "gpt-4.1":      {"input": 2.00,  "output": 8.00},
    "gpt-5":        {"input": 1.25,  "output": 10.00},
    "gpt-5.1":      {"input": 1.25,  "output": 10.00},
    "gpt-5.2":      {"input": 1.75,  "output": 14.00},
    # ── Anthropic ─────────────────────────────────────────────────────────────
    "claude-opus-4-7":   {"input": 5.00,  "output": 25.00},
    "claude-sonnet-4-6": {"input": 3.00,  "output": 15.00},
    "claude-haiku-4-5":  {"input": 1.00,  "output": 5.00},
    # ── Gemini ────────────────────────────────────────────────────────────────
    "gemini-2.5-pro":        {"input": 1.25,  "output": 10.00},  # ≤200k tier
    "gemini-3.1-pro-preview": {"input": 2.00,  "output": 12.00},  # ≤200k tier
    "gemini-2.5-flash":      {"input": 0.30,  "output": 2.50},
    "gemini-3-flash-preview": {"input": 0.50,  "output": 3.00},
}

def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    pricing = LLM_PRICING.get(model, {"input": 1.0, "output": 3.0})
    cost = (prompt_tokens * pricing["input"] + completion_tokens * pricing["output"]) / 1_000_000
    return round(cost, 8)

def _record_llm_spend(db, provider: str, model: str, operation: str,
                       prompt_tokens: int, completion_tokens: int,
                       keyword: str = "", is_estimated: bool = False) -> None:
    if db is None:
        return
    try:
        from db_models import LLMSpending
        cost = _estimate_cost(model, prompt_tokens, completion_tokens)
        row = LLMSpending(
            provider          = provider,
            model             = model,
            operation         = operation,
            prompt_tokens     = prompt_tokens,
            completion_tokens = completion_tokens,
            total_tokens      = prompt_tokens + completion_tokens,
            cost_usd          = cost,
            is_estimated      = is_estimated,
            keyword           = (keyword or "")[:255],
            called_at         = datetime.now(tz=timezone.utc),
        )
        db.add(row)
        db.commit()
        logger.info("LLM spend recorded: %.6f USD  provider=%s  model=%s  op=%s",
                    cost, provider, model, operation)
    except Exception as exc:
        logger.error("Failed to record LLM spend: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════════════════
#  Provider Config CRUD
# ══════════════════════════════════════════════════════════════════════════════

def get_all_configs(db) -> list[dict]:
    """Return config for all three providers (creates empty rows if missing)."""
    from db_models import LLMProviderConfig
    providers = ["openai", "anthropic", "gemini"]
    result = []
    for prov in providers:
        row = db.query(LLMProviderConfig).filter_by(provider=prov).first()
        if not row:
            result.append({
                "provider":  prov,
                "api_key":   "",
                "model":     "",
                "is_active": False,
                "has_key":   False,
            })
        else:
            result.append({
                "provider":  row.provider,
                "api_key":   "***" if row.api_key else "",   # never send real key to frontend
                "model":     row.model or "",
                "is_active": row.is_active or False,
                "has_key":   bool(row.api_key),
            })
    return result


def save_provider_config(db, provider: str, api_key: str | None,
                          model: str, set_active: bool) -> dict:
    """
    Upsert provider config.
    If api_key is None or "***", keep the existing key (don't overwrite).
    If set_active=True, deactivate all others first.
    """
    from db_models import LLMProviderConfig
    if provider not in ("openai", "anthropic", "gemini"):
        raise ValueError(f"Unknown provider: {provider}")

    row = db.query(LLMProviderConfig).filter_by(provider=provider).first()

    if set_active:
        # Deactivate all providers
        db.query(LLMProviderConfig).update({"is_active": False})

    if row:
        if api_key and api_key != "***":
            row.api_key = api_key
        row.model      = model
        row.is_active  = set_active
        row.updated_at = datetime.now(tz=timezone.utc)
    else:
        row = LLMProviderConfig(
            provider   = provider,
            api_key    = api_key if (api_key and api_key != "***") else None,
            model      = model,
            is_active  = set_active,
            updated_at = datetime.now(tz=timezone.utc),
        )
        db.add(row)

    db.commit()
    return {"status": "ok", "provider": provider, "model": model, "is_active": set_active}


def get_active_config(db) -> dict | None:
    """Return the active provider config with real API key, or None."""
    from db_models import LLMProviderConfig
    row = db.query(LLMProviderConfig).filter_by(is_active=True).first()
    if not row or not row.api_key:
        return None
    return {
        "provider": row.provider,
        "api_key":  row.api_key,
        "model":    row.model,
    }


def get_provider_key(db, provider: str) -> str | None:
    """Return raw API key for a specific provider."""
    from db_models import LLMProviderConfig
    row = db.query(LLMProviderConfig).filter_by(provider=provider).first()
    return row.api_key if row else None


# ══════════════════════════════════════════════════════════════════════════════
#  Prompt Enhancement  (always uses GPT-4o or env-configured model)
# ══════════════════════════════════════════════════════════════════════════════

ENHANCE_SYSTEM = """You are an expert prompt engineer and data analyst.
The user wants to analyze scraped social media / forum data.
Your job:
1. Rewrite their prompt into a clear, professional, JSON-structured analysis request.
2. Add any obvious missing intent you detect (e.g. if they say "summarize" also add "key themes", "sentiment").
3. Return ONLY valid JSON with these fields:
   {
     "enhanced_prompt": "...",      // the full improved prompt to send to the LLM
     "summary_for_user": "...",     // 1-2 sentence plain English explanation of what you understood + added
     "suggested_output_format": "..." // e.g. "JSON with keys: summary, themes, sentiment, recommendations"
   }
Do NOT add markdown, code fences, or explanation outside the JSON."""

def enhance_prompt(db, raw_prompt: str, data_sources: list[str] = None,
                   sample_rows: list[dict] = None) -> dict:
    """
    Takes a raw user prompt, runs it through GPT-4o to produce a structured,
    improved prompt. sample_rows is a tiny sample (1 row) for context only —
    the full dataset is sent separately during the actual feed call.
    Raises RuntimeError if OpenAI key is not configured.
    """
    # Get OpenAI key — either from env override or DB
    enhancer_key = os.environ.get("PROMPT_ENHANCER_KEY", "").strip()
    if not enhancer_key and db is not None:
        enhancer_key = get_provider_key(db, "openai") or ""

    if not enhancer_key:
        raise RuntimeError(
            "No OpenAI API key configured. The prompt enhancer requires an OpenAI key. "
            "Please configure OpenAI in LLM Configuration."
        )

    sample_hint = ""
    if sample_rows:
        sample_text = json.dumps(sample_rows[:1], ensure_ascii=False, indent=2)
        sample_hint = f"\nSample record (1 of many — for structure reference only):\n{sample_text}"

    user_msg = f"User's raw prompt: {raw_prompt}{sample_hint}"

    try:
        import openai
        client = openai.OpenAI(api_key=enhancer_key)
        resp = client.chat.completions.create(
            model       = PROMPT_ENHANCER_MODEL,
            temperature = 0,
            messages    = [
                {"role": "system", "content": ENHANCE_SYSTEM},
                {"role": "user",   "content": user_msg},
            ],
        )
        content = resp.choices[0].message.content.strip()

        # Record spend
        usage = resp.usage
        if db is not None:
            _record_llm_spend(
                db, "openai", PROMPT_ENHANCER_MODEL, "prompt_enhance",
                usage.prompt_tokens, usage.completion_tokens, raw_prompt[:255]
            )

        # Parse JSON
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            # Fallback: return raw content as enhanced_prompt
            parsed = {
                "enhanced_prompt":        content,
                "summary_for_user":       "Your prompt has been processed.",
                "suggested_output_format": "Plain text",
            }
        return parsed

    except Exception as exc:
        logger.error("Prompt enhancement failed: %s", exc)
        err_str = str(exc).lower()
        if "timed out" in err_str or "timeout" in err_str:
            raise RuntimeError(
                "The AI service took too long to respond (request timed out). "
                "This usually means OpenAI servers are busy. Please try again in a moment."
            ) from exc
        elif "authentication" in err_str or "api key" in err_str or "invalid_api_key" in err_str:
            raise RuntimeError(
                "Your OpenAI API key is invalid or expired. "
                "Please update it in LLM Configuration."
            ) from exc
        elif "rate limit" in err_str or "rate_limit" in err_str:
            raise RuntimeError(
                "OpenAI rate limit reached. You have made too many requests. "
                "Please wait a minute and try again."
            ) from exc
        elif "insufficient_quota" in err_str or "billing" in err_str:
            raise RuntimeError(
                "Your OpenAI account has insufficient credits. "
                "Please check your billing at platform.openai.com."
            ) from exc
        else:
            raise RuntimeError(
                f"Could not enhance your prompt: {exc}. "
                "Please check your internet connection and try again."
            ) from exc


# ══════════════════════════════════════════════════════════════════════════════
#  Feed to LLM  (sends data + enhanced prompt to the user's selected provider)
# ══════════════════════════════════════════════════════════════════════════════

def _truncate_data(data_rows: list[dict]) -> tuple[str, int]:
    """Serialize all records and send them to the LLM as-is, no size limit."""
    text = json.dumps(data_rows, ensure_ascii=False, indent=2)
    return text, len(data_rows)


def feed_to_llm(db, enhanced_prompt: str, data_rows: list[dict],
                keyword: str = "") -> dict:
    """
    Sends the enhanced prompt + scraped data to the user's active LLM provider.
    Returns: { "response": str, "provider": str, "model": str, "tokens_used": int }
    Raises RuntimeError if no active provider configured.
    """
    config = get_active_config(db)
    if not config:
        raise RuntimeError(
            "No LLM provider configured or no API key set. "
            "Please configure a provider in LLM Configuration."
        )

    provider = config["provider"]
    model    = config["model"]
    api_key  = config["api_key"]
    data_text, row_count = _truncate_data(data_rows)

    system_msg = (
        "You are an expert intelligence analyst. "
        "You will be given scraped social media and forum data in JSON format, "
        "followed by an analysis request. "
        "Be thorough, structured, and professional. "
        "Return your response in the format specified by the user's prompt."
    )
    user_msg = (
        f"=== SCRAPED DATA ({row_count} records) ===\n\n"
        f"{data_text}\n\n"
        f"=== ANALYSIS REQUEST ===\n\n"
        f"{enhanced_prompt}"
    )

    if provider == "openai":
        return _call_openai(db, api_key, model, system_msg, user_msg, keyword)
    elif provider == "anthropic":
        return _call_anthropic(db, api_key, model, system_msg, user_msg, keyword)
    elif provider == "gemini":
        return _call_gemini(db, api_key, model, system_msg, user_msg, keyword)
    else:
        raise RuntimeError(f"Unknown provider: {provider}")


def _call_openai(db, api_key: str, model: str, system_msg: str,
                  user_msg: str, keyword: str) -> dict:
    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model       = model,
            temperature = 0,
            messages    = [
                {"role": "system", "content": system_msg},
                {"role": "user",   "content": user_msg},
            ],
        )
        content = resp.choices[0].message.content
        usage   = resp.usage
        _record_llm_spend(db, "openai", model, "feed_to_llm",
                          usage.prompt_tokens, usage.completion_tokens, keyword)
        return {
            "response":    content,
            "provider":    "openai",
            "model":       model,
            "tokens_used": usage.total_tokens,
            "cost_usd":    _estimate_cost(model, usage.prompt_tokens, usage.completion_tokens),
        }
    except Exception as exc:
        logger.error("OpenAI call failed: %s", exc)
        raise RuntimeError(f"OpenAI error: {exc}") from exc


def _call_anthropic(db, api_key: str, model: str, system_msg: str,
                     user_msg: str, keyword: str) -> dict:
    # Map UI model slugs → actual Anthropic API model IDs
    ANTHROPIC_MODEL_MAP = {
        "claude-opus-4-7":   "claude-opus-4-7",
        "claude-sonnet-4-6": "claude-sonnet-4-6",
        "claude-haiku-4-5":  "claude-haiku-4-5-20251001",
    }
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        api_model = ANTHROPIC_MODEL_MAP.get(model, model)
        resp = client.messages.create(
            model      = api_model,
            max_tokens = 4096,
            system     = system_msg,
            messages   = [{"role": "user", "content": user_msg}],
        )
        content = resp.content[0].text
        p_tok   = resp.usage.input_tokens
        c_tok   = resp.usage.output_tokens
        _record_llm_spend(db, "anthropic", model, "feed_to_llm",
                          p_tok, c_tok, keyword)
        return {
            "response":    content,
            "provider":    "anthropic",
            "model":       model,
            "tokens_used": p_tok + c_tok,
            "cost_usd":    _estimate_cost(model, p_tok, c_tok),
        }
    except Exception as exc:
        logger.error("Anthropic call failed: %s", exc)
        raise RuntimeError(f"Anthropic error: {exc}") from exc


def _call_gemini(db, api_key: str, model: str, system_msg: str,
                  user_msg: str, keyword: str) -> dict:
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)

        # Map UI model slugs → actual Gemini API model IDs
        MODEL_MAP = {
            "gemini-2.5-pro":         "gemini-2.5-pro-preview-05-06",
            "gemini-3.1-pro-preview":  "gemini-2.5-pro-preview-05-06",
            "gemini-2.5-flash":        "gemini-2.5-flash-preview-04-17",
            "gemini-3-flash-preview":  "gemini-2.0-flash",
        }
        api_model = MODEL_MAP.get(model, model)
        gmodel = genai.GenerativeModel(
            model_name     = api_model,
            system_instruction = system_msg,
        )
        resp = gmodel.generate_content(
            user_msg,
            generation_config=genai.GenerationConfig(temperature=0),
        )
        content = resp.text
        # Gemini token counting is approximate
        p_tok = getattr(resp.usage_metadata, "prompt_token_count",    0) or 0
        c_tok = getattr(resp.usage_metadata, "candidates_token_count", 0) or 0
        _record_llm_spend(db, "gemini", model, "feed_to_llm",
                          p_tok, c_tok, keyword, is_estimated=True)
        return {
            "response":    content,
            "provider":    "gemini",
            "model":       model,
            "tokens_used": p_tok + c_tok,
            "cost_usd":    _estimate_cost(model, p_tok, c_tok),
        }
    except Exception as exc:
        logger.error("Gemini call failed: %s", exc)
        raise RuntimeError(f"Gemini error: {exc}") from exc


# ══════════════════════════════════════════════════════════════════════════════
#  LLM Spending Summary (for Cost Governance)
# ══════════════════════════════════════════════════════════════════════════════

def get_llm_spending_summary(db) -> dict:
    """Returns LLM cost summary grouped by provider for the current month."""
    if db is None:
        return {"total_month_usd": 0.0, "by_provider": []}
    try:
        from db_models import LLMSpending
        from sqlalchemy import func
        from datetime import timedelta

        now         = datetime.now(tz=timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        rows = (
            db.query(
                LLMSpending.provider,
                LLMSpending.model,
                func.sum(LLMSpending.cost_usd).label("month_usd"),
                func.sum(LLMSpending.total_tokens).label("total_tokens"),
                func.count(LLMSpending.id).label("call_count"),
            )
            .filter(LLMSpending.called_at >= month_start)
            .group_by(LLMSpending.provider, LLMSpending.model)
            .order_by(func.sum(LLMSpending.cost_usd).desc())
            .all()
        )

        total = sum(float(r.month_usd or 0) for r in rows)
        by_provider = [
            {
                "provider":     r.provider,
                "model":        r.model,
                "month_usd":    round(float(r.month_usd or 0), 6),
                "total_tokens": int(r.total_tokens or 0),
                "call_count":   int(r.call_count or 0),
            }
            for r in rows
        ]
        return {
            "total_month_usd": round(total, 6),
            "by_provider":     by_provider,
        }
    except Exception as exc:
        logger.error("get_llm_spending_summary failed: %s", exc)
        return {"total_month_usd": 0.0, "by_provider": []}
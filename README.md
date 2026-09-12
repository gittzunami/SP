# TrendSense — Scraper, Newsletter & Mailchimp Pipeline

FastAPI backend + React frontend that scrapes news/forum sources, runs LLM analysis
("Smart Brain"), and — for Google News specifically — turns scraped articles into
AI-generated newsletters that go out through Microsoft Teams (via Power Automate)
and Mailchimp.

This document focuses on the **Google News → Teams → Newsletter → Mailchimp pipeline**,
since that's the part with the most moving parts across three systems (backend,
Power Automate, Mailchimp). For everything else (other scrapers, Smart Brain, LLM
Configuration, dashboards) see the code under `backend/api/routers/`.

## Contents

- [Architecture](#architecture)
- [The pipeline, end to end](#the-pipeline-end-to-end)
- [Power Automate flow setup](#power-automate-flow-setup)
- [Environment variables](#environment-variables)
- [API endpoints](#api-endpoints)
- [Database models](#database-models)
- [Running locally](#running-locally)
- [Known gotchas / troubleshooting](#known-gotchas--troubleshooting)

## Architecture

```
backend/            FastAPI app
  api/routers/       HTTP endpoints (scrapers, newsletter, mailchimp, smart_brain, ...)
  core/              settings (env vars), DI container (in-memory app state)
  infrastructure/    SQLAlchemy models (db_models.py re-exports these)
  scrapers/          one module per source (google_news, edugeek, reddit, ...)
  services/          mailchimp_service.py, db_writer.py, ...
  newsletter_service.py   the Google News → Teams → Newsletter pipeline (see below)
  llm_service.py     LLM provider config + spend tracking

frontend/            React (Vite) app
  src/features/       one folder per feature area (newsletter, scraping, dashboard, ...)
```

Data persists to Postgres (`DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` env vars). If
those aren't set, the DB layer disables itself and most scraper endpoints still work
(results saved to JSON), but the newsletter pipeline requires a DB.

## The pipeline, end to end

There are **two separate Power Automate flows** involved, both hitting the same
backend, plus one recurring trigger:

**1. Auto-scrape trigger** (scheduled, external — e.g. a Teams/Power Automate
recurrence flow) calls:

```
POST /api/webhook/google-news/auto-scrape
```
(`backend/api/routers/newsletter.py`) — scrapes Google News for every keyword
assigned to the `google_news` scraper, then automatically continues into step 2.

**2. Scraper finishes → `send_to_webhook()`** (`newsletter_service.py`)
- Cleans articles, sorts them newest-first, caps at 25 (Adaptive Card size limit).
- Creates a `NewsletterJob` row (`status: pending_approval`) and saves this **exact**
  25-article list as `raw_articles_json` — this list's order is what later gets
  indexed by the Teams card's checkboxes, so it must never drift from what's shown.
- Also saves *all* scraped articles (not just the top 25) to the general
  `google_news_articles` table for full archival, independent of the job.
- POSTs an Adaptive Card to Power Automate **Flow B**'s trigger URL (`WEBHOOK_URL`).

**3. Flow B posts the card to Teams and waits.** A reviewer ticks the articles they
want and clicks **Save Selected Articles** (or **Reject All**). Flow B POSTs the
response back to:

```
POST /api/webhook/google-news/response
Body: { "action": "approve" | "reject", "job_id": "...", "selected_0": "true", ... }
```

**4. `process_webhook_response()`** filters to the selected articles, generates one
newsletter per selected article via the configured LLM provider (see **LLM
Configuration** in the app — this is a DB-stored provider/model/API-key row, not an
env var), then automatically calls `send_newsletter_cards_to_teams()` — which POSTs
**one new Adaptive Card per generated newsletter**, again to Power Automate.

**5. This second card** (`build_newsletter_action_adaptive_card`) offers three
choices per newsletter: **Edit in App** (opens the frontend, no callback),
**Save as Draft**, **Send via Mailchimp**. It's sent to
`NEWSLETTER_ACTIONS_WEBHOOK_URL` if set, otherwise it falls back to reusing
`WEBHOOK_URL` — i.e. **the same Flow B**, which is why Flow B needs a branch (see
below) to tell the two response shapes apart.

**6. Whichever button is clicked**, the response comes back to:

```
POST /api/webhook/google-news/response   (same URL, or /api/webhook/newsletter/action)
Body: { "action": "newsletter_draft" | "newsletter_send", "newsletter_id": 123 }
```

`handle_teams_submission()` routes this to
`services/mailchimp_service.create_and_send_campaign()`, which creates a Mailchimp
campaign (draft or sent), rendering the newsletter's LLM-generated HTML, using the
LLM-generated `email_subject_line`/`preview_text` (CAN-SPAM-compliant, generated
alongside the newsletter body) as the campaign subject/preview.

## Power Automate flow setup

**Flow B** (one flow handles both the topic-selection card *and* the later
newsletter-action card — they arrive as separate runs of the same HTTP trigger):

1. **Trigger** — "When a HTTP request is received", body schema:
   ```json
   { "type": "object", "properties": { "adaptiveCard": { "type": "object" } } }
   ```
2. **Post adaptive card and wait for a response** — Message field bound to
   `triggerBody()?['adaptiveCard']` (forwards whichever card arrived, unchanged).
3. **Parse JSON** on the response, schema (covers both card shapes in one go):
   ```json
   {
     "type": "object",
     "properties": {
       "submitActionId": { "type": "string" },
       "responder": {
         "type": "object",
         "properties": { "displayName": { "type": "string" }, "email": { "type": "string" } }
       },
       "data": {
         "type": "object",
         "properties": {
           "action": { "type": "string" },
           "job_id": { "type": "string" },
           "newsletter_id": { "type": ["integer", "string"] },
           "selected_0": { "type": "string" }
           /* ... selected_1 through selected_24 ... */
         }
       }
     }
   }
   ```
4. **Condition** — left side (Expression tab):
   `body('Parse_JSON')?['data']?['newsletter_id']`, operator **is not equal to**,
   right side (Expression tab): `null`.
   (Don't use `empty()` here — `newsletter_id` can arrive as an Integer, and
   `empty()` only accepts objects/arrays/strings and throws on a number.)
5. **"Yes" branch** (newsletter action) — HTTP POST to
   `.../api/webhook/google-news/response`:
   ```
   json(concat('{"action":"', body('Parse_JSON')?['data']?['action'], '","newsletter_id":"', body('Parse_JSON')?['data']?['newsletter_id'], '"}'))
   ```
   (built via `concat()` + `json()` rather than inline `@{}` tokens in the body
   text box — the latter is fragile when a field's resolved type/emptiness varies.)
6. **"No" branch** (topic approval) — HTTP POST, same URL, existing body shape
   referencing `data.action`, `data.job_id`, `data.selected_0` … `data.selected_24`.

`NEWSLETTER_ACTIONS_WEBHOOK_URL` can be left unset — it falls back to `WEBHOOK_URL`,
i.e. this same Flow B trigger — since Flow B now branches on both shapes itself.

## Environment variables

```bash
# Database
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=scraper_db
DB_USER=postgres
DB_PASSWORD=...

# Power Automate / Teams
WEBHOOK_URL=                     # Flow B's HTTP trigger URL
NEWSLETTER_ACTIONS_WEBHOOK_URL=  # optional override; falls back to WEBHOOK_URL
FRONTEND_URL=http://localhost:5173   # used for the card's "Edit in App" link
BACKEND_URL=

# Mailchimp
MAILCHIMP_API_KEY=
MAILCHIMP_SERVER_PREFIX=         # optional — auto-derived from the key's suffix
MAILCHIMP_AUDIENCE_ID=           # optional — falls back to the account's first audience
MAILCHIMP_FROM_NAME=TrendSense Newsletter
MAILCHIMP_FROM_EMAIL=            # required — no fallback; must be a verified sender

# LLM provider (Anthropic/OpenAI/Gemini keys are configured via the app's
# "LLM Configuration" page and stored in the llm_provider_config DB table —
# NOT env vars. The pipeline reads whichever provider is marked is_active there.)
```

Scraper API keys (Apify, ScrapingBee, etc.) are documented inline in `core/config.py`.

## API endpoints

| Method & Path | Purpose |
|---|---|
| `POST /api/webhook/google-news/auto-scrape` | Scheduled trigger: scrape all Google News keywords, kick off the pipeline |
| `POST /api/webhook/google-news/response` | Power Automate → backend: topic approval **or** newsletter draft/send action |
| `POST /api/webhook/newsletter/action` | Same as above, dedicated to the newsletter-action shape only |
| `GET /api/newsletter/jobs`, `/api/newsletter/pending` | List job history / jobs awaiting approval |
| `GET /api/newsletters`, `/api/newsletters/{id}` | List / fetch generated newsletters |
| `PUT /api/newsletters/{id}` | Edit a newsletter's title/content |
| `DELETE /api/newsletters/{id}` | Delete a newsletter |
| `GET /api/mailchimp/config` | Whether Mailchimp is configured, current defaults |
| `POST /api/mailchimp/test` | Ping Mailchimp with the configured key |
| `GET /api/mailchimp/audiences` | List Mailchimp audiences |
| `POST /api/newsletters/{id}/mailchimp/send` | Create + send a campaign now |
| `POST /api/newsletters/{id}/mailchimp/schedule` | Create + schedule a campaign |
| `POST /api/newsletters/{id}/mailchimp/draft` | Create a campaign draft only |
| `GET /api/newsletters/{id}/mailchimp/report` | Opens/clicks/bounces for a sent campaign |

## Database models

`backend/infrastructure/database/models/newsletter.py`:

- **`newsletter_jobs`** — one row per scrape-and-approve cycle. `raw_articles_json`
  is the exact article list shown/indexed on the Teams card (see pipeline step 2 —
  this must stay index-aligned with the card). `selected_articles_json` records
  which articles the reviewer actually picked, for audit/debugging.
- **`generated_newsletters`** — one row per newsletter (one per selected article).
  `content_json` holds the full LLM output (paragraphs, subject/preview, image);
  `mailchimp_campaign_id` / `mailchimp_status` / `mailchimp_sent_at` /
  `mailchimp_web_id` track its Mailchimp lifecycle once drafted/sent.

`backend/infrastructure/database/models/llm.py`:

- **`llm_provider_config`** — the active LLM provider/model/API key used for
  newsletter generation (and other LLM features). Exactly one row should have
  `is_active = true`. **This is the #1 thing to check if newsletter generation
  silently produces zero newsletters.**

## Running locally

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# requires DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in backend/.env to persist anything

# Frontend
cd frontend
npm install
npm run dev
```

## Known gotchas / troubleshooting

- **Newsletter generation reports "completed" but creates nothing**: check the
  backend logs for the actual per-article error (`_generate_newsletters` logs and
  continues past per-article failures) — common causes are an invalid/expired key
  in **LLM Configuration**, or a code exception in the generation step itself. As
  of this pipeline, generating **zero** newsletters from a non-empty selection now
  raises and marks the job `failed` with a descriptive `error`, instead of silently
  reporting `completed`.
- **Wrong articles get saved after approval**: this was a real bug — the Teams
  card was built from a sorted/capped article list, but the job's
  `raw_articles_json` stored the original unsorted/uncapped list, so the
  `selected_<i>` indices from the card didn't line up with what got filtered.
  Fixed by storing the exact same sorted/capped list the card was built from.
- **The Power Automate `Condition` step errors with `'empty' expects... Integer`**:
  don't use `empty(...)` on `newsletter_id` — it can arrive as a real integer, and
  `empty()` only accepts strings/arrays/objects. Compare directly to `null` instead
  (see [Power Automate flow setup](#power-automate-flow-setup) above).
- **Mailchimp send fails with "Sender email is required"**: `MAILCHIMP_FROM_EMAIL`
  has no fallback and must be set to a verified sender in your Mailchimp account.

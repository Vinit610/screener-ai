# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Three loosely-coupled components share `supabase/` as the source of truth:

- `backend/` — FastAPI service (Python 3.12, `uv`). Mounts routers under `/api/{stocks,mf,ai,portfolio,auth,compare}` from `backend/main.py`. Deployed to Railway (`Procfile`).
- `frontend/` — Next.js 16.2 + React 19 + Tailwind v4 (pnpm). App Router under `src/app`, zustand stores in `src/store`. Deployed to Vercel.
- `pipeline/` — Two pipelines that hydrate Supabase:
  - Python fetchers (`fetch_prices.py`, `fetch_mf_navs.py`, `fetch_mf_details.py`, `fetch_news.py`, `fetch_fundamentals.py`) → run by `.github/workflows/daily_pipeline.yml`.
  - Node AI analysis generator (`pipeline/analysis/generate_analyses.mjs`) → run by `.github/workflows/generate_analyses.yml`. Both crons fire Mon–Fri at 10:00 UTC (3:30 PM IST).
- `supabase/migrations/` — schema. RLS is enabled on user-scoped tables (`paper_portfolio`, `paper_trades`, etc.); always preserve `auth.uid() = user_id` policies when adding tables.

## Common commands

Backend (run from `backend/`):
```bash
uv sync                                 # install (Python 3.12 required)
uv run uvicorn main:app --reload        # dev server on :8000
uv run pytest                           # all tests
uv run pytest tests/test_phase5.py::TestRollingReturn -v   # single test
```

Frontend (run from `frontend/`):
```bash
pnpm install
pnpm dev                                # :3000
pnpm build && pnpm start
pnpm lint
```

Pipeline (run from `pipeline/`):
```bash
pip install -r requirements.txt         # Python fetchers
python fetch_prices.py                  # one fetcher at a time
cd analysis && npm ci && npm run generate   # Node AI analyses
```

Integration smoke test for the Indian Stock API: `node test_indian_api_integration.mjs` from repo root.

## Environment variables — name-prefix matters

Two distinct env conventions; mixing them silently breaks the pipeline:

- **Backend** (`backend/config.py`, pydantic-settings): unprefixed — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `GEMINI_API_KEY`, `ALLOWED_ORIGINS`.
- **Pipeline** (`pipeline/config.py`): `PIPELINE_`-prefixed — `PIPELINE_SUPABASE_URL`, `PIPELINE_SUPABASE_SERVICE_ROLE_KEY` (plus the unprefixed Redis/Gemini keys). The GitHub Actions secrets map `SUPABASE_*` → `PIPELINE_SUPABASE_*` at job level.
- **Frontend**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon only — never service role), `NEXT_PUBLIC_BACKEND_URL`.

`.env.example` at repo root lists the full set.

## Architectural conventions worth knowing before editing

- **Stock symbols are stored stripped of `.NS` / `.BO`.** `pipeline/data_processor.py:clean_symbol` is applied before insert; `pipeline/db.py:get_stock_id(symbol)` expects an already-cleaned symbol. Re-appending `.NS` is a known footgun (see `CODE_AUDIT_SUMMARY.md`).
- **Supabase upserts are batched** via `pipeline/db.py:_batched_upsert` (size 500) to dodge payload limits — use the existing `upsert_*` helpers rather than calling `.upsert()` directly.
- **Redis is best-effort.** `backend/cache.py` silently disables itself if `UPSTASH_REDIS_REST_URL` is an HTTP REST URL or the ping fails — every callsite must tolerate `get_cache` returning `None`.
- **Auth gating lives in `frontend/middleware.ts`,** not in pages. Protected prefixes: `/portfolio`, `/paper-trading`, `/onboarding`. Logged-in users hitting `/auth/login` or `/auth/signup` bounce to `/screener`. Add new protected routes to `PROTECTED_ROUTES` there, not via per-page checks.
- **Backend → frontend URL resolution** auto-upgrades `http://` to `https://` when the page is HTTPS (`frontend/src/lib/api.ts:getBackendUrl`). Use `getBackendUrl()`, not the deprecated `BACKEND_URL` constant.
- **AI service** (`backend/services/ai_service.py`) uses Gemini 2.5 Flash and streams via SSE for stock explanations, comparisons, and chat. NL-to-filter parsing has a strict allow-list of filter keys — `validate_filter_output` strips hallucinated keys; keep that list in sync if you add new screener filters.
- **Regulatory framing:** AI outputs are positioned as educational, never advisory. No "Buy/Sell" verbiage in prompts or UI copy (see `REQUIREMENTS.md`).

## Frontend Next.js note

`frontend/AGENTS.md` (referenced by `frontend/CLAUDE.md`) flags that Next.js 16.2 has breaking changes vs. older training data. Before writing Next.js-specific code (App Router APIs, caching directives, route handlers, middleware), consult `frontend/node_modules/next/dist/docs/` rather than relying on memory.

## Project docs to consult

- `REQUIREMENTS.md` — product vision, MVP scope, AI feature list.
- `DESIGN.md` — detailed system design (52 KB; skim for the area you're touching).
- `TASKS.md` — phased build plan; phase numbers (P4.3, Phase 5, Phase 7) appear in test filenames and commit history.
- `CODE_AUDIT_SUMMARY.md` — record of pipeline bugs already fixed; useful prior art when debugging fetchers.

# screener-ai — Master Task List

> AI-first hybrid screener for self-directed Indian retail investors.  
> Stack: Python/FastAPI · Next.js · Supabase · Railway · Vercel · Gemini Flash 2.0  
> This document is the **single source of truth** for building the product end-to-end.  
> Work through tasks in order. Each task is designed to be completable in one AI-assisted session.

---

## Key Decisions & Assumptions

| Decision | Choice |
|---|---|
| Paper trading | ✅ **Included in MVP** (Month 3) |
| Testing framework | **pytest** (backend only) |
| Frontend package manager | `pnpm` |
| Python environment | `uv` |
| TypeScript | Strict mode throughout |
| UI theme | Dark mode only (MVP) |
| LLM | Gemini Flash 2.0 (`gemini-2.0-flash`) |
| Scraping target | Screener.in — Nifty 500 (Tier 1), weekly Sundays |
| Supabase account | ✅ Already created |
| Railway account | ✅ Already created |
| Gemini API key | ✅ Already obtained |
| Upstash account | ⬜ Needs creation |
| Vercel account | ⬜ Needs creation |

---

## How to Use This Document

- Mark tasks done: change `- [ ]` to `- [x]`
- Each task has a unique ID (e.g. `SETUP-01`) for reference in commit messages
- Tasks within a phase can sometimes be parallelised — prerequisites are noted explicitly
- "🔑 Critical path" tasks are the ones that unblock everything else — do these first

---

## Phase 0 — Repository & Remaining Account Setup

> **Goal:** Monorepo structure created, all services provisioned, every env var known. Nothing works yet — that's fine.

### P0.1 — Repository Structure

- [x] **SETUP-01** 🔑 Create GitHub repository `screener-ai` (private). Initialize with `README.md` and clone locally.

- [x] **SETUP-02** Create the monorepo folder structure by running:
  ```bash
  mkdir -p backend/routers backend/services backend/tests
  mkdir -p frontend/src
  mkdir -p pipeline
  mkdir -p supabase/migrations
  mkdir -p .github/workflows
  ```
  Final structure:
  ```
  screener-ai/
  ├── backend/           ← FastAPI app
  │   ├── routers/
  │   ├── services/
  │   └── tests/
  ├── frontend/          ← Next.js app (bootstrapped later)
  ├── pipeline/          ← Nightly data ingestion scripts
  ├── supabase/
  │   └── migrations/    ← SQL files, run in order
  ├── .github/
  │   └── workflows/     ← GitHub Actions YAMLs
  └── .env.example
  ```

- [x] **SETUP-03** Create `.env.example` at repo root:
  ```dotenv
  # ── Supabase ──────────────────────────────────────────
  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=          # Never expose to frontend

  # ── Upstash Redis ─────────────────────────────────────
  UPSTASH_REDIS_REST_URL=
  UPSTASH_REDIS_REST_TOKEN=

  # ── Gemini ────────────────────────────────────────────
  GEMINI_API_KEY=

  # ── Backend (FastAPI on Railway) ───────────────────────
  BACKEND_URL=http://localhost:8000
  ALLOWED_ORIGINS=http://localhost:3000

  # ── Frontend (Next.js on Vercel) ───────────────────────
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=      # Anon key only — safe to expose
  NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
  ```

- [x] **SETUP-04** Create root `.gitignore` covering:
  - Python: `__pycache__/`, `.venv/`, `*.pyc`, `.pytest_cache/`, `*.egg-info/`
  - Node: `node_modules/`, `.next/`, `dist/`
  - Env: `.env`, `.env.local`, `.env.*.local`
  - IDE: `.idea/`, `.vscode/`, `*.DS_Store`

### P0.2 — Remaining Services

- [x] **SETUP-05** **Upstash:** Create account at upstash.com → Create Redis database → Choose region closest to Railway deployment. Copy REST URL and REST token into your local `.env`.

- [x] **SETUP-06** **Vercel:** Create account at vercel.com → Import the GitHub repo → Set root directory to `/frontend`. Do **not** deploy yet — frontend isn't built. Just connect the repo.

- [x] **SETUP-07** Collect all real values and create `backend/.env` and `pipeline/.env` (both gitignored) from `.env.example`. You should now have every secret filled in.

---

## Phase 1 — Database Schema (Supabase)

> **Goal:** All 8 tables exist in Supabase with indexes, RLS, and the new-user trigger. Data can be inserted and queried. This is the foundation everything else builds on.

### P1.1 — Core Schema Migration

- [x] **DB-01** 🔑 Create `supabase/migrations/001_initial_schema.sql`. Open the Supabase SQL editor and run this file. It must contain all of the following in order:

  **`stocks` table:**
  ```sql
  CREATE TABLE stocks (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol        TEXT NOT NULL UNIQUE,
      exchange      TEXT NOT NULL CHECK (exchange IN ('NSE', 'BSE')),
      name          TEXT NOT NULL,
      sector        TEXT,
      industry      TEXT,
      market_cap_cr FLOAT,
      nse_listed    BOOLEAN DEFAULT false,
      bse_listed    BOOLEAN DEFAULT false,
      is_active     BOOLEAN DEFAULT true,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
  );
  ```

  **`stock_fundamentals` table** (note the computed `graham_number` column):
  ```sql
  CREATE TABLE stock_fundamentals (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      stock_id         UUID REFERENCES stocks(id) ON DELETE CASCADE,
      pe               FLOAT,
      pb               FLOAT,
      roe              FLOAT,
      roce             FLOAT,
      debt_to_equity   FLOAT,
      net_margin       FLOAT,
      operating_margin FLOAT,
      revenue_cr       FLOAT,
      net_profit_cr    FLOAT,
      eps              FLOAT,
      dividend_yield   FLOAT,
      book_value       FLOAT,
      graham_number    FLOAT GENERATED ALWAYS AS (
                           SQRT(22.5 * NULLIF(eps, 0) * NULLIF(book_value, 0))
                       ) STORED,
      scraped_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(stock_id)
  );
  ```

  **`stock_prices` table:**
  ```sql
  CREATE TABLE stock_prices (
      id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      stock_id UUID REFERENCES stocks(id) ON DELETE CASCADE,
      date     DATE NOT NULL,
      open     FLOAT,
      high     FLOAT,
      low      FLOAT,
      close    FLOAT NOT NULL,
      volume   BIGINT,
      UNIQUE(stock_id, date)
  );
  ```

  **`mutual_funds` table:**
  ```sql
  CREATE TABLE mutual_funds (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scheme_code   TEXT NOT NULL UNIQUE,
      scheme_name   TEXT NOT NULL,
      fund_house    TEXT NOT NULL,
      category      TEXT,
      sub_category  TEXT,
      expense_ratio FLOAT,
      aum_cr        FLOAT,
      benchmark     TEXT,
      is_direct     BOOLEAN DEFAULT false,
      is_growth     BOOLEAN DEFAULT true,
      is_active     BOOLEAN DEFAULT true,
      updated_at    TIMESTAMPTZ DEFAULT NOW()
  );
  ```

  **`mf_navs` table:**
  ```sql
  CREATE TABLE mf_navs (
      id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      fund_id UUID REFERENCES mutual_funds(id) ON DELETE CASCADE,
      date    DATE NOT NULL,
      nav     FLOAT NOT NULL,
      UNIQUE(fund_id, date)
  );
  ```

  **`news` table:**
  ```sql
  CREATE TABLE news (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      headline        TEXT NOT NULL,
      summary         TEXT,
      url             TEXT UNIQUE,
      source          TEXT,
      published_at    TIMESTAMPTZ,
      sentiment       TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral')),
      sentiment_score FLOAT CHECK (sentiment_score BETWEEN -1.0 AND 1.0),
      related_symbols TEXT[],
      processed_at    TIMESTAMPTZ DEFAULT NOW()
  );
  ```

  **`portfolio_holdings` table** (includes paper trading support via `is_paper` flag):
  ```sql
  CREATE TABLE portfolio_holdings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      symbol          TEXT NOT NULL,
      instrument_type TEXT CHECK (instrument_type IN ('stock', 'mf')),
      quantity        FLOAT NOT NULL,
      avg_buy_price   FLOAT NOT NULL,
      current_value   FLOAT,
      unrealised_pnl  FLOAT GENERATED ALWAYS AS (
                          current_value - (quantity * avg_buy_price)
                      ) STORED,
      buy_date        DATE,
      broker          TEXT CHECK (broker IN ('zerodha', 'groww', 'upstox', 'other')),
      is_paper        BOOLEAN DEFAULT false,   -- true = virtual/paper trade
      created_at      TIMESTAMPTZ DEFAULT NOW()
  );
  ```

  **`user_profiles` table:**
  ```sql
  CREATE TABLE user_profiles (
      id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      investment_style TEXT CHECK (investment_style IN ('value', 'growth', 'dividend')),
      onboarding_done  BOOLEAN DEFAULT false,
      created_at       TIMESTAMPTZ DEFAULT NOW()
  );
  ```

- [x] **DB-02** Add all indexes (append to `001_initial_schema.sql` or run separately):
  ```sql
  CREATE INDEX idx_stocks_symbol   ON stocks(symbol);
  CREATE INDEX idx_stocks_sector   ON stocks(sector);
  CREATE INDEX idx_stocks_active   ON stocks(is_active) WHERE is_active = true;
  CREATE INDEX idx_prices_stock_date ON stock_prices(stock_id, date DESC);
  CREATE INDEX idx_mf_navs_fund_date ON mf_navs(fund_id, date DESC);
  CREATE INDEX idx_news_symbols    ON news USING GIN(related_symbols);
  CREATE INDEX idx_news_published  ON news(published_at DESC);
  CREATE INDEX idx_portfolio_user  ON portfolio_holdings(user_id);
  ```

### P1.2 — Row Level Security

- [x] **DB-03** Enable RLS and add policies for `portfolio_holdings`:
  ```sql
  ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users see own holdings"
      ON portfolio_holdings FOR ALL
      USING (auth.uid() = user_id);
  ```

- [x] **DB-04** Enable RLS and add policies for `user_profiles`:
  ```sql
  ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users see own profile"
      ON user_profiles FOR ALL
      USING (auth.uid() = id);
  ```

### P1.3 — Auth Trigger

- [ ] **DB-05** 🔑 Create the new-user trigger (run in SQL editor):
  ```sql
  CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS TRIGGER AS $$
  BEGIN
      INSERT INTO user_profiles (id) VALUES (NEW.id)
      ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  ```

- [ ] **DB-06** Test the trigger: In the Supabase dashboard go to Authentication → Users → Add user manually. Then check the `user_profiles` table — a matching row should appear automatically.

### P1.4 — Seed Data for Development

- [x] **DB-07** Create `supabase/migrations/002_dev_seed.sql` with:
  - 10 rows in `stocks` (mix of sectors: IT, Banking, FMCG, Pharma, Auto)
  - 10 corresponding rows in `stock_fundamentals` with varied PE/ROE/D:E values
  - 5 rows in `mutual_funds` (Large Cap, ELSS, Flexi Cap)
  - Use real ticker symbols (e.g., RELIANCE, INFY, TCS, HDFCBANK, ASIANPAINT)
  - **Run only in dev Supabase project, never production**

- [x] **DB-08** Run `002_dev_seed.sql` in your dev Supabase project. Verify data in Table Editor.

---

## Phase 2 — Backend Skeleton (FastAPI)

> **Goal:** FastAPI app runs locally and on Railway. `/health` returns 200. All routers registered. Supabase and Redis connections verified.

### P2.1 — Python Project Initialization

- [x] **BE-01** 🔑 Initialize the backend project:
  ```bash
  cd backend
  uv init
  uv add fastapi "uvicorn[standard]" supabase upstash-redis httpx \
         "pydantic-settings" python-dotenv google-generativeai \
         pandas yfinance requests beautifulsoup4 lxml python-multipart
  uv add --dev pytest pytest-asyncio httpx
  ```

- [x] **BE-02** Create `backend/config.py` using `pydantic-settings`. All env vars must be validated at startup — the app must crash immediately with a clear error if any required var is missing:
  ```python
  from pydantic_settings import BaseSettings

  class Settings(BaseSettings):
      supabase_url: str
      supabase_anon_key: str
      supabase_service_role_key: str
      upstash_redis_rest_url: str
      upstash_redis_rest_token: str
      gemini_api_key: str
      allowed_origins: str = "http://localhost:3000"

      class Config:
          env_file = ".env"

  settings = Settings()
  ```

- [x] **BE-03** Create `backend/database.py` — Supabase client singleton using the `service_role` key:
  ```python
  from supabase import create_client, Client
  from config import settings

  _client: Client | None = None

  def get_db() -> Client:
      global _client
      if _client is None:
          _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
      return _client
  ```

- [x] **BE-04** Create `backend/cache.py` — Upstash Redis client with typed helpers:
  ```python
  import json
  from upstash_redis import Redis
  from config import settings

  redis = Redis(url=settings.upstash_redis_rest_url, token=settings.upstash_redis_rest_token)

  async def cache_get(key: str) -> dict | None:
      val = redis.get(key)
      return json.loads(val) if val else None

  async def cache_set(key: str, value: dict, ttl_seconds: int = 1800) -> None:
      redis.setex(key, ttl_seconds, json.dumps(value))
  ```

### P2.2 — FastAPI App Entry Point

- [x] **BE-05** 🔑 Create `backend/main.py`:
  ```python
  from fastapi import FastAPI
  from fastapi.middleware.cors import CORSMiddleware
  from config import settings
  from routers import stocks, mf, ai, portfolio, auth

  app = FastAPI(title="screener-ai", version="0.1.0")

  app.add_middleware(
      CORSMiddleware,
      allow_origins=settings.allowed_origins.split(","),
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )

  app.include_router(stocks.router, prefix="/api/stocks")
  app.include_router(mf.router, prefix="/api/mf")
  app.include_router(ai.router, prefix="/api/ai")
  app.include_router(portfolio.router, prefix="/api/portfolio")
  app.include_router(auth.router, prefix="/api/auth")

  @app.get("/health")
  def health():
      return {"status": "ok", "version": "0.1.0"}
  ```

### P2.3 — Router Stubs

Create the following files. Each returns a placeholder response so Railway deployment succeeds:

- [x] **BE-06** `backend/routers/stocks.py` — prefix `/api/stocks`, placeholder `GET /`
- [x] **BE-07** `backend/routers/mf.py` — prefix `/api/mf`, placeholder `GET /`
- [x] **BE-08** `backend/routers/ai.py` — prefix `/api/ai`, placeholder `GET /`
- [x] **BE-09** `backend/routers/portfolio.py` — prefix `/api/portfolio`, placeholder `GET /`
- [x] **BE-10** `backend/routers/auth.py` — prefix `/api/auth`, placeholder `GET /`

### P2.4 — Railway Deployment

- [x] **BE-11** Create `backend/Procfile`:
  ```
  web: uvicorn main:app --host 0.0.0.0 --port $PORT
  ```

- [x] **BE-12** Add all environment variables to the Railway project dashboard (Settings → Variables). Copy from your local `backend/.env`.

- [x] **BE-13** Push to `main`. Watch Railway deploy. Hit `https://<your-railway-url>/health` — confirm `{"status": "ok", "version": "0.1.0"}`.

- [x] **BE-14** In Railway settings → Networking: ensure "Sleep on inactivity" is **disabled**. SSE streaming connections require a persistent server.

- [ ] **BE-15** Copy the Railway production URL. Update `NEXT_PUBLIC_BACKEND_URL` in Vercel env vars (you'll add this properly in Phase 3).

---

## Phase 3 — Frontend Skeleton (Next.js)

> **Goal:** Next.js app runs locally and is deployed on Vercel. Dark mode works. All page routes exist. Zustand stores are wired.

### P3.1 — Project Initialization

- [x] **FE-01** 🔑 Bootstrap Next.js inside `/frontend`:
  ```bash
  pnpm create next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*"
  ```
  Answer prompts: Use App Router = Yes, src/ dir = Yes.

- [x] **FE-02** Install additional dependencies:
  ```bash
  pnpm add @supabase/supabase-js @supabase/ssr zustand recharts lucide-react clsx
  ```

- [x] **FE-03** Configure `tailwind.config.ts`:
  - Set `darkMode: 'class'`
  - Extend theme with custom colors:
    ```ts
    colors: {
      background: '#0a0a0a',
      surface: '#111111',
      border: '#222222',
      muted: '#888888',
      accent: '#22c55e',      // positive returns
      danger: '#ef4444',      // negative returns
      primary: '#3b82f6',     // interactive elements
    }
    ```

- [x] **FE-04** Update `app/layout.tsx`:
  - Add `dark` class to `<html>` element (dark mode always on)
  - Add Inter font via `next/font/google`
  - Add a global disclaimer bar at the very top: `"All AI outputs are educational insights only, not investment advice."`
  - Set `<body>` background to `bg-background text-white`

- [x] **FE-05** Create `frontend/.env.local` from `.env.example`. Fill in Supabase anon key and Railway backend URL.

### P3.2 — Page Routes

Create all page route files. Each should return a styled placeholder `<div>` with the page name — this lets Vercel deploy successfully:

- [x] **FE-06** `app/page.tsx` — Landing page with product name, tagline, and "→ Open Screener" button
- [x] **FE-07** `app/screener/page.tsx` — Placeholder: "Screener (coming soon)"
- [x] **FE-08** `app/mf/page.tsx` — Placeholder: "MF Screener (coming soon)"
- [x] **FE-09** `app/stock/[symbol]/page.tsx` — Placeholder showing `params.symbol`
- [x] **FE-10** `app/compare/page.tsx` — Placeholder
- [x] **FE-11** `app/portfolio/page.tsx` — Placeholder
- [x] **FE-12** `app/paper-trading/page.tsx` — Placeholder (paper trading, MVP)
- [x] **FE-13** `app/auth/login/page.tsx` — Placeholder
- [x] **FE-14** `app/auth/signup/page.tsx` — Placeholder with onboarding note

### P3.3 — Supabase Client Helpers

- [x] **FE-15** Create `src/lib/supabase/client.ts`:
  ```typescript
  import { createBrowserClient } from '@supabase/ssr'

  export function createClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  ```

- [x] **FE-16** Create `src/lib/supabase/server.ts`:
  ```typescript
  import { createServerClient } from '@supabase/ssr'
  import { cookies } from 'next/headers'

  export async function createClient() {
    const cookieStore = await cookies()

    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      }
    )
  }
  ```

- [x] **FE-17** Create `src/lib/supabase/middleware.ts` — Supabase auth session refresh middleware. Add it to `middleware.ts` at the frontend root so auth cookies are refreshed on every request.
    const cookieStore = cookies()
    return createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
  }
  ```

### P3.4 — Zustand Stores

- [x] **FE-18** Create `src/store/screenerStore.ts` with full `ScreenerState` interface as defined in Phase 0 assumptions. Key method: `mergeFilters` — takes a partial filter object and merges it into current state (used by the AI chat panel to update filters without resetting manual ones).

- [x] **FE-19** Create `src/store/chatStore.ts` with full `ChatState` interface. The `sendQuery` action must: (1) add the user message, (2) set `isAIThinking = true`, (3) POST to `/api/ai/parse-query`, (4) call `screenerStore.mergeFilters` with the result, (5) add the assistant's `filter_applied` message.

- [x] **FE-20** Create `src/store/userStore.ts` with user auth state and investment style.

### P3.5 — Type Definitions

- [x] **FE-21** Create `src/types/index.ts` with shared TypeScript interfaces:
  ```typescript
  export interface Stock { id: string; symbol: string; name: string; sector: string; market_cap_cr: number; /* ... */ }
  export interface StockFundamentals { pe: number; pb: number; roe: number; roce: number; debt_to_equity: number; net_margin: number; dividend_yield: number; graham_number: number; }
  export interface MutualFund { id: string; scheme_code: string; scheme_name: string; fund_house: string; category: string; expense_ratio: number; }
  export interface Filters { market_cap_category?: 'large'|'mid'|'small'|'micro'; min_pe?: number; max_pe?: number; min_roe?: number; max_roe?: number; max_debt_to_equity?: number; min_net_margin?: number; min_dividend_yield?: number; sector?: string; exclude_loss_making?: boolean; }
  export interface PortfolioHolding { id: string; symbol: string; instrument_type: 'stock'|'mf'; quantity: number; avg_buy_price: number; current_value: number; unrealised_pnl: number; is_paper: boolean; }
  ```

### P3.6 — Vercel Deployment

- [ ] **FE-22** Add environment variables to Vercel project settings:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_BACKEND_URL` (Railway URL from BE-15)

- [ ] **FE-23** Push to `main`. Verify Vercel deploys. Visit the Vercel URL — confirm dark background, disclaimer banner, and landing page render correctly.

---

## Phase 4 — Data Pipeline

> **Goal:** Real data flows nightly into Supabase via GitHub Actions. After this phase, the screener has live data to query even before the UI is complete.

### P4.1 — Pipeline Scaffolding

- [ ] **PIPE-01** Create `pipeline/requirements.txt`:
  ```
  yfinance==0.2.37
  pandas==2.2.0
  requests==2.31.0
  supabase==2.4.0
  google-generativeai==0.8.0
  beautifulsoup4==4.12.3
  lxml==5.1.0
  numpy==1.26.4
  ```

- [ ] **PIPE-02** Create `pipeline/config.py` — reads all env vars using `os.environ`. Clear error message if any required var is missing.

- [ ] **PIPE-03** Create `pipeline/db.py` — Supabase service-role client. Expose helper functions:
  - `upsert_stocks(records: list[dict])` — upsert into `stocks` on conflict `symbol`
  - `upsert_fundamentals(records: list[dict])` — upsert into `stock_fundamentals` on conflict `stock_id`
  - `upsert_prices(records: list[dict])` — upsert into `stock_prices` on conflict `(stock_id, date)`
  - `upsert_navs(records: list[dict])` — upsert into `mf_navs` on conflict `(fund_id, date)`
  - `upsert_news(records: list[dict])` — upsert into `news` on conflict `url`
  - `get_stock_id(symbol: str) -> str | None` — look up stock UUID by symbol

- [ ] **PIPE-04** Create `pipeline/data_processor.py` — shared data cleaning utilities:
  - `parse_float(val) -> float | None` — safely cast to float, return None on failure
  - `clean_symbol(sym: str) -> str` — strip `.NS` / `.BO` suffix, uppercase
  - `format_market_cap_category(market_cap_cr: float) -> str` — return `"large"/"mid"/"small"/"micro"` based on INR crore thresholds (>20,000 / 5,000–20,000 / 500–5,000 / <500)

- [ ] **PIPE-05** Create `pipeline/nifty500.txt` — one NSE symbol per line **with** `.NS` suffix, e.g.:
  ```
  RELIANCE.NS
  INFY.NS
  TCS.NS
  HDFCBANK.NS
  ...
  ```
  Populate from the official NSE Nifty 500 constituent list (download from nseindia.com).

### P4.2 — Stock Price Ingestion (`fetch_prices.py`)

- [ ] **PIPE-06** 🔑 Create `pipeline/fetch_prices.py`:

  **Logic:**
  1. Load symbols from `nifty500.txt`
  2. Ensure each stock exists in the `stocks` table (upsert with exchange=NSE, is_active=true). For initial load, use `yfinance.Ticker(sym).info` to get `shortName`, `sector`, `industry`, `marketCap`.
  3. Batch download EOD prices: `yf.download(batch, period="5d", group_by="ticker", auto_adjust=True)` in batches of 50 symbols.
  4. For each symbol/date row, map to `stock_prices` schema and upsert.
  5. Log: total symbols attempted, rows upserted, symbols failed (insufficient data).

  **Error handling:** If a symbol fails (delisted, bad data), log and continue — never crash the whole run.

- [ ] **PIPE-07** Test `fetch_prices.py` locally with a subset of 10 symbols:
  ```bash
  cd pipeline
  python fetch_prices.py --symbols RELIANCE.NS,INFY.NS,TCS.NS,HDFCBANK.NS,ASIANPAINT.NS
  ```
  Verify rows appear in `stock_prices` in Supabase Table Editor.

### P4.3 — Mutual Fund NAV Ingestion (`fetch_mf_navs.py`)

- [ ] **PIPE-08** 🔑 Create `pipeline/fetch_mf_navs.py`:

  **Logic:**
  1. `GET https://www.amfiindia.com/spages/NAVAll.txt`
  2. Parse: split by `\n`, keep lines with `≥5` semicolons, parse into DataFrame with columns: `scheme_code`, `isin_div`, `isin_growth`, `scheme_name`, `nav`, `date`
  3. Filter to Growth plans only (those with a valid ISIN in `isin_growth`)
  4. Upsert each fund into `mutual_funds` table. Try to extract `fund_house` from `scheme_name` prefix (everything before the first `-` or space pattern).
  5. Upsert today's NAV into `mf_navs` for each fund.
  6. Log: funds processed, NAVs upserted.

- [ ] **PIPE-09** Test `fetch_mf_navs.py` locally. Verify `mutual_funds` and `mf_navs` tables are populated.

### P4.4 — News Ingestion & Sentiment (`fetch_news.py`)

- [ ] **PIPE-10** Create `pipeline/fetch_news.py`:

  **RSS feeds to parse:**
  ```python
  RSS_FEEDS = [
      "https://www.moneycontrol.com/rss/marketreports.xml",
      "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
      "https://www.business-standard.com/rss/markets-106.rss",
  ]
  ```

  **Logic:**
  1. For each feed, parse with `feedparser` (add to requirements.txt). Extract: `title`, `summary`, `link` (= URL), `published`.
  2. Deduplicate against existing `news.url` — only process new articles.
  3. Batch new articles into groups of 25. For each batch, send to Gemini Flash with the sentiment prompt (see Design doc Section 4, Source 4).
  4. Parse JSON response. Upsert into `news` table with `sentiment`, `sentiment_score`, `related_symbols`.
  5. Rate limit: `asyncio.sleep(4)` between Gemini batches (15 RPM limit on free tier).

- [ ] **PIPE-11** Add `feedparser` to `pipeline/requirements.txt`.

- [ ] **PIPE-12** Test `fetch_news.py` locally. Verify articles appear in `news` table with sentiment scores. Spot-check 5 articles for sentiment accuracy.

### P4.5 — Fundamentals Scraper (`fetch_fundamentals.py`)

- [ ] **PIPE-13** 🔑 Create `pipeline/fetch_fundamentals.py` — Screener.in scraper for Tier 1 stocks (Nifty 500).

  **Logic:**
  1. Read Nifty 500 symbols from `nifty500.txt`. Strip `.NS` suffix.
  2. For each symbol, `GET https://www.screener.in/company/{symbol}/` with realistic headers and session.
  3. Parse HTML with BeautifulSoup: extract PE, PB, ROE, ROCE, D/E, Net Margin from `#top-ratios` section.
  4. Upsert into `stock_fundamentals` table.
  5. Sleep `random.uniform(3, 7)` seconds between requests. Extra `random.uniform(60, 120)` pause every 50 stocks.
  6. On HTTP 429: back off for `300 + random.uniform(0, 60)` seconds, then retry once.
  7. Log source as `"screener"` vs `"yfinance"` fallback.

  **Anti-detection headers:**
  ```python
  headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
      "Referer": "https://www.screener.in/",
  }
  ```

- [ ] **PIPE-14** Test `fetch_fundamentals.py` locally with 5 symbols. Verify fundamentals appear in `stock_fundamentals` with correct values.

### P4.6 — GitHub Actions Cron Workflows

- [ ] **PIPE-15** Create `.github/workflows/daily_pipeline.yml`:
  ```yaml
  name: Daily Data Pipeline
  on:
    schedule:
      - cron: '0 10 * * 1-5'    # 3:30 PM IST = 10:00 UTC, Mon–Fri only
    workflow_dispatch:             # Allow manual trigger from GitHub UI
  jobs:
    pipeline:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: '3.12' }
        - run: pip install -r pipeline/requirements.txt
        - run: python pipeline/fetch_prices.py
        - run: python pipeline/fetch_mf_navs.py
        - run: python pipeline/fetch_news.py
      env:
        SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
        SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  ```

- [ ] **PIPE-16** Create `.github/workflows/weekly_fundamentals.yml`:
  ```yaml
  name: Weekly Fundamentals Scrape
  on:
    schedule:
      - cron: '30 20 * * 0'    # Sunday 2:00 AM IST = Sunday 20:30 UTC
    workflow_dispatch:
  jobs:
    scrape:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: '3.12' }
        - run: pip install -r pipeline/requirements.txt
        - run: python pipeline/fetch_fundamentals.py
      env:
        SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
        SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
  ```

- [ ] **PIPE-17** Add all pipeline secrets to GitHub repository Settings → Secrets → Actions:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GEMINI_API_KEY`

- [ ] **PIPE-18** Trigger `daily_pipeline.yml` manually via GitHub UI (`workflow_dispatch`). Confirm it runs to completion. Check Supabase for new rows.

---

## Phase 5 — Screener API (Backend)

> **Goal:** `GET /api/stocks/screen` returns filtered, paginated stock results from Supabase with Redis caching. The screener works without AI.

### P5.1 — Stock Screener Endpoint

- [ ] **BE-16** 🔑 Implement `GET /api/stocks/screen` in `backend/routers/stocks.py`:

  **Query parameters:**
  ```python
  market_cap_category: str | None = None   # "large" | "mid" | "small" | "micro"
  min_pe: float | None = None
  max_pe: float | None = None
  min_pb: float | None = None
  max_pb: float | None = None
  min_roe: float | None = None
  max_roe: float | None = None
  min_roce: float | None = None
  max_roce: float | None = None
  max_debt_to_equity: float | None = None
  min_net_margin: float | None = None
  min_dividend_yield: float | None = None
  sector: str | None = None
  exclude_loss_making: bool = False
  sort_by: str = "market_cap_cr"
  sort_dir: str = "desc"
  page: int = 1
  limit: int = 50
  ```

  **Logic:**
  1. Build a cache key from all non-None filter params + sort + page: `f"screen:{hash(frozenset(locals().items()))}"`
  2. Check Upstash Redis. If hit, return cached result.
  3. Build dynamic Supabase query joining `stocks` with `stock_fundamentals`. Apply all non-None filters using `.gte()`, `.lte()`, `.eq()` etc.
  4. For `market_cap_category`: translate to crore ranges before querying.
  5. For `exclude_loss_making`: add `.gt("stock_fundamentals.net_profit_cr", 0)`.
  6. Apply sorting and pagination: `.order(sort_by, desc=(sort_dir == "desc")).range((page-1)*limit, page*limit-1)`.
  7. Execute query. Cache result for 30 minutes (`TTL=1800`).
  8. Return `{"data": [...], "total": <count>, "page": page, "limit": limit}`.

- [ ] **BE-17** Implement `GET /api/stocks/{symbol}` — full stock detail:
  - Join `stocks` + `stock_fundamentals` + latest `stock_prices` row.
  - Include last 365 days of prices (for chart).
  - Cache for 30 minutes per symbol.

- [ ] **BE-18** Implement `GET /api/stocks/{symbol}/news` — fetch news for a stock:
  - Query `news` where `symbol = ANY(related_symbols)`.
  - Return latest 20 articles, sorted by `published_at DESC`.
  - Cache for 15 minutes.

- [ ] **BE-19** Add input validation: create `backend/schemas/stock_schemas.py` with Pydantic models for all request/response shapes. Use these in the router function signatures.

### P5.2 — MF Screener Endpoint

- [ ] **BE-20** Implement `GET /api/mf/screen` in `backend/routers/mf.py`:

  **Query parameters:**
  ```python
  category: str | None = None          # "Large Cap" | "ELSS" | "Flexi Cap" | etc.
  fund_house: str | None = None
  max_expense_ratio: float | None = None
  min_aum_cr: float | None = None
  is_direct: bool | None = None
  sort_by: str = "aum_cr"
  sort_dir: str = "desc"
  page: int = 1
  limit: int = 50
  ```

  Query `mutual_funds` table with filters. Cache for 1 hour (MF data changes slowly).

- [ ] **BE-21** Implement `GET /api/mf/{scheme_code}` — full MF detail:
  - Return fund metadata + last 365 days of NAVs (for chart).
  - Compute rolling returns from NAV history: 1M, 3M, 6M, 1Y, 3Y returns.
  - Compute Sharpe ratio from NAV history (risk-free rate = 6.5%).
  - Cache per fund for 1 hour.

### P5.3 — Comparison Endpoint

- [ ] **BE-22** Implement `GET /api/compare` — structured diff (no AI yet):
  ```python
  # Query params: symbol_a, symbol_b (for stocks) OR scheme_code_a, scheme_code_b (for MFs)
  # Returns side-by-side metric data for both instruments
  ```
  Returns a structured JSON object with metrics for both instruments side by side. The AI narrative comes from a separate SSE endpoint in Phase 7.

---

## Phase 6 — Screener UI (Frontend)

> **Goal:** The two-panel screener renders with real data. Users can drag filter sliders and see results update. No AI yet.

### P6.1 — UI Component Library (Base)

- [ ] **FE-24** Create `src/components/ui/Badge.tsx` — small pill for labels (sector, sentiment):
  ```tsx
  interface BadgeProps { label: string; variant: 'sector'|'positive'|'negative'|'neutral'; }
  ```

- [ ] **FE-25** Create `src/components/ui/Metric.tsx` — key metric display tile:
  ```tsx
  interface MetricProps { label: string; value: string | number; color?: 'default'|'green'|'red'; }
  ```

- [ ] **FE-26** Create `src/components/ui/StreamingText.tsx` — progressively renders AI token stream:
  ```tsx
  // Shows a blinking cursor while isStreaming=true
  interface StreamingTextProps { text: string; isStreaming: boolean; }
  ```

- [ ] **FE-27** Create `src/components/ui/Skeleton.tsx` — loading skeleton for cards and table rows.

- [ ] **FE-28** Create `src/components/ui/SentimentBadge.tsx` — renders "Positive / Negative / Neutral" with colour coding and a score bar.

### P6.2 — Filter Panel

- [ ] **FE-29** 🔑 Create `src/components/screener/FilterSlider.tsx` — a range slider with:
  - Min/Max number inputs (typed override)
  - Debounced onChange (300ms) to avoid excessive API calls while dragging
  - Label + current range display
  - Props: `label`, `min`, `max`, `step`, `value: [number, number]`, `onChange`

- [ ] **FE-30** Create `src/components/screener/FilterSection.tsx` — collapsible section wrapper:
  - Toggle open/closed state
  - Props: `title`, `defaultOpen?: boolean`, `children`
  - Sections to use: "Valuation", "Quality", "Size", "Returns", "Sector"

- [ ] **FE-31** Create `src/components/screener/FilterPanel.tsx` — full filter panel using `FilterSection` and `FilterSlider`:
  - Reads from `screenerStore.filters`
  - Calls `screenerStore.setFilters()` on change
  - Sections:
    - **Size:** Market Cap Category (radio buttons: Large / Mid / Small / Micro)
    - **Sector:** Dropdown with all valid sectors
    - **Valuation:** PE range, PB range
    - **Quality:** ROE range, ROCE range, D/E max, Net Margin min
    - **Income:** Dividend Yield min
    - **Other:** "Exclude loss-making companies" toggle
  - "Reset Filters" button at bottom

### P6.3 — Results Table

- [ ] **FE-32** Create `src/components/screener/StockCard.tsx` — THE core reusable unit. Must support three variants via a `variant` prop:
  - `"table-row"` — compact, for screener results
  - `"chat-embed"` — medium, for chat panel responses
  - `"detail"` — full, for stock detail page

  **All variants show:**
  - Symbol + Name + Sector badge
  - 5 metric pills: PE, ROE, D/E, Market Cap, 1Y Return
  - AI explanation area (empty placeholder for now — filled in Phase 7)
  - Disclaimer line in small muted text

- [ ] **FE-33** Create `src/components/screener/ResultsTable.tsx`:
  - Reads `screenerStore.results` and `screenerStore.isLoading`
  - Renders `<StockCard variant="table-row" />` for each result
  - Shows `<Skeleton />` rows while loading
  - Pagination controls at bottom (previous / next / page number)
  - Empty state: "No stocks match your filters. Try relaxing the criteria."
  - On mount, calls `screenerStore.fetchResults()`

- [ ] **FE-34** Wire `screenerStore.fetchResults()` to actually call `GET /api/stocks/screen` with current filter state. Whenever `filters` or `page` changes, re-fetch (use Zustand `subscribe` or `useEffect` watching the store).

### P6.4 — Two-Panel Layout

- [ ] **FE-35** 🔑 Create `src/components/screener/ScreenerLayout.tsx` — the two-panel shell:
  - **Desktop (≥768px):** Side by side — `FilterPanel + ResultsTable` (60%) | `ChatPanel` placeholder (40%)
  - **Mobile (<768px):** Bottom tab bar switching between "Screener" and "Chat" views
  - `ChatPanel` is an empty placeholder div for now (filled in Phase 7)

- [ ] **FE-36** Wire `app/screener/page.tsx` to render `<ScreenerLayout />`. Remove the placeholder text.

- [ ] **FE-37** Manually test the full filter → fetch → render flow:
  1. Visit `/screener`
  2. The results table loads with default sort (market_cap_cr desc)
  3. Change sector to "IT" — results update
  4. Set min ROE to 15 — results filter further
  5. Pagination works

---

## Phase 7 — AI Layer (Backend)

> **Goal:** NL→filter parsing works. Stock card AI explanations stream via SSE. Comparison narrative streams. Sentiment pipeline runs.

### P7.1 — Gemini Client Setup

- [ ] **BE-23** Create `backend/services/ai_service.py` — Gemini Flash client singleton:
  ```python
  import google.generativeai as genai
  from config import settings

  genai.configure(api_key=settings.gemini_api_key)
  model = genai.GenerativeModel("gemini-2.0-flash")
  ```
  All four AI functions live in this file.

### P7.2 — NL → Filter Translation

- [ ] **BE-24** 🔑 Implement `parse_natural_language_query(query: str) -> dict` in `ai_service.py`:
  - Uses the full `NL_TO_FILTER_PROMPT` from the Design doc (Section 6, Feature 1)
  - Calls Gemini with `generation_config={"response_mime_type": "application/json"}`
  - Returns parsed filter dict

- [ ] **BE-25** Implement `validate_filter_output(raw: dict) -> dict` — strips any keys not in `VALID_FILTER_KEYS`, validates sector against `VALID_SECTORS`, validates `market_cap_category`. Never raises — silently drops invalid keys.

- [ ] **BE-26** Implement `POST /api/ai/parse-query` in `backend/routers/ai.py`:
  ```python
  class ParseQueryRequest(BaseModel):
      query: str

  @router.post("/parse-query")
  async def parse_query(req: ParseQueryRequest):
      cache_key = f"nl_query:{hash(req.query.lower().strip())}"
      cached = await cache_get(cache_key)
      if cached:
          return cached
      raw = await ai_service.parse_natural_language_query(req.query)
      validated = ai_service.validate_filter_output(raw)
      await cache_set(cache_key, validated, ttl_seconds=3600)  # 1 hour cache
      return validated
  ```

- [ ] **BE-27** Test NL→filter with 10 different queries (in pytest — see Testing phase). Spot-check that edge cases return `{}` rather than crashing.

### P7.3 — Stock Card AI Explanation (SSE Streaming)

- [ ] **BE-28** 🔑 Implement `stream_stock_explanation(symbol, investment_style, fundamentals)` in `ai_service.py`:
  - Uses the three style-specific prompts from Design doc Section 6, Feature 2
  - Streams tokens via `model.generate_content(prompt, stream=True)`
  - Yields `f"data: {json.dumps({'token': chunk.text})}\n\n"` for each chunk
  - Yields `"data: [DONE]\n\n"` at end

- [ ] **BE-29** Implement `POST /api/ai/explain-stock` in `backend/routers/ai.py`:
  ```python
  class ExplainRequest(BaseModel):
      symbol: str
      investment_style: str = "value"   # default for unauthenticated users

  @router.post("/explain-stock")
  async def explain_stock(req: ExplainRequest):
      fundamentals = # ... fetch from Supabase
      stream = ai_service.stream_stock_explanation(req.symbol, req.investment_style, fundamentals)
      return StreamingResponse(stream, media_type="text/event-stream",
                               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
  ```

### P7.4 — Comparison Narrative (SSE Streaming)

- [ ] **BE-30** Implement `stream_comparison(symbol_a, symbol_b, investment_style)` in `ai_service.py`:
  - Uses `COMPARISON_PROMPT` from Design doc Section 6, Feature 3
  - First yields a `{"type": "structured", "data": {...}}` event with the winner JSON
  - Then yields `{"type": "token", "text": "..."}` events for the narrative
  - Yields `{"type": "done"}` at end

- [ ] **BE-31** Implement `POST /api/ai/compare` in `backend/routers/ai.py` — returns SSE stream from `stream_comparison`.

### P7.5 — AI Features in Frontend

- [ ] **FE-38** Create `src/hooks/useStockExplanation.ts`:
  ```typescript
  export function useStockExplanation(symbol: string, enabled: boolean) {
    const [explanation, setExplanation] = useState("")
    const [isStreaming, setIsStreaming] = useState(false)
    // fetch POST /api/ai/explain-stock, read SSE stream, append tokens to state
    // Only fetch when enabled=true (unauthenticated users see a "Login to see AI insights" prompt)
  }
  ```

- [ ] **FE-39** Wire `useStockExplanation` into `StockCard.tsx`:
  - When `variant="table-row"` or `"chat-embed"`, use `StreamingText` to show the explanation
  - Show `<Skeleton />` while waiting for first token
  - Show "Login to see AI insights →" if user is not logged in

### P7.6 — Chat Panel

- [ ] **FE-40** 🔑 Create `src/components/chat/ChatInput.tsx`:
  - Text input with "Ask anything about Indian stocks..." placeholder
  - Send button (also triggers on Enter key)
  - Disabled + loading state while AI is thinking
  - Character limit: 500

- [ ] **FE-41** Create `src/components/chat/messages/TextMessage.tsx` — plain text bubble
- [ ] **FE-42** Create `src/components/chat/messages/FilterAppliedMessage.tsx` — shows "Applied X filters" with a summary list and result count
- [ ] **FE-43** Create `src/components/chat/messages/ErrorMessage.tsx` — error bubble with retry button

- [ ] **FE-44** Create `src/components/chat/ChatThread.tsx`:
  - Renders `Message[]` from `chatStore`
  - Routes each message to the correct message component via `ChatMessage.tsx`
  - Auto-scrolls to bottom on new message

- [ ] **FE-45** Create `src/components/chat/ChatPanel.tsx` — the full right panel:
  - `<ChatThread />` (scrollable, flex-grow)
  - `<ChatInput />` (pinned to bottom)
  - Suggested prompts on first load (empty state): "Show me profitable small-caps", "IT stocks with high ROE", "Low debt dividend payers"

- [ ] **FE-46** Wire `ChatPanel` into `ScreenerLayout.tsx` (replace the placeholder div). The two-panel is now fully functional:
  - User types a query → `chatStore.sendQuery()` → calls `/api/ai/parse-query` → calls `screenerStore.mergeFilters()` → left panel results update → chat shows `FilterAppliedMessage`.

---

## Phase 8 — Auth & Onboarding

> **Goal:** Users can sign up, log in (Google + email), and complete onboarding to select their investment style. AI features are gated behind login.

### P8.1 — Supabase Auth Configuration

- [ ] **AUTH-01** In Supabase dashboard → Authentication → Providers: Enable **Google OAuth**. Add your app's `callback URL` to Google Cloud Console OAuth credentials. The callback URL is `https://<your-supabase-project>.supabase.co/auth/v1/callback`.

- [ ] **AUTH-02** In Supabase → Authentication → Email: Enable email + password auth. Disable "Confirm email" for dev (re-enable before launch).

### P8.2 — Auth Pages

- [ ] **AUTH-03** Build `app/auth/login/page.tsx`:
  - "Sign in with Google" button (uses Supabase `signInWithOAuth`)
  - Email + Password form (uses Supabase `signInWithPassword`)
  - Link to signup page
  - Dark mode styled

- [ ] **AUTH-04** Build `app/auth/signup/page.tsx`:
  - Email + Password form (uses Supabase `signUp`)
  - After successful signup, redirect to the onboarding flow

- [ ] **AUTH-05** Build `app/auth/callback/route.ts` — Next.js API route that handles Supabase OAuth callback, exchanges code for session, redirects to `/onboarding` or `/screener`.

### P8.3 — Onboarding Flow

- [ ] **AUTH-06** Build `app/onboarding/page.tsx` — investment style selector:
  - Three large cards: **Value Investor**, **Growth Investor**, **Dividend Investor**
  - Each card shows: style name, description (2 lines), example: "Prefers low PE, high ROE, strong balance sheets"
  - User clicks one → POST `/api/auth/onboarding` → `userStore.setInvestmentStyle()` → redirect to `/screener`
  - Cannot be skipped (redirect back to onboarding if `onboarding_done=false`)

- [ ] **AUTH-07** Implement `POST /api/auth/onboarding` in `backend/routers/auth.py`:
  ```python
  class OnboardingRequest(BaseModel):
      investment_style: Literal["value", "growth", "dividend"]

  @router.post("/onboarding")
  async def complete_onboarding(req: OnboardingRequest, user_id: str = Depends(get_current_user)):
      db.table("user_profiles").update({
          "investment_style": req.investment_style,
          "onboarding_done": True
      }).eq("id", user_id).execute()
      return {"status": "ok"}
  ```

- [ ] **AUTH-08** Create `backend/dependencies/auth.py` — `get_current_user` dependency that:
  - Reads `Authorization: Bearer <token>` header
  - Verifies JWT with Supabase
  - Returns `user_id` or raises `HTTPException(401)`

### P8.4 — Auth State in Frontend

- [ ] **AUTH-09** Create `src/components/auth/AuthProvider.tsx` — wraps the app, initializes Supabase auth listener, syncs user to `userStore`.

- [ ] **AUTH-10** Add `<AuthProvider>` to `app/layout.tsx`.

- [ ] **AUTH-11** Create `src/middleware.ts` — protect these routes (redirect to login if unauthenticated):
  - `/portfolio`
  - `/paper-trading`
  - `/onboarding`

- [ ] **AUTH-12** Add auth state UI to the app header: show "Login" button when logged out; show user avatar + "Logout" when logged in. Add an investment style indicator (e.g., "Value" badge in the header).

- [ ] **AUTH-13** Gate AI features in `StockCard`: pass `isAuthenticated` as a prop. If false, replace the AI explanation with: `"Log in to see AI insights personalised to your investing style →"` (clickable, goes to login).

---

## Phase 9 — Stock Detail Page

> **Goal:** `/stock/[symbol]` shows full stock data, AI explanation, price chart, and news feed.

- [ ] **STOCK-01** Build `app/stock/[symbol]/page.tsx` as a Server Component:
  - Server-side fetch `GET /api/stocks/{symbol}` using `fetch` with `{ next: { revalidate: 1800 } }` (ISR, 30-min cache)
  - Pass data as props to client components

- [ ] **STOCK-02** Create `src/components/stock/FundamentalsGrid.tsx` — displays all key metrics in a responsive 3-column grid: PE, PB, ROE, ROCE, D/E, Net Margin, Revenue, Net Profit, EPS, Book Value, Graham Number, Dividend Yield. Each cell has a label, value, and a small info tooltip explaining the metric.

- [ ] **STOCK-03** Create `src/components/stock/PriceChart.tsx` using Recharts:
  - `<AreaChart>` with EOD closing price
  - Time range selector: 1M / 3M / 6M / 1Y / MAX
  - Green fill for positive periods, red fill for negative periods (relative to start)
  - Tooltip showing date + price on hover

- [ ] **STOCK-04** Create `src/components/stock/NewsFeed.tsx`:
  - Fetches `GET /api/stocks/{symbol}/news` client-side
  - Each article shows: headline, source, published date, `<SentimentBadge />`, link to original
  - Sorted by `published_at DESC`
  - Empty state: "No recent news found"

- [ ] **STOCK-05** Wire `StockCard` with `variant="detail"` at the top of the stock detail page. This triggers the SSE AI explanation stream as soon as the page mounts (if user is logged in).

- [ ] **STOCK-06** Add an "Open in Screener" button that pre-fills the screener with filters matching this stock's sector and market cap category.

---

## Phase 10 — MF Screener & Comparison

> **Goal:** MF screener works with filters. Two MFs can be compared side by side with AI narrative.

### P10.1 — MF Screener UI

- [ ] **MF-01** Create `src/components/mf/MFCard.tsx` — MF card showing: scheme name, fund house, category, expense ratio, AUM, 1Y/3Y returns, Sharpe ratio. Include an AI explanation area (same streaming pattern as `StockCard`).

- [ ] **MF-02** Create `src/components/mf/MFFilterPanel.tsx` — filter controls: category, fund house, max expense ratio, min AUM, direct/regular toggle.

- [ ] **MF-03** Build `app/mf/page.tsx` with the MF screener: `MFFilterPanel` on left, list of `MFCard` results on right. No two-panel chat for MF screener in MVP.

### P10.2 — Comparison Tool

- [ ] **MF-04** Build `app/compare/page.tsx` — search inputs for two instruments (stock or MF). A dropdown lets users pick: "Stock vs Stock", "MF vs MF".

- [ ] **MF-05** Create `src/components/mf/ComparisonTable.tsx` — side-by-side metric table. Each row is a metric (PE, ROE, etc.). "Winner" column highlights the better value in green.

- [ ] **MF-06** Wire comparison narrative: when two instruments are selected, open an SSE connection to `POST /api/ai/compare`. Stream the narrative below the comparison table using `StreamingText`.

- [ ] **MF-07** Create `src/components/chat/messages/ComparisonMessage.tsx` — renders a comparison inside the chat panel when the user asks "compare X vs Y".

---

## Phase 11 — Portfolio Tracker

> **Goal:** Users can upload a broker CSV or manually add holdings. Portfolio shows current P&L. Nightly pipeline updates prices.

### P11.1 — Backend: Portfolio API

- [ ] **PORT-01** Implement `POST /api/portfolio/upload` in `backend/routers/portfolio.py`:
  - Accept `multipart/form-data` with a CSV or XLSX file
  - Use Gemini CSV parser from Design doc (Section 6, Feature 5)
  - Parse holdings, match symbols to `stocks` table
  - Save to `portfolio_holdings` with `user_id` from auth token
  - Return parsed holdings for confirmation before saving

- [ ] **PORT-02** Implement `GET /api/portfolio` — return user's holdings with current values and P&L:
  ```python
  # Join portfolio_holdings with latest stock_prices to get current_value
  # Group by instrument_type (stock/mf)
  # Return total portfolio value, total unrealised P&L, holdings list
  ```

- [ ] **PORT-03** Implement `POST /api/portfolio/holding` — manually add a single holding (for users who don't want to upload a CSV):
  ```python
  class AddHoldingRequest(BaseModel):
      symbol: str
      instrument_type: Literal["stock", "mf"]
      quantity: float
      avg_buy_price: float
      buy_date: date | None
      broker: str | None
  ```

- [ ] **PORT-04** Implement `DELETE /api/portfolio/holding/{id}` — delete a holding.

- [ ] **PORT-05** Add portfolio value update step to `pipeline/fetch_prices.py`: after updating stock prices, run a query to recalculate `current_value` on all `portfolio_holdings` rows where `instrument_type='stock'`.

### P11.2 — Frontend: Portfolio UI

- [ ] **FE-47** Create `src/components/portfolio/PnLSummary.tsx` — top summary card showing:
  - Total portfolio value (₹)
  - Total invested amount (₹)
  - Total unrealised P&L (₹ and %)
  - Day's change (₹ and %)
  - Colour coded: green for gains, red for losses

- [ ] **FE-48** Create `src/components/portfolio/HoldingsTable.tsx` — sortable table:
  - Columns: Stock, Qty, Avg Buy Price, Current Price, Current Value, Unrealised P&L, P&L %
  - Sortable by any column
  - "Real Portfolio" and "Paper Portfolio" tabs to separate holdings

- [ ] **FE-49** Create `src/components/portfolio/CSVUploader.tsx`:
  - Drag-and-drop zone for CSV/XLSX files
  - Shows detected broker name after upload
  - Shows parsed holdings list for confirmation
  - "Confirm Import" → saves to backend
  - Error state: "Could not detect broker format. Try manual entry."

- [ ] **FE-50** Build `app/portfolio/page.tsx`:
  - If no holdings: show uploader + "or Add manually" button
  - If has holdings: show `PnLSummary` + `HoldingsTable`
  - Floating "+" button to add a holding manually

---

## Phase 12 — Paper Trading

> **Goal:** Users can simulate buying/selling stocks in a virtual portfolio. Separate from real holdings. ₹10,00,000 virtual starting cash.

### P12.1 — Backend: Paper Trading API

- [ ] **PAPER-01** Create `supabase/migrations/003_paper_trading.sql`:
  ```sql
  CREATE TABLE paper_portfolio (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      cash_balance   FLOAT NOT NULL DEFAULT 1000000.00,   -- ₹10 lakh
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE paper_trades (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
      symbol       TEXT NOT NULL,
      trade_type   TEXT CHECK (trade_type IN ('buy', 'sell')),
      quantity     FLOAT NOT NULL,
      price        FLOAT NOT NULL,          -- execution price (latest close)
      total_value  FLOAT NOT NULL,          -- quantity * price
      traded_at    TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE paper_portfolio ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users see own paper portfolio" ON paper_portfolio FOR ALL USING (auth.uid() = user_id);

  ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users see own paper trades" ON paper_trades FOR ALL USING (auth.uid() = user_id);
  ```

- [ ] **PAPER-02** Implement `POST /api/portfolio/paper/buy` in `backend/routers/portfolio.py`:
  ```python
  class PaperTradeRequest(BaseModel):
      symbol: str
      quantity: float

  # Logic:
  # 1. Get latest close price from stock_prices
  # 2. Compute total_cost = quantity * price
  # 3. Check user's cash_balance >= total_cost (error if not)
  # 4. Deduct from cash_balance
  # 5. Insert into paper_trades
  # 6. Upsert into portfolio_holdings with is_paper=true
  ```

- [ ] **PAPER-03** Implement `POST /api/portfolio/paper/sell`:
  - Verify user holds enough quantity of the stock in paper portfolio
  - Add proceeds to `cash_balance`
  - Insert sell trade into `paper_trades`
  - Update or delete the `portfolio_holdings` row

- [ ] **PAPER-04** Implement `GET /api/portfolio/paper` — return:
  - Cash balance
  - Paper holdings with current value
  - Total portfolio value (cash + holdings value)
  - P&L vs. ₹10 lakh baseline
  - Trade history (from `paper_trades`)

- [ ] **PAPER-05** Implement `POST /api/portfolio/paper/reset` — reset paper portfolio: set `cash_balance = 1000000`, delete all paper holdings and trades for this user.

### P12.2 — Frontend: Paper Trading UI

- [ ] **FE-51** Create `src/components/portfolio/PaperPortfolioSummary.tsx` — similar to `PnLSummary` but shows virtual cash balance and paper P&L.

- [ ] **FE-52** Create `src/components/portfolio/TradeHistory.tsx` — table of all paper trades with date, symbol, buy/sell, quantity, price, total value.

- [ ] **FE-53** Create `src/components/portfolio/TradeButton.tsx` — "Simulate Buy" / "Simulate Sell" button:
  - Opens a modal: quantity input, shows current price, total cost, cash balance after trade
  - Confirm → calls buy/sell API
  - Disabled if insufficient cash (for buy) or insufficient holdings (for sell)

- [ ] **FE-54** Add `<TradeButton />` to `StockCard` when `variant="detail"` and user has paper trading enabled.

- [ ] **FE-55** Build `app/paper-trading/page.tsx`:
  - `<PaperPortfolioSummary />` at top
  - `<HoldingsTable />` filtered to `is_paper=true`
  - `<TradeHistory />` below
  - "Reset Portfolio" button (with confirmation dialog)
  - Explainer card for new users: "Practice investing with ₹10,00,000 virtual money. No real money at risk."

---

## Phase 13 — Testing (pytest)

> **Goal:** Core backend logic has automated tests. Run before every deploy.

### P13.1 — Test Infrastructure

- [ ] **TEST-01** Create `backend/tests/conftest.py`:
  - `pytest_configure` to load test env vars from `backend/.env.test`
  - `@pytest.fixture` for a mock Supabase client (using `unittest.mock`)
  - `@pytest.fixture` for a mock Redis client
  - `@pytest.fixture` for the FastAPI `TestClient` from `httpx`

- [ ] **TEST-02** Create `backend/.env.test` with test-safe values (you can use the real Supabase dev project or mock everything).

### P13.2 — AI Service Tests

- [ ] **TEST-03** `backend/tests/test_ai_service.py`:
  - `test_validate_filter_output_strips_invalid_keys` — pass a dict with hallucinated keys, assert they're removed
  - `test_validate_filter_output_strips_invalid_sector` — pass an invalid sector, assert it's dropped
  - `test_validate_filter_output_valid_passthrough` — valid filter passes through unchanged
  - `test_nl_to_filter_basic` — mock Gemini response, assert correct filter returned
  - `test_nl_to_filter_ambiguous_query_returns_empty` — pass nonsense query, assert `{}` returned

### P13.3 — Screener API Tests

- [ ] **TEST-04** `backend/tests/test_stocks_api.py`:
  - `test_screen_stocks_no_filters` — `GET /api/stocks/screen` with no params returns 200 and a list
  - `test_screen_stocks_sector_filter` — sector=IT only returns IT stocks
  - `test_screen_stocks_pe_filter` — max_pe=15 only returns stocks with PE ≤ 15
  - `test_screen_stocks_pagination` — page=2 returns different results than page=1
  - `test_screen_stocks_invalid_sector` — invalid sector returns 400 or empty list (not a crash)
  - `test_health_endpoint` — `GET /health` returns `{"status": "ok"}`

### P13.4 — Data Pipeline Tests

- [ ] **TEST-05** `backend/tests/test_data_processor.py`:
  - `test_parse_float_valid` — `parse_float("18.5")` returns `18.5`
  - `test_parse_float_invalid` — `parse_float("N/A")` returns `None`
  - `test_parse_float_percentage` — `parse_float("18.5%")` returns `18.5`
  - `test_clean_symbol_strips_ns` — `clean_symbol("RELIANCE.NS")` returns `"RELIANCE"`
  - `test_format_market_cap_large` — 25000 Cr → `"large"`
  - `test_format_market_cap_small` — 1000 Cr → `"small"`

### P13.5 — Auth Tests

- [ ] **TEST-06** `backend/tests/test_auth.py`:
  - `test_onboarding_requires_auth` — POST `/api/auth/onboarding` without token returns 401
  - `test_onboarding_invalid_style` — invalid investment style returns 422
  - `test_portfolio_requires_auth` — `GET /api/portfolio` without token returns 401

### P13.6 — Portfolio Tests

- [ ] **TEST-07** `backend/tests/test_portfolio.py`:
  - `test_paper_buy_insufficient_cash` — buying more than cash balance returns 400
  - `test_paper_sell_insufficient_holdings` — selling more than held returns 400
  - `test_paper_buy_deducts_cash` — verify cash balance decreases after buy
  - `test_paper_portfolio_reset` — after reset, cash = 1,000,000, holdings empty

### P13.7 — Run Tests

- [ ] **TEST-08** Add `pytest.ini` or `pyproject.toml` test configuration:
  ```toml
  [tool.pytest.ini_options]
  testpaths = ["tests"]
  asyncio_mode = "auto"
  ```

- [ ] **TEST-09** Run the full test suite locally:
  ```bash
  cd backend
  uv run pytest -v
  ```
  All tests must pass before proceeding to deployment.

- [ ] **TEST-10** Add test step to a new GitHub Actions workflow `.github/workflows/test.yml`:
  ```yaml
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-python@v5
          with: { python-version: '3.12' }
        - run: pip install uv && uv sync
          working-directory: backend
        - run: uv run pytest -v
          working-directory: backend
  ```

---

## Phase 14 — Polish & Mobile

> **Goal:** The product is usable on mobile. Loading states, error boundaries, and empty states are complete. Disclaimers are everywhere.

### P14.1 — Loading & Error States

- [ ] **POLISH-01** Every data-fetching component must have three states:
  - **Loading:** Show `<Skeleton />` — never a blank white flash
  - **Error:** Show an inline error message with a "Retry" button
  - **Empty:** Show a helpful empty state with a suggestion

- [ ] **POLISH-02** Create `src/components/ui/ErrorBoundary.tsx` — catch JS errors in child components and show a graceful error UI instead of crashing the page.

- [ ] **POLISH-03** Add loading state to the chat panel: when `isAIThinking = true`, show three animated dots in the chat thread.

### P14.2 — Disclaimer Compliance

- [ ] **POLISH-04** Ensure **every** AI output carries a disclaimer. Audit the following components and add the disclaimer string if missing:
  - `StockCard` (all variants)
  - `ChatMessage` (TextMessage, StockCardMessage)
  - `ComparisonTable`
  - Stock detail page AI section
  - MF comparison narrative

  Standard disclaimer text: `"Educational insight only. Not investment advice."`

### P14.3 — Mobile Responsiveness

- [ ] **POLISH-05** Test and fix `ScreenerLayout.tsx` on 375px (iPhone SE) screen width. The bottom tab bar must be accessible and the screener results must be scrollable.

- [ ] **POLISH-06** Test `FilterPanel.tsx` on mobile — sliders must be touch-friendly (minimum touch target: 44px).

- [ ] **POLISH-07** Test `ChatPanel.tsx` on mobile — the input must not be obscured by the keyboard when it opens.

- [ ] **POLISH-08** Test `HoldingsTable.tsx` on mobile — consider a card-based layout on small screens instead of a wide table.

### P14.4 — Performance

- [ ] **POLISH-09** Add `loading.tsx` files for every page route (Next.js 13+ convention) to show a skeleton while the page loads.

- [ ] **POLISH-10** Lazy-load `PriceChart.tsx` with `next/dynamic` — Recharts is heavy and not needed on first render.

- [ ] **POLISH-11** Ensure screener results are paginated (50 per page). Never fetch or render all 500+ stocks at once.

---

## Phase 15 — Deployment & CI/CD

> **Goal:** Production deployment is stable, repeatable, and monitored. Pushes to `main` auto-deploy.

### P15.1 — Environment Hardening

- [ ] **DEPLOY-01** Audit all environment variables. Confirm no `service_role` key is in any frontend bundle. Run `grep -r "service_role" frontend/` — must return nothing.

- [ ] **DEPLOY-02** In Supabase → Authentication → Email: re-enable "Confirm email" for production.

- [ ] **DEPLOY-03** Update `ALLOWED_ORIGINS` in Railway env vars to include the production Vercel URL only (not `localhost`).

- [ ] **DEPLOY-04** In Vercel → Settings → Environment Variables: confirm all `NEXT_PUBLIC_*` vars point to production Railway URL and production Supabase project.

### P15.2 — Railway Production Config

- [ ] **DEPLOY-05** Set Railway deployment region to `ap-southeast-1` (Singapore — closest to Indian users).

- [ ] **DEPLOY-06** Configure Railway health check: HTTP path `/health`, interval 30s, timeout 10s.

- [ ] **DEPLOY-07** Set Railway restart policy to "Always restart on failure".

- [ ] **DEPLOY-08** Enable Railway metrics dashboard. Set up a basic alert if memory usage exceeds 400MB.

### P15.3 — Vercel Production Config

- [ ] **DEPLOY-09** Set Vercel deployment region to `sin1` (Singapore) for lowest latency to Indian users.

- [ ] **DEPLOY-10** Configure Vercel's Edge Config or middleware to redirect `www.` to apex domain.

- [ ] **DEPLOY-11** Verify Vercel Analytics is enabled (free, useful for early traction data).

### P15.4 — GitHub Actions CI

- [ ] **DEPLOY-12** Confirm the three GitHub Actions workflows are active:
  - `test.yml` — runs pytest on every push/PR
  - `daily_pipeline.yml` — runs Mon–Fri at 3:30 PM IST
  - `weekly_fundamentals.yml` — runs Sunday 2 AM IST

- [ ] **DEPLOY-13** Add a `deploy-check.yml` workflow that posts a Slack or email notification if the daily pipeline fails. Use GitHub Actions' native `if: failure()` condition.

### P15.5 — Domain & SSL

- [ ] **DEPLOY-14** Register a domain (e.g., `screener-ai.in` or `screenerai.app`). Point DNS to Vercel. Vercel provisions SSL automatically.

- [ ] **DEPLOY-15** Add the production domain to Supabase → Authentication → URL Configuration → Site URL and Redirect URLs.

---

## Phase 16 — Beta Launch Checklist

> **Goal:** 10–20 real users can use the product without embarrassing failures.

### P16.1 — Pre-Launch Audit

- [ ] **BETA-01** **Legal disclaimer review:** Have a lawyer or legally-informed advisor review all AI output framing. Confirm the "educational insights only" framing is sufficient or adjust per their advice. This is a SEBI gray area — do not skip.

- [ ] **BETA-02** **Data accuracy check:** Manually verify 10 random stocks:
  - Cross-check PE, ROE, D/E from Supabase against Screener.in directly
  - Cross-check latest price against NSE/Google Finance
  - Flag any discrepancies

- [ ] **BETA-03** **AI quality check:** Run 20 different natural language queries through the chat panel. Verify:
  - At least 18/20 produce sensible filter combinations
  - No hallucinated filter keys pass through validation
  - Streaming works without dropped tokens

- [ ] **BETA-04** **End-to-end user journey test** (do this manually as a fresh incognito user):
  1. Land on homepage → enter screener → see results (no login required)
  2. Try a NL query in the chat → filters update → results change
  3. Click a stock → detail page loads → AI explanation streams
  4. Sign up → complete onboarding → investment style saved
  5. Upload a sample CSV → holdings imported → P&L shows
  6. Try paper trading: buy 10 shares of INFY → see holdings update
  7. Log out → AI features hidden → screener still works

- [ ] **BETA-05** **Performance check:**
  - Screener initial load: < 2 seconds
  - AI first token: < 1.5 seconds
  - Filter update round trip: < 500ms (cached)

### P16.2 — Monitoring Setup

- [ ] **BETA-06** Set up free error monitoring with Sentry:
  - Backend: `pip install sentry-sdk`, add to `main.py`
  - Frontend: `pnpm add @sentry/nextjs`, run `npx @sentry/wizard`

- [ ] **BETA-07** Create a simple monitoring dashboard (even a shared Supabase query) tracking:
  - Daily active users (Supabase auth events)
  - AI requests per day (log to a `usage_logs` table)
  - Gemini API cost estimate (tokens × price)
  - Pipeline last successful run time

- [ ] **BETA-08** Set a manual Gemini spend alert: check Google AI Studio billing weekly. If approaching $5/day, implement request rate limiting on `POST /api/ai/*` endpoints.

### P16.3 — Soft Launch

- [ ] **BETA-09** Share with 10–20 trusted users (personal network, investing communities on Reddit/Twitter). Provide a feedback form (Tally or Typeform — free).

- [ ] **BETA-10** Collect and triage feedback. Categorise as: Bug / UX / Missing Feature. Schedule a "bug fix sprint" in week 1 of post-launch.

---

## Appendix A — File Creation Order

When you sit down to build, create files in this exact order. Each file unblocks the next:

```
1.  supabase/migrations/001_initial_schema.sql   ← All 8 tables
2.  backend/config.py                            ← Env var validation
3.  backend/database.py                          ← Supabase client
4.  backend/cache.py                             ← Redis client
5.  backend/main.py                              ← FastAPI app
6.  pipeline/fetch_prices.py                     ← First real data
7.  pipeline/fetch_mf_navs.py                    ← MF data
8.  backend/services/ai_service.py               ← Gemini + 4 functions
9.  backend/routers/ai.py                        ← SSE endpoints
10. frontend/src/store/screenerStore.ts          ← Shared filter state
11. frontend/src/components/screener/FilterPanel.tsx
12. frontend/src/components/screener/ResultsTable.tsx
13. frontend/src/components/screener/ScreenerLayout.tsx
14. frontend/src/components/stock/StockCard.tsx  ← Core reusable unit
15. frontend/src/components/chat/ChatPanel.tsx
```

---

## Appendix B — API Endpoint Quick Reference

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |
| GET | `/api/stocks/screen` | No | Filter + paginate stocks |
| GET | `/api/stocks/{symbol}` | No | Full stock detail |
| GET | `/api/stocks/{symbol}/news` | No | News + sentiment |
| GET | `/api/mf/screen` | No | Filter MFs |
| GET | `/api/mf/{scheme_code}` | No | Full MF detail |
| GET | `/api/compare` | No | Structured diff data |
| POST | `/api/ai/parse-query` | No | NL → filter JSON |
| POST | `/api/ai/explain-stock` | Optional | SSE stock explanation |
| POST | `/api/ai/compare` | Optional | SSE comparison narrative |
| POST | `/api/portfolio/upload` | Required | CSV → parse → save |
| POST | `/api/portfolio/holding` | Required | Add single holding |
| DELETE | `/api/portfolio/holding/{id}` | Required | Delete holding |
| GET | `/api/portfolio` | Required | Holdings + P&L |
| POST | `/api/portfolio/paper/buy` | Required | Paper trade: buy |
| POST | `/api/portfolio/paper/sell` | Required | Paper trade: sell |
| GET | `/api/portfolio/paper` | Required | Paper portfolio |
| POST | `/api/portfolio/paper/reset` | Required | Reset paper portfolio |
| POST | `/api/auth/onboarding` | Required | Set investment style |

---

## Appendix C — Redis Cache TTL Strategy

| Data Type | Cache Key Pattern | TTL |
|---|---|---|
| Stock screener results | `screen:{filter_hash}` | 30 min |
| Individual stock detail | `stock:{symbol}` | 30 min |
| Stock news | `news:{symbol}` | 15 min |
| MF screener results | `mf_screen:{filter_hash}` | 1 hour |
| MF detail | `mf:{scheme_code}` | 1 hour |
| NL→filter parse | `nl_query:{query_hash}` | 1 hour |
| AI stock explanation | `explain:{symbol}:{style}` | 1 hour |
| Comparison data | `compare:{sym_a}:{sym_b}` | 30 min |

---

## Appendix D — Sector Reference

Valid sector values for the screener (used in filter validation and the Gemini prompt):

```
"IT", "Banking", "FMCG", "Pharma", "Auto", "Energy",
"Metals", "Infrastructure", "Real Estate", "Chemicals",
"Telecom", "Financial Services"
```

---

*Document version: 1.0 — Generated from DESIGN.md + REQUIREMENTS.md*  
*Paper trading: Included in MVP per founder decision*  
*Testing: pytest (backend) only*  
*Last updated: Pre-build design freeze*

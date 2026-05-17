-- Extend stock_fundamentals with derived/advanced metrics, and add child tables
-- for time-series financial statements and ownership snapshots.
--
-- Companion script: pipeline/analysis/fetch_fundamentals.mjs

-- ── Extend stock_fundamentals ──────────────────────────────────────────────
-- All columns nullable: not every stock has data for every metric (especially
-- smallcaps and financial companies with non-standard statement layouts).

ALTER TABLE stock_fundamentals
  -- Valuation
  ADD COLUMN IF NOT EXISTS ev_to_ebitda           NUMERIC,
  ADD COLUMN IF NOT EXISTS peg                    NUMERIC,
  ADD COLUMN IF NOT EXISTS price_to_sales         NUMERIC,

  -- Profitability & margins
  ADD COLUMN IF NOT EXISTS gross_margin           NUMERIC,
  ADD COLUMN IF NOT EXISTS ebitda_margin          NUMERIC,
  ADD COLUMN IF NOT EXISTS ebitda_cr              NUMERIC,
  ADD COLUMN IF NOT EXISTS effective_tax_rate     NUMERIC,

  -- Cash flow & quality of earnings
  ADD COLUMN IF NOT EXISTS operating_cash_flow_cr NUMERIC,
  ADD COLUMN IF NOT EXISTS fcf_cr                 NUMERIC,
  ADD COLUMN IF NOT EXISTS fcf_yield              NUMERIC,
  ADD COLUMN IF NOT EXISTS cash_conversion        NUMERIC,  -- OCF / Net Income

  -- Solvency & liquidity
  ADD COLUMN IF NOT EXISTS interest_coverage      NUMERIC,
  ADD COLUMN IF NOT EXISTS current_ratio          NUMERIC,
  ADD COLUMN IF NOT EXISTS quick_ratio            NUMERIC,
  ADD COLUMN IF NOT EXISTS net_debt_cr            NUMERIC,
  ADD COLUMN IF NOT EXISTS net_debt_to_ebitda     NUMERIC,

  -- Working capital efficiency
  ADD COLUMN IF NOT EXISTS debtor_days            NUMERIC,
  ADD COLUMN IF NOT EXISTS inventory_days         NUMERIC,
  ADD COLUMN IF NOT EXISTS payable_days           NUMERIC,
  ADD COLUMN IF NOT EXISTS cash_conversion_cycle  NUMERIC,

  -- Historical growth (computed from 4Y annual statements)
  ADD COLUMN IF NOT EXISTS revenue_cagr_3y        NUMERIC,
  ADD COLUMN IF NOT EXISTS pat_cagr_3y            NUMERIC,
  ADD COLUMN IF NOT EXISTS ebitda_cagr_3y         NUMERIC,
  ADD COLUMN IF NOT EXISTS revenue_growth_yoy     NUMERIC,
  ADD COLUMN IF NOT EXISTS pat_growth_yoy         NUMERIC,

  -- Forward-looking (from analyst estimates)
  ADD COLUMN IF NOT EXISTS forward_pe             NUMERIC,
  ADD COLUMN IF NOT EXISTS forward_eps            NUMERIC,
  ADD COLUMN IF NOT EXISTS earnings_growth_forward NUMERIC,

  -- Provenance
  ADD COLUMN IF NOT EXISTS data_source            TEXT,     -- 'NSE' | 'BSE' | 'NSE+BSE'
  ADD COLUMN IF NOT EXISTS fundamentals_updated_at TIMESTAMPTZ;


-- ── stock_financial_statements ─────────────────────────────────────────────
-- One row per (stock, period_type, period_end_date). Stores the full raw
-- statement payload as JSONB so we can compute new metrics later without
-- re-fetching from Yahoo.

CREATE TABLE IF NOT EXISTS stock_financial_statements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  period_type     TEXT NOT NULL CHECK (period_type IN ('annual', 'quarterly')),
  period_end_date DATE NOT NULL,
  income_stmt     JSONB,
  balance_sheet   JSONB,
  cash_flow       JSONB,
  source          TEXT,                       -- 'NSE' | 'BSE'
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, period_type, period_end_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_fin_stmts_stock_period
  ON stock_financial_statements (stock_id, period_type, period_end_date DESC);

ALTER TABLE stock_financial_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read financial statements"
  ON stock_financial_statements FOR SELECT USING (true);

CREATE POLICY "Pipeline can insert financial statements"
  ON stock_financial_statements FOR INSERT WITH CHECK (true);

CREATE POLICY "Pipeline can update financial statements"
  ON stock_financial_statements FOR UPDATE WITH CHECK (true);


-- ── stock_ownership_snapshots ──────────────────────────────────────────────
-- Snapshot of ownership data fetched from Yahoo. Promoter holding is NOT
-- captured here (Yahoo doesn't expose it for Indian stocks) — that requires
-- a separate NSE shareholding-pattern scraper added later.

CREATE TABLE IF NOT EXISTS stock_ownership_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id              UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  snapshot_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  insider_pct           NUMERIC,             -- % held by insiders
  institution_pct       NUMERIC,             -- % held by institutions (incl. FIIs/DIIs)
  float_pct             NUMERIC,             -- % of float held by institutions
  top_institutions      JSONB,               -- top 10 institutional holders
  top_funds             JSONB,               -- top mutual fund holders (DII proxy)
  recent_insider_trades JSONB,               -- insider buys/sells (last 6 months)
  fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_ownership_stock_date
  ON stock_ownership_snapshots (stock_id, snapshot_date DESC);

ALTER TABLE stock_ownership_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ownership snapshots"
  ON stock_ownership_snapshots FOR SELECT USING (true);

CREATE POLICY "Pipeline can insert ownership snapshots"
  ON stock_ownership_snapshots FOR INSERT WITH CHECK (true);

CREATE POLICY "Pipeline can update ownership snapshots"
  ON stock_ownership_snapshots FOR UPDATE WITH CHECK (true);

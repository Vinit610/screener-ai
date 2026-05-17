-- Add multi-period CAGR columns + period metadata so the UI can be honest
-- about which time range each computed metric actually covers.

ALTER TABLE stock_fundamentals
  -- 2-year and 5-year CAGR columns. The 3-year columns already exist (migration 007).
  -- Each is populated only when we actually have that much annual history available.
  ADD COLUMN IF NOT EXISTS revenue_cagr_2y NUMERIC,
  ADD COLUMN IF NOT EXISTS revenue_cagr_5y NUMERIC,
  ADD COLUMN IF NOT EXISTS pat_cagr_2y     NUMERIC,
  ADD COLUMN IF NOT EXISTS pat_cagr_5y     NUMERIC,
  ADD COLUMN IF NOT EXISTS ebitda_cagr_2y  NUMERIC,
  ADD COLUMN IF NOT EXISTS ebitda_cagr_5y  NUMERIC,

  -- Data freshness & coverage metadata. These let the UI render labels like
  -- "Revenue CAGR (FY21→FY24, 3 years)" or "Latest data: FY24" without guessing.
  ADD COLUMN IF NOT EXISTS latest_period_end       DATE,
  ADD COLUMN IF NOT EXISTS annual_periods_count    INTEGER,
  ADD COLUMN IF NOT EXISTS quarterly_periods_count INTEGER;

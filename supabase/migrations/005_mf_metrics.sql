-- 005_mf_metrics.sql
-- Precomputed per-fund metrics for the MF screener and detail page.
-- One row per Direct+Growth equity fund, refreshed by
-- pipeline/compute_mf_metrics.py (runs after fetch_mf_navs.py in the daily
-- pipeline, also manually triggerable).
--
-- Public reference data like mutual_funds / mf_navs — no RLS.

create table if not exists mf_metrics (
  fund_id uuid primary key references mutual_funds(id) on delete cascade,

  -- trailing returns (%), calendar-date based; null when the fund's history
  -- doesn't reach back far enough for the period
  return_1y numeric,
  return_3y numeric,
  return_5y numeric,

  -- rank by trailing return within the fund's sub_category, per period.
  -- peers_* is the denominator (funds in the category with a return for that
  -- period). null when the fund itself has no return for the period.
  rank_1y int,  peers_1y int,
  rank_3y int,  peers_3y int,
  rank_5y int,  peers_5y int,

  -- risk-adjusted ratios over a fixed trailing-3Y window; null when the fund
  -- has less than 3 years of history
  sharpe_3y  numeric,
  sortino_3y numeric,

  -- worst peak-to-trough decline over the full NAV history
  max_drawdown               numeric,  -- e.g. -38.21 (percent)
  max_drawdown_peak_date     date,
  max_drawdown_trough_date   date,
  max_drawdown_recovery_date date,      -- null = not yet recovered

  nav_history_start date,               -- earliest NAV on file
  latest_nav_date   date,               -- most recent NAV used
  computed_at       timestamptz default now()
);

create index if not exists mf_metrics_return_3y_idx on mf_metrics (return_3y);

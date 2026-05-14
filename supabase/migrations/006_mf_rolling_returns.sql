-- 006_mf_rolling_returns.sql
-- Phase 2: rolling-return distributions on mf_metrics.
--
-- One JSONB blob per fund, keyed by window ("1y" / "3y" / "5y"). Each value is
-- {avg, min, max, pct_above_fd, count} — the distribution of *annualised*
-- returns across every overlapping window in the fund's history (one window
-- per NAV date, so min/max are exact). Written by compute_mf_metrics.py.
--
-- A single trailing return can be lucky timing; rolling returns show the range
-- of outcomes an investor actually experienced.

alter table mf_metrics add column if not exists rolling_returns jsonb;

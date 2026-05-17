-- Add ROA column. Useful as a primary return metric for banks/NBFCs/insurance
-- (where ROCE is not meaningful) and as a complementary metric for non-financials.

ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS roa NUMERIC,
  ADD COLUMN IF NOT EXISTS is_financial BOOLEAN;

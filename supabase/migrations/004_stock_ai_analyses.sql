-- AI-generated stock analysis (daily batch via Gemini)
CREATE TABLE IF NOT EXISTS stock_ai_analyses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id     UUID NOT NULL UNIQUE REFERENCES stocks(id) ON DELETE CASCADE,
  analysis_json JSONB NOT NULL,
  overall_score INTEGER CHECK (overall_score BETWEEN 0 AND 100),
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score_1d_ago  INTEGER,
  score_7d_ago  INTEGER,
  score_30d_ago INTEGER
);

-- Fast lookup by stock_id (already unique, covered by unique constraint)
-- Index for finding stale analyses
CREATE INDEX IF NOT EXISTS idx_stock_ai_analyses_generated_at
  ON stock_ai_analyses(generated_at);

-- Enable RLS
ALTER TABLE stock_ai_analyses ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated (and anon) users to read analyses
CREATE POLICY "Anyone can read analyses"
  ON stock_ai_analyses FOR SELECT
  USING (true);

-- Allow INSERT for pipeline (service role can bypass RLS, so this is for safety)
-- Service role key automatically bypasses RLS, but we keep repo for auditability
CREATE POLICY "Allow insert for pipeline"
  ON stock_ai_analyses FOR INSERT
  WITH CHECK (true);

-- Allow UPDATE for pipeline
CREATE POLICY "Allow update for pipeline"
  ON stock_ai_analyses FOR UPDATE
  WITH CHECK (true);

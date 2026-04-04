-- Paper Trading tables
-- Virtual portfolio with ₹10,00,000 starting cash

CREATE TABLE IF NOT EXISTS paper_portfolio (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    cash_balance   FLOAT NOT NULL DEFAULT 1000000.00,   -- ₹10 lakh
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_trades (
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

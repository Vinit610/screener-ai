# screener-ai — Full Product Design Document

> AI-first hybrid screener for self-directed Indian retail investors.  
> Solo founder · Python/FastAPI backend · Next.js frontend · Near-zero infra cost  
> Status: Pre-build design freeze

---

## Table of Contents

1. Product Recap
2. Technology Stack — Decisions & Rationale
3. System Architecture
4. Data Sources & Ingestion Pipeline
5. Database Schema
6. AI Orchestration Layer
7. API Design
8. UI/UX Architecture & Component Structure
9. Screener.in Scraping Strategy
10. Cost Breakdown
11. MVP Build Timeline

---

## 1. Product Recap

**Target user:** Self-directed Indian retail investor. Invests in direct equities and mutual funds. Frustrated by spreadsheet-like tools (Screener.in) and wants to ask questions in plain English instead of configuring 20 dropdown filters.

**Core promise:** Don't just show numbers — explain the why.

**Instruments covered (MVP):** NSE/BSE equities, Mutual Funds (all AMCs via AMFI), ETFs.

**MVP feature set (confirmed):**
- AI Screener — natural language chat + traditional filter UI, two-panel hybrid
- Stock detail page with AI explanation and news sentiment
- MF comparison tool
- Portfolio tracker (CSV broker upload)
- Side-by-side stock/MF comparison with AI narrative

**Deferred to V2:** Alerts & watchlist, weekly digest email, Export to CSV, ETF-specific screens, paper trading.

**LLM:** Gemini Flash 2.0 (on-demand generation — Option A, justified by low initial user count)

**AI explanations:** Generated live per request, streamed to frontend. No pre-computation.

**Regulatory positioning:** All AI outputs framed as educational insights, not investment advice. Every AI output carries a disclaimer. No Buy/Sell language — instead: "Based on your value-style criteria, this stock scores highly on..."

---

## 2. Technology Stack — Decisions & Rationale

### Frontend — Next.js (App Router) on Vercel

**Why Next.js:**
- React-based with SSR — stock and MF detail pages are indexable by Google (important for organic traffic)
- App Router enables React Server Components, which reduces JS bundle size for the static screener shell
- Streaming support via `ReadableStream` — needed for token-by-token AI response rendering
- Vercel's free tier handles thousands of daily users before any billing kicks in
- Largest ecosystem — as a solo dev, you want maximum community support

**Why not:** Vue/Nuxt — smaller ecosystem, fewer LLM streaming examples. SvelteKit — excellent but too few resources for the specific patterns this product needs (two-panel reactive UI + SSE streaming).

### Backend — FastAPI on Railway

**Why FastAPI:**
- You already know Python — no context switch
- Async-first: handles concurrent SSE streams without blocking (critical for the chat panel)
- Automatic OpenAPI docs (useful for solo dev — your API is self-documenting)
- Pydantic models enforce strict input/output shapes — pairs perfectly with Gemini's structured output

**Why Railway over Render or Fly.io:**
- Railway gives $5 credit/month free — sufficient for light MVP traffic
- Persistent server (unlike Vercel serverless functions which cold-start and can't hold WebSocket/SSE connections open)
- One-click Python deployments, built-in env var management

### Database — Supabase (PostgreSQL)

**Why Supabase:**
- Eliminates a separate auth service (Auth0, Clerk would cost $20-30/month minimum)
- Google OAuth + Email/Password built-in, with Row Level Security for user data isolation
- Free tier: 500MB DB, 50MB file storage, 2 projects — ample for MVP
- Supabase's Python client integrates directly with FastAPI

**Key design decision:** Supabase Auth's `auth.users` table is extended with a `user_profiles` table for investment style and onboarding state. Never modify `auth.users` directly.

### Cache — Upstash Redis

**Why:**
- Screener filter queries are expensive — a filter over 5,000 NSE stocks hits the DB every slider tweak without caching
- Upstash free tier: 10,000 commands/day, zero infrastructure
- Also used to cache Gemini Flash responses for identical queries (if two users ask the same question, you don't pay twice)
- Cache TTL strategy: stock prices — 30 min; fundamentals — 6 hours; MF NAVs — 24 hours; AI explanations — 1 hour

### LLM — Gemini Flash 2.0

**Why Gemini Flash over GPT-4o-mini:**
- Cheaper per token (approx 5-10x cheaper than GPT-4o-mini at same task quality)
- Fast enough for streaming (first token in ~300-500ms)
- Google AI Studio free tier: 1,500 requests/day free — covers early MVP entirely before you need to pay
- Excellent at structured JSON output (NL→filter translation) and narrative generation
- Python SDK (`google-generativeai`) is well-maintained

**When to reconsider:** If structured output accuracy degrades on edge cases, fall back to GPT-4o-mini for the NL→filter task specifically (it's more reliable for strict schema adherence).

### Data Pipeline — GitHub Actions (cron)

**Why:**
- GitHub Actions gives 2,000 free minutes/month on private repos
- Your pipeline runs once daily (~10-15 minutes) = ~300-450 minutes/month — well within free tier
- No separate pipeline infrastructure (Airflow, Prefect) needed at MVP scale
- Python scripts run directly — same language as your backend

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     USER (Browser)                          │
│              Next.js App Router on Vercel                   │
│         /screener  /mf  /stock/[sym]  /compare  /portfolio  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS / SSE
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  FastAPI Backend (Railway)                   │
│                                                             │
│  /api/stocks/*   /api/mf/*   /api/ai/*   /api/portfolio/*  │
│                                                             │
│  ai_service.py ──► Gemini Flash 2.0                        │
└──────────┬───────────────────────────────────┬─────────────┘
           │                                   │
           ▼                                   ▼
┌──────────────────────┐           ┌───────────────────────┐
│  Supabase            │           │  Upstash Redis        │
│  PostgreSQL + Auth   │           │  Query + AI cache     │
└──────────────────────┘           └───────────────────────┘
           ▲
           │ writes nightly
┌──────────────────────────────────────────────────────────────┐
│                  GitHub Actions (cron)                       │
│          Triggers daily at 3:30 PM IST (after NSE close)    │
│                                                             │
│  yfinance ── AMFI API ── Screener.in ── News RSS            │
│      │           │            │              │              │
│      └───────────┴────────────┴──────────────┘             │
│                        data_processor.py                    │
│                     (clean, validate, upsert)               │
└──────────────────────────────────────────────────────────────┘
```

**Request flow for screener query:**
1. User types "show me profitable small-caps with low debt" in the chat panel
2. Next.js POSTs to `POST /api/ai/parse-query`
3. FastAPI checks Upstash Redis for a cached response to this query
4. Cache miss → sends to Gemini Flash with structured output prompt
5. Gemini returns JSON filter object: `{ market_cap_category: "small", min_roe: 15, max_debt_to_equity: 0.5 }`
6. FastAPI returns filter object + caches in Redis (TTL: 1 hour)
7. Next.js applies filters to screener state — left panel animates to new filter values
8. Next.js fetches `GET /api/stocks/screen?filters=...` — FastAPI queries Supabase
9. Results render in the screener table

**Request flow for stock card AI explanation:**
1. Stock card mounts on screen
2. Next.js opens `EventSource` to `POST /api/ai/explain-stock` with symbol + user's investment style
3. FastAPI builds context from Supabase fundamentals
4. FastAPI calls Gemini Flash with streaming enabled
5. Tokens stream back via SSE — `data: {"token": "Reliance"}`, `data: {"token": " has"}`, etc.
6. Next.js renders text progressively into the card

---

## 4. Data Sources & Ingestion Pipeline

### Pipeline Schedule

```
3:30 PM IST daily (NSE closes at 3:30 PM, data finalises by ~3:45 PM)
├── fetch_prices.py        — yfinance EOD prices for all NSE/BSE stocks
├── fetch_mf_navs.py       — AMFI daily NAV file
└── fetch_news.py          — RSS feeds, sentiment batch processing

Sundays only:
└── fetch_fundamentals.py  — Screener.in scraping (fundamentals change slowly)

Every 4 hours:
└── fetch_news.py          — News is time-sensitive, needs more frequent refresh
```

### Source 1: yfinance (Stock Prices + Basic Fundamentals)

```python
import yfinance as yf

# NSE stocks use .NS suffix, BSE use .BO
tickers = ["RELIANCE.NS", "INFY.NS", "TCS.NS"]

# Batch download — much faster than individual calls
data = yf.download(tickers, period="1d", group_by="ticker")

# For fundamentals (PE, PB, market cap)
ticker = yf.Ticker("RELIANCE.NS")
info = ticker.info  # returns dict with ~100+ fields
```

**What yfinance gives you reliably:**
- OHLCV (open, high, low, close, volume) — very reliable
- Market cap, 52-week high/low — reliable
- PE ratio, PB ratio, dividend yield — sometimes missing for smaller stocks
- Earnings dates, analyst recommendations — useful for V2

**Limitations:** No ROCE, no D/E ratio, no detailed margin breakdown. These come from Screener.in.

### Source 2: AMFI Official API (MF NAVs)

AMFI publishes a free, official flat file every day after 9 PM:

```
URL: https://www.amfiindia.com/spages/NAVAll.txt
Format: Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
```

```python
import requests
import pandas as pd
from io import StringIO

def fetch_amfi_navs():
    url = "https://www.amfiindia.com/spages/NAVAll.txt"
    response = requests.get(url)
    
    # Parse the flat file — it has section headers mixed in
    lines = response.text.strip().split('\n')
    data_lines = [l for l in lines if ';' in l and l.count(';') >= 5]
    
    df = pd.read_csv(StringIO('\n'.join(data_lines)), sep=';',
                     names=['scheme_code','isin_div','isin_growth','scheme_name','nav','date'])
    return df
```

**For historical NAVs** (needed for rolling returns, Sharpe ratio): fetch daily and accumulate in your own `mf_navs` table. After 6 months of data you can compute 6M returns; after a year, 1Y returns. The AMFI file only gives today's NAV — there's no historical endpoint.

**For risk ratios (Sharpe, Sortino, standard deviation):** Calculate from your accumulated `mf_navs` table. No external source needed.

```python
import numpy as np

def calculate_sharpe(nav_series, risk_free_rate=0.065):  # 6.5% — approx Indian 10Y Gsec yield
    daily_returns = nav_series.pct_change().dropna()
    annualised_return = (1 + daily_returns.mean()) ** 252 - 1
    annualised_std = daily_returns.std() * np.sqrt(252)
    return (annualised_return - risk_free_rate) / annualised_std
```

### Source 3: Screener.in Scraping (Fundamentals)

See **Section 9** for the full deep dive on how to scrape without getting blocked.

**Data extracted:** PE, PB, ROE, ROCE, Debt/Equity, Net Margin, Operating Margin, Revenue (TTM), Net Profit (TTM), EPS, Book Value.

**Frequency:** Weekly (Sundays, 6 AM IST). Fundamentals don't change daily.

### Source 4: News RSS + Sentiment

```python
RSS_FEEDS = [
    "https://www.moneycontrol.com/rss/marketreports.xml",
    "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "https://www.business-standard.com/rss/markets-106.rss",
]
```

**Sentiment pipeline:**
1. Parse RSS → extract headline + summary + published_at + URL
2. Deduplicate against existing `news` table by URL
3. Batch new articles (25 per batch) and send to Gemini Flash:

```python
SENTIMENT_PROMPT = """
Analyze these Indian stock market news headlines.
For each, return a JSON object with:
- sentiment: "positive" | "negative" | "neutral"
- sentiment_score: float from -1.0 to 1.0
- related_symbols: list of NSE ticker symbols mentioned (e.g. ["RELIANCE", "ONGC"])
  Return [] if no specific companies mentioned.

Return a JSON array only. No markdown, no explanation.

Headlines:
{headlines_json}
"""
```

4. Parse Gemini response → upsert into `news` table
5. Build `news_stock_map` — the `related_symbols` array is exploded into per-stock associations

---

## 5. Database Schema

Seven tables. All in Supabase (PostgreSQL). Row Level Security enabled on user-specific tables.

### `stocks`

```sql
CREATE TABLE stocks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol          TEXT NOT NULL UNIQUE,   -- "RELIANCE", "INFY"
    exchange        TEXT NOT NULL,           -- "NSE" or "BSE"
    name            TEXT NOT NULL,
    sector          TEXT,
    industry        TEXT,
    market_cap_cr   FLOAT,                  -- in crores INR
    nse_listed      BOOLEAN DEFAULT false,
    bse_listed      BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stocks_symbol ON stocks(symbol);
CREATE INDEX idx_stocks_sector ON stocks(sector);
```

### `stock_fundamentals`

One row per stock, overwritten weekly. Not a time-series — fundamentals change slowly.

```sql
CREATE TABLE stock_fundamentals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id         UUID REFERENCES stocks(id) ON DELETE CASCADE,
    pe               FLOAT,
    pb               FLOAT,
    roe              FLOAT,                  -- percentage, e.g. 18.5
    roce             FLOAT,
    debt_to_equity   FLOAT,
    net_margin       FLOAT,                  -- percentage
    operating_margin FLOAT,
    revenue_cr       FLOAT,
    net_profit_cr    FLOAT,
    eps              FLOAT,
    dividend_yield   FLOAT,
    book_value       FLOAT,
    graham_number    FLOAT GENERATED ALWAYS AS (
                         SQRT(22.5 * NULLIF(eps, 0) * NULLIF(book_value, 0))
                     ) STORED,              -- auto-calculated
    scraped_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(stock_id)
);
```

`graham_number` is a computed column — PostgreSQL calculates it automatically from `eps` and `book_value`. This saves you from computing it in Python.

### `stock_prices`

Your largest table. Index on `(stock_id, date)` — every screener query that involves returns hits this index.

```sql
CREATE TABLE stock_prices (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_id  UUID REFERENCES stocks(id) ON DELETE CASCADE,
    date      DATE NOT NULL,
    open      FLOAT,
    high      FLOAT,
    low       FLOAT,
    close     FLOAT NOT NULL,
    volume    BIGINT,
    UNIQUE(stock_id, date)
);

CREATE INDEX idx_prices_stock_date ON stock_prices(stock_id, date DESC);
```

**Size estimate:** 5,000 stocks × 250 trading days × 3 years = ~3.75M rows. At ~100 bytes/row = 375MB. Fits within Supabase free tier (500MB) for 3 years.

**Computed returns:** Don't store 1Y/6M/3M returns as columns. Compute them on the fly from this table in the screener query — or cache results in Redis.

### `mutual_funds`

```sql
CREATE TABLE mutual_funds (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheme_code    TEXT NOT NULL UNIQUE,   -- AMFI scheme code
    scheme_name    TEXT NOT NULL,
    fund_house     TEXT NOT NULL,          -- "Mirae Asset", "HDFC", etc.
    category       TEXT,                   -- "Large Cap", "ELSS", "Flexi Cap"
    sub_category   TEXT,
    expense_ratio  FLOAT,
    aum_cr         FLOAT,
    benchmark      TEXT,
    is_direct      BOOLEAN DEFAULT false,
    is_growth      BOOLEAN DEFAULT true,
    is_active      BOOLEAN DEFAULT true,
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);
```

### `mf_navs`

```sql
CREATE TABLE mf_navs (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id  UUID REFERENCES mutual_funds(id) ON DELETE CASCADE,
    date     DATE NOT NULL,
    nav      FLOAT NOT NULL,
    UNIQUE(fund_id, date)
);

CREATE INDEX idx_mf_navs_fund_date ON mf_navs(fund_id, date DESC);
```

### `news`

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
    related_symbols TEXT[],               -- e.g. ARRAY['RELIANCE', 'ONGC']
    processed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_symbols ON news USING gin(related_symbols);
CREATE INDEX idx_news_published ON news(published_at DESC);
```

The GIN index on `related_symbols` makes `WHERE 'RELIANCE' = ANY(related_symbols)` fast.

### `portfolio_holdings`

RLS enabled: users can only read/write their own rows.

```sql
CREATE TABLE portfolio_holdings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol          TEXT NOT NULL,
    instrument_type TEXT CHECK (instrument_type IN ('stock', 'mf')),
    quantity        FLOAT NOT NULL,
    avg_buy_price   FLOAT NOT NULL,
    current_value   FLOAT,               -- updated by nightly pipeline
    unrealised_pnl  FLOAT GENERATED ALWAYS AS (
                        current_value - (quantity * avg_buy_price)
                    ) STORED,
    buy_date        DATE,
    broker          TEXT,                -- "zerodha", "groww", "upstox", "other"
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own holdings" ON portfolio_holdings
    FOR ALL USING (auth.uid() = user_id);
```

### `user_profiles`

```sql
CREATE TABLE user_profiles (
    id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    investment_style TEXT CHECK (investment_style IN ('value', 'growth', 'dividend')),
    onboarding_done  BOOLEAN DEFAULT false,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own profile" ON user_profiles
    FOR ALL USING (auth.uid() = id);
```

A Supabase trigger auto-creates a `user_profiles` row when a new user signs up:

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

---

## 6. AI Orchestration Layer

All AI flows live in `backend/services/ai_service.py`. One Gemini Flash client, four functions.

### Setup

```python
import google.generativeai as genai
import json
import asyncio

genai.configure(api_key=settings.GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-2.0-flash")
```

---

### Feature 1: NL → Filter Translation

**The single most important prompt you will write.** This is what makes the product feel magical.

**The approach — two-stage prompting:**

Stage 1 (intent extraction): Let Gemini "think" in natural language about what the user wants.
Stage 2 (structured output): Convert the intent to a strict JSON filter object.

You can do this in a single prompt with chain-of-thought, but suppress the reasoning in the output:

```python
NL_TO_FILTER_PROMPT = """
You are a filter parser for an Indian stock screener.

AVAILABLE FILTERS:
- market_cap_category: "large" (>20,000 Cr) | "mid" (5,000-20,000 Cr) | "small" (500-5,000 Cr) | "micro" (<500 Cr)
- min_pe / max_pe: number (P/E ratio)
- min_pb / max_pb: number (P/B ratio)
- min_roe / max_roe: number (percentage, e.g. 15 means 15%)
- min_roce / max_roce: number (percentage)
- max_debt_to_equity: number (ratio, e.g. 0.5 means 0.5x)
- min_net_margin: number (percentage)
- min_dividend_yield: number (percentage)
- sector: one of exactly — "IT", "Banking", "FMCG", "Pharma", "Auto", "Energy",
  "Metals", "Infrastructure", "Real Estate", "Chemicals", "Telecom", "Financial Services"
- exclude_loss_making: boolean (true removes companies with negative net profit)

RULES:
1. Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Only include filters explicitly implied by the user's query.
3. "Low debt" → max_debt_to_equity: 0.5
4. "Profitable" or "profit-making" → exclude_loss_making: true
5. "High ROE" → min_roe: 15 (use 15 as default threshold unless specified)
6. "Undervalued" → max_pe: 15
7. "Dividend stocks" → min_dividend_yield: 2
8. "Small-cap" → market_cap_category: "small"
9. "Blue chips" or "Large-cap" → market_cap_category: "large"
10. If ambiguous, use conservative defaults. If completely unclear, return {}.

EXAMPLES:
Query: "show me profitable small-caps with low debt"
Output: {"market_cap_category": "small", "exclude_loss_making": true, "max_debt_to_equity": 0.5}

Query: "IT companies with high ROE and low PE"
Output: {"sector": "IT", "min_roe": 15, "max_pe": 20}

Query: "dividend paying pharma stocks"
Output: {"sector": "Pharma", "min_dividend_yield": 2}

Query: "undervalued banking stocks with good margins"
Output: {"sector": "Banking", "max_pe": 15, "min_net_margin": 10}

USER QUERY: {user_query}
OUTPUT:
"""
```

**Why this prompt works:**
- Explicit enumeration of all valid filter keys prevents hallucinated keys
- Concrete examples (few-shot) are more reliable than abstract rules
- The sector list is exhaustive — model can't invent "Healthcare" instead of "Pharma"
- Conservative defaults prevent over-filtering (returning 0 results is a terrible UX)

**Validation layer in FastAPI** — always validate before sending to the screener:

```python
VALID_FILTER_KEYS = {
    "market_cap_category", "min_pe", "max_pe", "min_pb", "max_pb",
    "min_roe", "max_roe", "min_roce", "max_roce", "max_debt_to_equity",
    "min_net_margin", "min_dividend_yield", "sector", "exclude_loss_making"
}
VALID_SECTORS = {"IT", "Banking", "FMCG", "Pharma", "Auto", "Energy",
                 "Metals", "Infrastructure", "Real Estate", "Chemicals",
                 "Telecom", "Financial Services"}

def validate_filter_output(raw_json: dict) -> dict:
    cleaned = {}
    for key, value in raw_json.items():
        if key not in VALID_FILTER_KEYS:
            continue  # silently drop hallucinated keys
        if key == "sector" and value not in VALID_SECTORS:
            continue  # drop invalid sector
        if key == "market_cap_category" and value not in {"large", "mid", "small", "micro"}:
            continue
        cleaned[key] = value
    return cleaned
```

---

### Feature 2: Stock Card AI Explanation (Streaming)

```python
STOCK_EXPLANATION_PROMPTS = {
    "value": """
You are a value investing analyst focused on Indian equities.
In 3-4 sentences, explain why this stock appears in the screener results and assess it
through a value investing lens. Mention PE vs sector, balance sheet quality, and ROE.
Avoid generic statements. Be direct. Do not say "Buy" or "Sell".
End with one risk flag if applicable.

Stock: {name} ({symbol})
Sector: {sector}
PE: {pe} (Sector avg: {sector_pe_avg})
PB: {pb}
ROE: {roe}%
D/E: {debt_to_equity}
Net Margin: {net_margin}%
1Y Return: {return_1y}%
""",
    "growth": """
You are a growth investing analyst focused on Indian equities.
In 3-4 sentences, explain why this stock appears in the screener results.
Focus on revenue trajectory, ROE trend, and margin expansion.
Do not say "Buy" or "Sell". Be direct and specific to the numbers.

Stock: {name} ({symbol})
Sector: {sector}
Revenue Growth (1Y): {revenue_growth}%
ROE: {roe}%
ROCE: {roce}%
Net Margin: {net_margin}%
PE: {pe}
""",
    "dividend": """
You are a dividend investing analyst focused on Indian equities.
In 3-4 sentences, explain why this stock appears in the screener results.
Focus on dividend yield sustainability, payout history, and balance sheet strength.
Do not say "Buy" or "Sell".

Stock: {name} ({symbol})
Dividend Yield: {dividend_yield}%
D/E: {debt_to_equity}
Net Profit (TTM): ₹{net_profit_cr} Cr
PE: {pe}
"""
}

async def stream_stock_explanation(symbol: str, investment_style: str, fundamentals: dict):
    prompt = STOCK_EXPLANATION_PROMPTS[investment_style].format(**fundamentals)
    
    async def generate():
        response = model.generate_content(prompt, stream=True)
        for chunk in response:
            if chunk.text:
                yield f"data: {json.dumps({'token': chunk.text})}\n\n"
        yield "data: [DONE]\n\n"
    
    return generate()
```

**FastAPI SSE endpoint:**

```python
from fastapi.responses import StreamingResponse

@router.post("/ai/explain-stock")
async def explain_stock(request: ExplainRequest):
    fundamentals = await db.get_fundamentals(request.symbol)
    user_profile = await db.get_user_profile(request.user_id)
    
    stream = await ai_service.stream_stock_explanation(
        request.symbol,
        user_profile.investment_style,
        fundamentals
    )
    
    return StreamingResponse(stream, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
```

**Next.js SSE consumption:**

```typescript
// hooks/useStockExplanation.ts
export function useStockExplanation(symbol: string) {
    const [explanation, setExplanation] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);

    useEffect(() => {
        setIsStreaming(true);
        const response = await fetch(`/api/ai/explain-stock`, {
            method: "POST",
            body: JSON.stringify({ symbol }),
        });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split("\n");
            for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                    const data = JSON.parse(line.slice(6));
                    setExplanation(prev => prev + data.token);
                }
            }
        }
        setIsStreaming(false);
    }, [symbol]);

    return { explanation, isStreaming };
}
```

---

### Feature 3: Side-by-Side Comparison

The response has two parts: a structured diff object (for rendering the comparison table) and a streaming narrative. Send them together — structured data first, then stream the narrative.

```python
COMPARISON_PROMPT = """
Compare these two Indian stocks for an investor with a {investment_style} focus.

{name_a} ({symbol_a}):
PE: {pe_a} | PB: {pb_a} | ROE: {roe_a}% | D/E: {de_a} | Net Margin: {margin_a}%

{name_b} ({symbol_b}):
PE: {pe_b} | PB: {pb_b} | ROE: {roe_b}% | D/E: {de_b} | Net Margin: {margin_b}%

First, output a JSON object on a single line with this exact structure:
{{"winner_pe": "{symbol_a or symbol_b}", "winner_roe": "...", "winner_de": "...",
  "winner_margin": "...", "overall_winner": "...", "confidence": "high|medium|low"}}

Then, on a new line, write 3-4 sentences comparing them from a {investment_style} perspective.
No "Buy" or "Sell". Be direct. State which you'd watch more closely and why.
End with one key risk for each.
"""
```

**Parsing the dual response:**

```python
async def compare_stocks(symbol_a: str, symbol_b: str, investment_style: str):
    # ... build context ...
    response = model.generate_content(prompt, stream=True)
    full_text = ""
    
    async def generate():
        nonlocal full_text
        for chunk in response:
            full_text += chunk.text
            # Extract structured JSON from first line when we have it
            if '\n' in full_text and not sent_structured:
                first_line = full_text.split('\n')[0]
                try:
                    structured = json.loads(first_line)
                    yield f"data: {json.dumps({'type': 'structured', 'data': structured})}\n\n"
                    sent_structured = True
                except:
                    pass
            # Stream the narrative tokens
            if sent_structured:
                yield f"data: {json.dumps({'type': 'token', 'text': chunk.text})}\n\n"
        yield "data: [DONE]\n\n"
    
    return generate()
```

---

### Feature 4: News Sentiment (Pipeline, Not Request-Time)

```python
async def batch_sentiment_analysis(articles: list[dict]) -> list[dict]:
    # Process in batches of 25
    for i in range(0, len(articles), 25):
        batch = articles[i:i+25]
        headlines = [{"id": a["id"], "headline": a["headline"], "summary": a.get("summary", "")}
                     for a in batch]
        
        prompt = SENTIMENT_PROMPT.format(headlines_json=json.dumps(headlines, ensure_ascii=False))
        response = model.generate_content(prompt)
        
        try:
            results = json.loads(response.text.strip())
            # Upsert results to DB
            await db.upsert_sentiment(results)
        except json.JSONDecodeError:
            logger.error(f"Sentiment parse failed for batch {i}")
            continue
        
        await asyncio.sleep(1)  # Rate limit — Gemini Flash free tier: 15 RPM
```

---

### Feature 5: CSV Portfolio Import (Gemini-Assisted)

```python
CSV_PARSE_PROMPT = """
Identify the broker format of this CSV/XLSX export and extract holdings.

First 5 rows (raw):
{raw_rows}

Known broker formats:
- Zerodha tradebook: columns trade_date, trade_type (buy/sell), symbol, quantity, price
  → Must aggregate buys/sells to get net position and average cost
- Groww portfolio: columns stock_name, quantity, avg_cost, current_value
  → Direct read, no aggregation needed
- Upstox: columns instrument, quantity, buy_avg_price
- Generic: may have symbol/ticker, qty/quantity, avg_price/buy_price

Return JSON only:
{
    "broker": "zerodha" | "groww" | "upstox" | "generic",
    "holdings": [
        {"symbol": "RELIANCE", "quantity": 10, "avg_buy_price": 2450.50},
        ...
    ]
}

Rules:
- NSE symbols only (strip .NS suffix if present)
- quantity must be positive (net long position)
- avg_buy_price in INR
- Skip mutual funds for now (focus on equities only in this parse)
- Return {} if format is unrecognisable
"""

async def parse_portfolio_csv(file_bytes: bytes, filename: str) -> list[dict]:
    # Read first 5 rows as text for format detection
    if filename.endswith('.xlsx'):
        df = pd.read_excel(BytesIO(file_bytes), nrows=5)
    else:
        df = pd.read_csv(BytesIO(file_bytes), nrows=5)
    
    raw_rows = df.to_string()
    prompt = CSV_PARSE_PROMPT.format(raw_rows=raw_rows)
    
    response = model.generate_content(prompt)
    result = json.loads(response.text.strip())
    
    return result.get("holdings", [])
```

---

## 7. API Design

### FastAPI Route Structure

```
backend/
├── main.py
├── routers/
│   ├── stocks.py          GET /api/stocks/screen, /api/stocks/{symbol}
│   ├── mf.py              GET /api/mf/screen, /api/mf/{scheme_code}
│   ├── ai.py              POST /api/ai/parse-query, explain-stock, compare
│   ├── portfolio.py       POST /api/portfolio/upload, GET /api/portfolio
│   └── auth.py            POST /api/auth/onboarding
└── services/
    ├── ai_service.py
    ├── data_service.py
    └── cache_service.py
```

### Endpoint Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/stocks/screen` | No | Filter + paginate stocks |
| GET | `/api/stocks/{symbol}` | No | Full stock detail |
| GET | `/api/stocks/{symbol}/news` | No | News + sentiment for stock |
| GET | `/api/mf/screen` | No | Filter MFs |
| GET | `/api/mf/{scheme_code}` | No | Full MF detail |
| GET | `/api/compare` | No | Structured diff data |
| POST | `/api/ai/parse-query` | No | NL → filter JSON |
| POST | `/api/ai/explain-stock` | Optional | SSE streaming explanation |
| POST | `/api/ai/compare` | Optional | SSE streaming comparison narrative |
| POST | `/api/portfolio/upload` | Required | CSV upload → parse → save |
| GET | `/api/portfolio` | Required | User's holdings + P&L |
| POST | `/api/auth/onboarding` | Required | Set investment style |

### `GET /api/stocks/screen` — Filter Query Builder

```python
@router.get("/stocks/screen")
async def screen_stocks(
    market_cap_category: str = None,
    min_pe: float = None, max_pe: float = None,
    min_roe: float = None, max_roe: float = None,
    max_debt_to_equity: float = None,
    min_net_margin: float = None,
    min_dividend_yield: float = None,
    sector: str = None,
    exclude_loss_making: bool = False,
    sort_by: str = "market_cap_cr",
    sort_dir: str = "desc",
    page: int = 1, limit: int = 50
):
    # Build cache key from all filter params
    cache_key = f"screen:{hash(str(locals()))}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)
    
    # Build dynamic Supabase query
    query = supabase.table("stocks").select(
        "*, stock_fundamentals(*)"
    ).eq("is_active", True)
    
    if sector: query = query.eq("sector", sector)
    if min_roe: query = query.gte("stock_fundamentals.roe", min_roe)
    if max_pe: query = query.lte("stock_fundamentals.pe", max_pe)
    # ... etc
    
    result = query.order(sort_by, desc=(sort_dir=="desc")).range(
        (page-1)*limit, page*limit-1
    ).execute()
    
    await redis.setex(cache_key, 1800, json.dumps(result.data))  # 30 min TTL
    return result.data
```

---

## 8. UI/UX Architecture & Component Structure

### Page Routes (Next.js App Router)

```
app/
├── page.tsx                    → Landing page
├── screener/
│   └── page.tsx                → Main two-panel screener
├── mf/
│   └── page.tsx                → MF screener
├── stock/
│   └── [symbol]/
│       └── page.tsx            → Stock detail page
├── compare/
│   └── page.tsx                → Comparison tool
├── portfolio/
│   └── page.tsx                → Portfolio tracker
└── auth/
    ├── login/page.tsx
    └── signup/page.tsx         → Includes onboarding step
```

### Component Architecture

```
components/
├── screener/
│   ├── ScreenerLayout.tsx         # Two-panel shell, handles split/mobile toggle
│   ├── FilterPanel.tsx            # Left: all filter controls
│   ├── FilterSection.tsx          # Collapsible section (Valuation, Fundamentals...)
│   ├── FilterSlider.tsx           # Individual range slider with min/max inputs
│   ├── ResultsTable.tsx           # Paginated stock results
│   ├── StockCard.tsx              # THE core reusable unit — see below
│   └── ChatPanel.tsx              # Right: AI chat interface
├── chat/
│   ├── ChatThread.tsx             # Message list with auto-scroll
│   ├── ChatInput.tsx              # Input box + send button
│   ├── ChatMessage.tsx            # Routes to correct message type
│   └── messages/
│       ├── TextMessage.tsx        # Plain text response
│       ├── StockCardMessage.tsx   # Stock card embedded in chat
│       ├── FilterAppliedMessage.tsx # "Applied 3 filters" confirmation
│       └── ComparisonMessage.tsx  # Comparison table in chat
├── stock/
│   ├── StockCard.tsx              # Reused from screener + chat
│   ├── FundamentalsGrid.tsx       # Key metrics in grid layout
│   ├── NewsFeed.tsx               # News + sentiment badges
│   └── PriceChart.tsx             # Simple EOD price chart (Recharts)
├── mf/
│   ├── MFCard.tsx
│   └── MFComparisonTable.tsx
├── portfolio/
│   ├── CSVUploader.tsx
│   ├── HoldingsTable.tsx
│   └── PnLSummary.tsx
└── ui/                            # Generic design system components
    ├── Badge.tsx
    ├── SentimentBadge.tsx
    └── StreamingText.tsx          # Renders SSE token stream progressively
```

### The Two-Panel Screener Layout

**Desktop (≥768px):** Side by side, 60/40 split.

```tsx
// components/screener/ScreenerLayout.tsx
export default function ScreenerLayout() {
    const [filters, setFilters] = useState<Filters>({});
    const [chatContext, setChatContext] = useState<ChatContext | null>(null);

    // When AI parses a query, it calls this to update the left panel
    const applyFiltersFromAI = (newFilters: Filters) => {
        setFilters(newFilters);
        setChatContext({ appliedFilters: newFilters });
    };

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Left panel — screener */}
            <div className="w-3/5 flex flex-col border-r overflow-y-auto">
                <FilterPanel filters={filters} onChange={setFilters} />
                <ResultsTable filters={filters} />
            </div>

            {/* Right panel — AI chat */}
            <div className="w-2/5 flex flex-col">
                <ChatPanel
                    currentFilters={filters}
                    onFiltersApplied={applyFiltersFromAI}
                />
            </div>
        </div>
    );
}
```

**Mobile (<768px):** Tab-based, chat-first.

```tsx
// Same component, different rendering below 768px via Tailwind
<div className="md:hidden fixed bottom-0 left-0 right-0 flex border-t bg-background">
    <button onClick={() => setActiveTab('chat')}
            className={activeTab === 'chat' ? 'text-primary' : 'text-muted'}>
        Chat
    </button>
    <button onClick={() => setActiveTab('screener')}
            className={activeTab === 'screener' ? 'text-primary' : 'text-muted'}>
        Screener
    </button>
</div>
```

### StockCard — The Core UI Unit

This component is used in three contexts: screener results table rows, chat panel embedded responses, and the comparison tool. It must work in all three with minor prop variations.

```tsx
// components/stock/StockCard.tsx
interface StockCardProps {
    symbol: string;
    name: string;
    sector: string;
    metrics: {
        pe: number; roe: number; debtToEquity: number;
        marketCapCr: number; return1y: number; netMargin: number;
    };
    variant: "table-row" | "chat-embed" | "detail";
    investmentStyle: "value" | "growth" | "dividend";
}

export default function StockCard({ symbol, name, sector, metrics, variant, investmentStyle }: StockCardProps) {
    const { explanation, isStreaming } = useStockExplanation(symbol, investmentStyle);

    return (
        <div className={`stock-card stock-card--${variant}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <span className="font-semibold text-base">{symbol}</span>
                    <span className="text-muted text-sm ml-2">{name}</span>
                </div>
                <Badge variant="sector">{sector}</Badge>
            </div>

            {/* Key metrics — 5 pills */}
            <div className="metrics-grid">
                <Metric label="PE" value={metrics.pe} />
                <Metric label="ROE" value={`${metrics.roe}%`} />
                <Metric label="D/E" value={metrics.debtToEquity} />
                <Metric label="Mkt Cap" value={`₹${formatCrores(metrics.marketCapCr)}`} />
                <Metric label="1Y Ret" value={`${metrics.return1y}%`}
                        color={metrics.return1y >= 0 ? "green" : "red"} />
            </div>

            {/* AI explanation — streams in */}
            <div className="ai-explanation">
                <StreamingText text={explanation} isStreaming={isStreaming} />
            </div>

            {/* Disclaimer */}
            <p className="disclaimer text-xs text-muted">
                Educational insight only. Not investment advice.
            </p>
        </div>
    );
}
```

### StreamingText Component

```tsx
// components/ui/StreamingText.tsx
export default function StreamingText({ text, isStreaming }: { text: string; isStreaming: boolean }) {
    return (
        <p className="text-sm text-secondary leading-relaxed">
            {text}
            {isStreaming && (
                <span className="inline-block w-1 h-3 ml-0.5 bg-current animate-pulse" />
            )}
        </p>
    );
}
```

### Chat Message Routing

```tsx
// components/chat/ChatMessage.tsx
export default function ChatMessage({ message }: { message: Message }) {
    switch (message.type) {
        case "text":
            return <TextMessage content={message.content} />;
        case "filter_applied":
            return <FilterAppliedMessage filters={message.filters} resultCount={message.count} />;
        case "stock_card":
            return <StockCard {...message.stock} variant="chat-embed" />;
        case "comparison":
            return <ComparisonMessage data={message.comparison} />;
        default:
            return <TextMessage content={message.content} />;
    }
}
```

### State Management Strategy

Use **Zustand** (not Redux — too heavy for solo dev). Three stores:

```typescript
// store/screenerStore.ts
interface ScreenerState {
    filters: Filters;
    results: Stock[];
    isLoading: boolean;
    setFilters: (filters: Filters) => void;  // called by both filter UI and AI
    fetchResults: () => Promise<void>;
}

// store/chatStore.ts
interface ChatState {
    messages: Message[];
    isAIThinking: boolean;
    addMessage: (msg: Message) => void;
    sendQuery: (query: string) => Promise<void>;
}

// store/userStore.ts
interface UserState {
    user: User | null;
    investmentStyle: "value" | "growth" | "dividend";
    setInvestmentStyle: (style: string) => void;
}
```

The key insight: `screenerStore.setFilters` is called by both the manual filter UI (when user drags a slider) AND by the chat panel (when AI returns a filter object). This single shared action is what makes the two-panel feel like one coherent experience.

---

## 9. Screener.in Scraping Strategy

This is your biggest operational risk. Screener.in doesn't have a public API, and they actively watch for bot traffic. Here's how to do it responsibly and reliably.

### What You're Scraping

Screener.in's company page (`https://www.screener.in/company/RELIANCE/`) contains everything in structured HTML. The key data lives in `<li>` elements in the `#top-ratios` section and in the `#annual-reports` table.

```python
from bs4 import BeautifulSoup
import requests

def parse_company_page(html: str, symbol: str) -> dict:
    soup = BeautifulSoup(html, 'lxml')
    
    ratios = {}
    for li in soup.select('#top-ratios li'):
        name = li.select_one('.name')
        value = li.select_one('.nowrap')
        if name and value:
            ratios[name.text.strip()] = value.text.strip()
    
    return {
        "symbol": symbol,
        "pe": parse_float(ratios.get("Stock P/E")),
        "pb": parse_float(ratios.get("Price to Book")),
        "roe": parse_float(ratios.get("Return on Equity")),
        "roce": parse_float(ratios.get("ROCE")),
        "debt_to_equity": parse_float(ratios.get("Debt to equity")),
        "net_margin": parse_float(ratios.get("Net profit margin")),
    }
```

### Anti-Detection Measures

**1. Respect robots.txt.** Screener's robots.txt disallows `/api/` but generally allows `/company/`. Read it fresh at the start of each scraping run.

**2. Session-based scraping with realistic headers:**

```python
import requests
from requests.adapters import HTTPAdapter

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.screener.in/",
})
```

**3. Conservative rate limiting:**

```python
import time
import random

async def scrape_with_delay(symbols: list[str]):
    for i, symbol in enumerate(symbols):
        url = f"https://www.screener.in/company/{symbol}/"
        
        try:
            response = session.get(url, timeout=15)
            if response.status_code == 429:
                # Rate limited — back off hard
                wait = 300 + random.uniform(0, 60)  # 5-6 minutes
                logger.warning(f"Rate limited. Waiting {wait:.0f}s")
                time.sleep(wait)
                continue
            
            if response.status_code == 200:
                data = parse_company_page(response.text, symbol)
                await db.upsert_fundamentals(data)
        
        except requests.RequestException as e:
            logger.error(f"Failed {symbol}: {e}")
            continue
        
        # Random delay: 3-7 seconds between requests
        time.sleep(random.uniform(3, 7))
        
        # Longer pause every 50 stocks
        if (i + 1) % 50 == 0:
            time.sleep(random.uniform(60, 120))
```

At 5 seconds average delay × 5,000 stocks = ~7 hours for a full scrape. That's fine for a weekly Sunday run. Schedule it at 2 AM IST Sunday.

**4. Prioritised scraping — not all 5,000 stocks equally:**

```python
PRIORITY_TIERS = {
    "tier_1": 500,    # Nifty 500 — scrape weekly
    "tier_2": 2000,   # Next 2,000 by market cap — scrape monthly
    "tier_3": None,   # Everything else — scrape quarterly
}
```

This means in a typical week you're scraping ~500 stocks (not 5,000), which takes 45 minutes — far more manageable.

**5. Graceful degradation:**

When Screener.in is unavailable or blocks you, fall back to yfinance for PE and PB (available for most stocks). Mark fundamentals as `source: "yfinance"` vs `source: "screener"` in the DB so you know the data quality.

**6. The exit plan:**

Once you have traction, migrate to a paid fundamentals provider. [Dalalstreet.io](https://dalalstreet.io) and [Ticker API](https://ticker.finology.in) both offer affordable plans (~$20-50/month) with official API access to all the data you're currently scraping. Budget this into your monetisation plan.

---

## 10. Cost Breakdown

### MVP Phase (0–500 users/month)

| Service | Free Tier | Estimated Cost |
|---------|-----------|----------------|
| Vercel (Next.js hosting) | 100GB bandwidth/month | $0 |
| Railway (FastAPI backend) | $5 credit/month | ~$0–5 |
| Supabase (PostgreSQL + Auth) | 500MB DB, 50,000 auth users | $0 |
| Upstash Redis | 10,000 commands/day | $0 |
| GitHub Actions (pipeline) | 2,000 min/month | $0 |
| Google AI Studio (Gemini Flash) | 1,500 requests/day free | $0 |
| **Total** | | **$0–5/month** |

### Growth Phase (500–5,000 users/month)

| Service | Estimated Cost |
|---------|---------------|
| Vercel Pro | $20/month |
| Railway (more compute) | $10–20/month |
| Supabase Pro | $25/month (8GB DB) |
| Upstash Redis | $10/month |
| Gemini Flash (pay-as-you-go) | ~$30–80/month |
| **Total** | **~$95–155/month** |

### LLM cost model

Gemini Flash 2.0 pricing (as of early 2025): ~$0.075 per 1M input tokens, $0.30 per 1M output tokens.

- NL→filter: ~200 input tokens + 50 output = negligible
- Stock explanation: ~300 input + 150 output = ~$0.00007 per explanation
- Comparison: ~500 input + 300 output = ~$0.00013 per comparison
- Sentiment batch (25 articles): ~1,000 input + 200 output = ~$0.00014 per batch

At 1,000 DAU × 10 AI interactions/day: **~$0.70–2.00/day = ~$21–60/month**.

---

## 11. MVP Build Timeline (3 Months, Solo)

### Month 1 — Foundation & Core Screener

**Week 1–2: Infrastructure**
- Supabase project setup — all 7 tables + RLS policies + auth trigger
- FastAPI skeleton — project structure, Supabase client, env config, Railway deployment
- Next.js skeleton — App Router, Tailwind, Zustand stores, Vercel deployment
- GitHub Actions cron — skeleton pipeline that runs and writes to DB

**Week 3: Data pipeline**
- `fetch_prices.py` — yfinance EOD ingestion for Nifty 500
- `fetch_mf_navs.py` — AMFI parser and upsert
- `fetch_news.py` — RSS parsing (no sentiment yet)
- Verify data flowing into Supabase

**Week 4: Screener core**
- `/api/stocks/screen` with filter query builder
- Filter panel UI (no AI yet)
- Results table with basic StockCard (no AI explanation yet)
- Redis caching for screener queries

### Month 2 — AI Layer & MF Features

**Week 5–6: AI features**
- Gemini Flash integration — `ai_service.py`
- NL→filter endpoint + system prompt (iterate until reliable)
- Chat panel UI — message types, filter-applied feedback
- Stock card AI explanation — SSE streaming end-to-end
- News sentiment in pipeline — batch sentiment processing

**Week 7: MF screener**
- `/api/mf/screen` endpoint
- MF card component
- Comparison tool — structured diff + AI narrative
- Screener.in fundamentals scraper (weekly cron)

**Week 8: Auth + Onboarding**
- Google OAuth + email/password via Supabase Auth
- Onboarding flow — investment style selection
- AI explanation variants by investment style
- Gating AI features behind login

### Month 3 — Portfolio, Polish & Beta

**Week 9–10: Portfolio tracker**
- CSV upload endpoint — Gemini-assisted broker format detection
- Holdings table + P&L calculation
- Nightly portfolio value update in pipeline

**Week 11: Mobile + polish**
- Mobile layout — chat-first tab navigation
- Loading states, error boundaries, empty states
- Disclaimer banners on all AI outputs
- Performance — pagination, lazy loading stock cards

**Week 12: Beta launch**
- Deploy to production, test with 10–20 real users
- Monitor Gemini costs, pipeline reliability, scraper health
- Get legal review of AI output framing (SEBI gray area)

---

## Appendix: Key Files to Create First

When you sit down to start building, create these files in this order:

```
1. supabase/migrations/001_initial_schema.sql   ← All 7 tables + indexes + RLS
2. backend/services/ai_service.py               ← Gemini client + 4 functions
3. backend/routers/ai.py                        ← SSE streaming endpoints
4. frontend/store/screenerStore.ts              ← Shared filter state
5. frontend/components/screener/ScreenerLayout.tsx  ← Two-panel shell
6. frontend/components/stock/StockCard.tsx      ← Core reusable unit
7. pipeline/fetch_prices.py                     ← First data flowing into DB
```

Get data flowing before building UI. A screener with real data and ugly UI is more useful than a beautiful screener with no data.

---

*Document compiled from design session — screener-ai v1.0 design freeze*
*Next step: Begin Supabase schema migration*

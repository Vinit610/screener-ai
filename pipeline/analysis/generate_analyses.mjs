#!/usr/bin/env node
/**
 * generate_analyses.mjs
 *
 * Daily pipeline script that:
 *  1. Fetches all active stocks from Supabase
 *  2. For each stock, fetches live data from yahoo-finance2
 *  3. Calls Groq LLM for structured analysis JSON
 *  4. Upserts the result into stock_ai_analyses
 *
 * Usage:
 *   node generate_analyses.mjs                      # all active stocks
 *   node generate_analyses.mjs --symbol INFY         # single stock
 *   node generate_analyses.mjs --symbols INFY,TCS    # multiple stocks
 *   node generate_analyses.mjs --limit 10            # first N stocks
 *
 * Environment Variables:
 *   PIPELINE_SUPABASE_URL                 - Supabase project URL
 *   PIPELINE_SUPABASE_SERVICE_ROLE_KEY   - Supabase service role key
 *   GROQ_API_KEY                          - Groq API key from https://console.groq.com
 */

import { createClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import { buildDataContext, buildAnalysisPrompt, PROMPT_VERSION } from "./prompts.mjs";

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.PIPELINE_SUPABASE_URL;
const SUPABASE_KEY = process.env.PIPELINE_SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing required env vars: PIPELINE_SUPABASE_URL, PIPELINE_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!GROQ_API_KEY) {
  console.error("Missing required env var: GROQ_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const yahooFinance = new YahooFinance();

// Groq LLM API endpoint
const LLM_API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Rate limiting
// Groq llama-3.3-70b-versatile: 30 RPM (2 sec/request) + 1K RPD
// Using 10000ms to safely account for network latency and retries
const DELAY_BETWEEN_STOCKS_MS = 10000; // ~1.5 stocks/min (well under 30 RPM limit)
const MAX_RETRIES = 2;

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { symbol: null, symbols: null, limit: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--symbol" && args[i + 1]) parsed.symbol = args[++i].toUpperCase();
    if (args[i] === "--symbols" && args[i + 1]) parsed.symbols = args[++i].toUpperCase().split(",");
    if (args[i] === "--limit" && args[i + 1]) parsed.limit = parseInt(args[++i], 10);
  }
  return parsed;
}

/**
 * Fetch comprehensive data from yahoo-finance2 for a single stock.
 */
async function fetchYahooData(symbol) {
  const yahooSymbol = `${symbol}.NS`;

  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  
  const [quote, chart] = await Promise.all([
    yahooFinance.quoteSummary(yahooSymbol, {
      modules: [
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "price",
        "summaryProfile",
        "earningsTrend",
        "earningsHistory",
        "recommendationTrend",
        "industryTrend",
        "insiderTransactions",
        "institutionOwnership",
        "majorHoldersBreakdown",
        "assetProfile",
      ],
    }),
    yahooFinance.chart(yahooSymbol, {
      period1: oneYearAgo.toISOString().slice(0, 10),
      interval: "1d",
    }).catch(() => null),
  ]);

  // Note: Historical income/balance/cash statements removed from quoteSummary
  // as they provide almost no data since Nov 2024. If needed, can fetch via
  // fundamentalsTimeSeries with correct module names when API stabilizes.
  const fundamentals = null;

  return {
    quote,
    financialData: quote.financialData,
    fundamentals,
    chart,
  };
}

/**
 * Fetch sector peers from DB for context.
 */
async function fetchPeers(stockId, sector) {
  if (!sector) return [];
  const { data } = await supabase
    .from("stocks")
    .select("symbol, market_cap_cr, id")
    .eq("sector", sector)
    .eq("is_active", true)
    .neq("id", stockId)
    .order("market_cap_cr", { ascending: false, nullsFirst: false })
    .limit(5);

  if (!data?.length) return [];

  // Fetch fundamentals for peers
  const peerIds = data.map((p) => p.id);
  const { data: fundData } = await supabase
    .from("stock_fundamentals")
    .select("stock_id, pe, roe")
    .in("stock_id", peerIds);

  const fundMap = Object.fromEntries((fundData || []).map((f) => [f.stock_id, f]));

  return data.map((p) => ({
    symbol: p.symbol,
    pe: fundMap[p.id]?.pe ?? null,
    roe: fundMap[p.id]?.roe != null ? fundMap[p.id].roe / 100 : null,
    marketCap: (p.market_cap_cr ?? 0) * 1_00_00_000, // back to raw for formatting
  }));
}

/**
 * Rotate old scores: shift current → 1d_ago, 1d_ago → 7d_ago, etc.
 */
async function rotateScores(stockId) {
  const { data: existing } = await supabase
    .from("stock_ai_analyses")
    .select("overall_score, score_1d_ago, score_7d_ago, generated_at")
    .eq("stock_id", stockId)
    .maybeSingle();

  if (!existing) return { score_1d_ago: null, score_7d_ago: null, score_30d_ago: null };

  const daysSince = (Date.now() - new Date(existing.generated_at).getTime()) / (1000 * 60 * 60 * 24);

  return {
    score_1d_ago: existing.overall_score,
    score_7d_ago: daysSince >= 7 ? existing.overall_score : existing.score_7d_ago,
    score_30d_ago: daysSince >= 30 ? existing.overall_score : existing.score_30d_ago,
  };
}

/**
 * Generate analysis for a single stock.
 */
async function generateForStock(stock) {
  const { id: stockId, symbol, sector } = stock;
  console.log(`  [${symbol}] Fetching yahoo-finance2 data...`);

  const yahoo = await fetchYahooData(symbol);
  const peers = await fetchPeers(stockId, sector);
  const dataContext = buildDataContext(symbol, yahoo.quote, yahoo.financialData, yahoo.fundamentals, yahoo.chart, peers);
  const prompt = buildAnalysisPrompt(dataContext);

  console.log(`  [${symbol}] Calling Groq LLM API...`);
  let analysisJson;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(LLM_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      const text = result.choices?.[0]?.message?.content;
      if (!text) throw new Error("No content in API response");

      analysisJson = JSON.parse(text);
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`  [${symbol}] LLM API attempt ${attempt + 1} failed: ${err.message}. Retrying...`);
      await sleep(3000 * (attempt + 1));
    }
  }

  // Validate basic structure
  if (!analysisJson?.overall_score || !analysisJson?.sections) {
    throw new Error(`Invalid analysis JSON structure for ${symbol}`);
  }

  // Score rotation
  const scores = await rotateScores(stockId);

  // Upsert into DB
  const { error } = await supabase
    .from("stock_ai_analyses")
    .upsert(
      {
        stock_id: stockId,
        analysis_json: analysisJson,
        overall_score: analysisJson.overall_score,
        prompt_version: PROMPT_VERSION,
        generated_at: new Date().toISOString(),
        ...scores,
      },
      { onConflict: "stock_id" }
    );

  if (error) throw new Error(`Supabase upsert failed for ${symbol}: ${error.message}`);
  console.log(`  [${symbol}] ✓ Score: ${analysisJson.overall_score}/100`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log("=== AI Stock Analysis Pipeline ===\n");

  // Determine which stocks to process
  let stocks;
  if (args.symbol) {
    const { data } = await supabase
      .from("stocks")
      .select("id, symbol, sector")
      .eq("symbol", args.symbol)
      .eq("is_active", true)
      .single();
    if (!data) {
      console.error(`Stock ${args.symbol} not found`);
      process.exit(1);
    }
    stocks = [data];
  } else if (args.symbols) {
    const { data } = await supabase
      .from("stocks")
      .select("id, symbol, sector")
      .in("symbol", args.symbols)
      .eq("is_active", true);
    stocks = data || [];
  } else {
    const { data } = await supabase
      .from("stocks")
      .select("id, symbol, sector")
      .eq("is_active", true)
      .order("market_cap_cr", { ascending: false, nullsFirst: false });
    stocks = data || [];
  }

  if (args.limit) stocks = stocks.slice(0, args.limit);

  console.log(`Processing ${stocks.length} stocks...\n`);

  let succeeded = 0;
  let failed = 0;
  const failures = [];

  for (const stock of stocks) {
    try {
      await generateForStock(stock);
      succeeded++;
    } catch (err) {
      console.error(`  [${stock.symbol}] ✗ ${err.message}`);
      failed++;
      failures.push(stock.symbol);
    }
    // Rate limit between stocks
    if (stocks.indexOf(stock) < stocks.length - 1) {
      await sleep(DELAY_BETWEEN_STOCKS_MS);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Pipeline Summary:`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failed}`);
  if (failures.length) console.log(`  Failures:  ${failures.join(", ")}`);
  console.log(`${"=".repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * generate_analyses.mjs
 *
 * Daily pipeline script that:
 *  1. Fetches all active stocks from Supabase
 *  2. For each stock, fetches live data from yahoo-finance2
 *  3. Calls LLM for structured analysis JSON (Groq or Mistral)
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
 *   LLM_PROVIDER                          - 'groq' (default) or 'mistral'
 *   MISTRAL_API_KEY                       - Mistral API key from https://console.mistral.ai
 *
 * Examples:
 *   # Using Mistral
 *   LLM_PROVIDER=mistral MISTRAL_API_KEY=xxx node generate_analyses.mjs
 */

import { createClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import { buildDataContext, buildAnalysisPrompt, computeQuantScore, PROMPT_VERSION } from "./prompts.mjs";

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.PIPELINE_SUPABASE_URL;
const SUPABASE_KEY = process.env.PIPELINE_SUPABASE_SERVICE_ROLE_KEY;
const LLM_PROVIDER = (process.env.LLM_PROVIDER || "groq").toLowerCase();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing required env vars: PIPELINE_SUPABASE_URL, PIPELINE_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Validate LLM provider and required keys
let LLM_API_ENDPOINT, LLM_API_KEY, LLM_MODEL;
if (!MISTRAL_API_KEY) {
  console.error("Missing required env var for Mistral: MISTRAL_API_KEY (from https://console.mistral.ai)");
  process.exit(1);
}
LLM_API_ENDPOINT = "https://api.mistral.ai/v1/chat/completions";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Rate limiting
// Groq: 30 RPM (2 sec/request) + 1K RPD
// Mistral: 200 RPM + 10K RPD
// Using 10000ms to safely account for network latency and retries (~1.5 stocks/min)
const DELAY_BETWEEN_STOCKS_MS = 10000;
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
 * Extract all available fundamentals directly from Yahoo quote
 */
function extractFundamentals(q) {
  const sd = q.summaryDetail ?? {};
  const ks = q.defaultKeyStatistics ?? {};
  const fd = q.financialData ?? {};
  const rec = q.recommendationTrend ?? {};
  const upgrades = q.upgradeDowngradeHistory ?? {};
  const insider = q.insiderTransactions ?? {};
  const calendar = q.calendarEvents ?? {};

  return {
    // Valuation
    pe: sd.trailingPE ?? null,
    pb: sd.priceToBook ?? null,
    peg: ks.pegRatio ?? null,
    ps: sd.priceToSalesTrailing12Months ?? null,
    ev_ebitda: ks.enterpriseToEbitda ?? null,
    
    // Profitability & Returns
    roe: fd.returnOnEquity ?? null,
    roa: fd.returnOnAssets ?? null,
    roce: fd.returnonCapital ?? null,
    net_margin: fd.profitMargins ?? null,
    operating_margin: fd.operatingMargins ?? null,
    gross_margin: fd.grossMargins ?? null,
    
    // Per Share Metrics
    eps: ks.trailingEps ?? null,
    forward_eps: ks.forwardEps ?? null,
    book_value: ks.bookValue ?? null,
    
    // Financial Position
    revenue_cr: fd.totalRevenue ? fd.totalRevenue / 1_00_00_000 : null,
    net_profit_cr: fd.netIncomeToCommon ? fd.netIncomeToCommon / 1_00_00_000 : null,
    debt_to_equity: fd.debtToEquity ?? null,
    current_ratio: fd.currentRatio ?? null,
    quick_ratio: fd.quickRatio ?? null,
    cash_to_debt: fd.totalCash && fd.totalDebt ? fd.totalCash / fd.totalDebt : null,
    
    // Growth
    revenue_growth: fd.revenueGrowth ?? null,
    earnings_growth: fd.earningsGrowth ?? null,
    free_cash_flow: fd.freeCashflow ? fd.freeCashflow / 1_00_00_000 : null,
    operating_cash_flow: fd.operatingCashflow ? fd.operatingCashflow / 1_00_00_000 : null,
    
    // Dividends
    dividend_yield: sd.dividendYield ?? null,
    payout_ratio: sd.payoutRatio ?? null,
    five_year_avg_dividend_yield: sd.fiveYearAvgDividendYield ?? null,
    
    // Analyst & Market Sentiment
    target_price: sd.targetMeanPrice ?? null,
    recommendation_key: rec.trend?.[0]?.strongBuy ? "Strong Buy" : 
                        rec.trend?.[0]?.buy ? "Buy" :
                        rec.trend?.[0]?.hold ? "Hold" :
                        rec.trend?.[0]?.sell ? "Sell" :
                        rec.trend?.[0]?.strongSell ? "Strong Sell" : null,
    number_of_analysts: rec.trend?.[0] ? 
      (rec.trend[0].strongBuy || 0) + (rec.trend[0].buy || 0) + (rec.trend[0].hold || 0) + 
      (rec.trend[0].sell || 0) + (rec.trend[0].strongSell || 0) : null,
    recent_upgrades: upgrades?.history?.slice(0, 3)?.length ?? 0,
    
    // Insider Activity
    insider_transactions_count: insider?.transactions?.length ?? 0,
    
    // Calendar Events
    next_earnings_date: calendar?.earnings?.[0]?.date ?? null,
    next_dividend_date: calendar?.dividends?.[0]?.date ?? null,
    
    // Technical
    fifty_two_week_high: sd.fiftyTwoWeekHigh ?? null,
    fifty_two_week_low: sd.fiftyTwoWeekLow ?? null,
    fifty_day_ma: sd.fiftyDayAverage ?? null,
    two_hundred_day_ma: sd.twoHundredDayAverage ?? null,
    beta: ks.beta ?? null,
  };
}

/**
 * Merge data from two exchanges, preferring primary (NSE) with fallback to secondary (BSE).
 * Use primary for price/volume data (more liquid), merge fundamentals intelligently.
 */
function mergeExchangeData(primaryData, secondaryData) {
  if (!secondaryData) return primaryData;

  const primary = primaryData ?? {};
  const secondary = secondaryData ?? {};

  // Merge fundamentals: use primary values, fallback to secondary for missing fields
  const mergeFundamentals = (primFund, secFund) => {
    if (!secFund) return primFund;
    const merged = { ...primFund };
    Object.keys(primFund).forEach((key) => {
      if (merged[key] === null && secFund[key] !== null) {
        merged[key] = secFund[key];
      }
    });
    return merged;
  };

  // For quote and financialData, use primary (more trusted), but add missing keys from secondary
  const mergeQuote = (primQuote, secQuote) => {
    if (!secQuote) return primQuote;
    const merged = { ...primQuote };
    const checkFields = ["summaryDetail", "defaultKeyStatistics", "financialData", "earningsTrend"];
    checkFields.forEach((field) => {
      if (!merged[field] || Object.keys(merged[field] || {}).length === 0) {
        merged[field] = secQuote[field];
      }
    });
    return merged;
  };

  // Merge timeSeries, preferring more data points
  const mergeTimeSeries = (primTS, secTS) => {
    if (!secTS) return primTS;
    return {
      incomeStatementHistory: [
        ...(primTS.incomeStatementHistory ?? []),
        ...(secTS.incomeStatementHistory ?? []).filter(
          (sec) =>
            !(primTS.incomeStatementHistory ?? []).some((p) => p.asOfDate === sec.asOfDate)
        ),
      ],
      balanceSheetHistory: [
        ...(primTS.balanceSheetHistory ?? []),
        ...(secTS.balanceSheetHistory ?? []).filter(
          (sec) =>
            !(primTS.balanceSheetHistory ?? []).some((p) => p.asOfDate === sec.asOfDate)
        ),
      ],
      cashflowStatementHistory: [
        ...(primTS.cashflowStatementHistory ?? []),
        ...(secTS.cashflowStatementHistory ?? []).filter(
          (sec) =>
            !(primTS.cashflowStatementHistory ?? []).some((p) => p.asOfDate === sec.asOfDate)
        ),
      ],
    };
  };

  return {
    quote: mergeQuote(primary.quote, secondary.quote),
    financialData: {
      ...primary.financialData,
      ...(secondary.financialData ?? {}),
    },
    fundamentals: mergeFundamentals(primary.fundamentals, secondary.fundamentals),
    timeSeries: mergeTimeSeries(primary.timeSeries, secondary.timeSeries),
    chart: primary.chart,
    impliedVolatility: primary.impliedVolatility ?? secondary.impliedVolatility,
    dataSource: { nse: !!primary.quote, bse: !!secondary.quote },
  };
}

/**
 * Fetch comprehensive data from yahoo-finance2 for a single stock.
 * Fetches from both NSE (.NS) and BSE (.BO) exchanges and merges the data.
 */
async function fetchYahooData(symbol) {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const period1 = oneYearAgo.toISOString().slice(0, 10);

  /**
   * Helper to fetch from a single exchange
   */
  async function fetchFromExchange(yahooSymbol) {
    try {
      // Build comprehensive request with all available modules to reduce N/A values
      const promises = [
        yahooFinance.quoteSummary(yahooSymbol, {
          modules: [
            // Valuation & Performance
            "summaryDetail",
            "defaultKeyStatistics",
            "financialData",
            "price",
            
            // Company Info
            "summaryProfile",
            "assetProfile",
            
            // Analyst & Market Data
            "earningsTrend",
            "earningsHistory",
            "recommendationTrend",
            "upgradeDowngradeHistory",
            "industryTrend",
            
            // Ownership & Activities
            "insiderTransactions",
            "insiderHolders",
            "institutionOwnership",
            "majorHoldersBreakdown",
            "netSharePurchaseActivity",
            
            // Events & Filings
            "calendarEvents",
            "secFilings",
            
            // Financial statements
            "incomeStatementHistory",
            "incomeStatementHistoryQuarterly",
            "balanceSheetHistory",
            "balanceSheetHistoryQuarterly",
            "cashflowStatementHistory",
            "cashflowStatementHistoryQuarterly",
          ],
        }).catch(() => null),
        
        yahooFinance.chart(yahooSymbol, {
          period1,
          interval: "1d",
        }).catch(() => null),
        
        // Try options data for volatility context
        yahooFinance.options(yahooSymbol).catch(() => null),
      ];

      // Fetch historical financial data from fundamentalsTimeSeries (both annual & quarterly for more data)
      for (const module of ["incomeStatement", "balanceSheet", "cashFlow"]) {
        promises.push(
          yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1, module }).catch(() => null)
        );
      }

      const [quote, chart, options, incomeStmts, balanceSheets, cashFlows] = await Promise.all(promises);

      if (!quote) return null;

      // Extract volatility from options if available
      let impliedVolatility = null;
      if (options?.puts && options.puts.length > 0) {
        const atmOption = options.puts.find(p => p.inTheMoney === false) || options.puts[0];
        impliedVolatility = atmOption?.impliedVolatility;
      } else if (options?.calls && options.calls.length > 0) {
        const atmOption = options.calls.find(c => c.inTheMoney === false) || options.calls[0];
        impliedVolatility = atmOption?.impliedVolatility;
      }

      return {
        quote,
        financialData: quote.financialData,
        fundamentals: extractFundamentals(quote),
        timeSeries: {
          incomeStatementHistory: incomeStmts?.timeSeries ?? [],
          balanceSheetHistory: balanceSheets?.timeSeries ?? [],
          cashflowStatementHistory: cashFlows?.timeSeries ?? [],
        },
        chart,
        impliedVolatility,
      };
    } catch (err) {
      console.warn(`    Could not fetch from ${yahooSymbol}: ${err.message}`);
      return null;
    }
  }

  console.log(`  [${symbol}] Fetching from both NSE (.NS) and BSE (.BO)...`);

  // Fetch from both exchanges in parallel
  const [nsData, bseData] = await Promise.all([
    fetchFromExchange(`${symbol}.NS`),
    fetchFromExchange(`${symbol}.BO`),
  ]);

  if (!nsData && !bseData) {
    throw new Error(`Could not fetch data from either NSE or BSE for ${symbol}`);
  }

  // Merge with NSE as primary, BSE as fallback
  const merged = mergeExchangeData(nsData, bseData);

  // Log which exchanges provided data
  if (merged.dataSource.nse && merged.dataSource.bse) {
    console.log(`    ✓ Merged data from both NSE and BSE`);
  } else if (merged.dataSource.nse) {
    console.log(`    ✓ Data from NSE only`);
  } else {
    console.log(`    ✓ Data from BSE only`);
  }

  return merged;
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

  // Fetch all fundamentals for peers for detailed comparison
  const peerIds = data.map((p) => p.id);
  const { data: fundData } = await supabase
    .from("stock_fundamentals")
    .select("stock_id, pe, pb, roe, roce, debt_to_equity, net_margin, operating_margin, revenue_cr, net_profit_cr, eps, dividend_yield, book_value")
    .in("stock_id", peerIds);

  const fundMap = Object.fromEntries((fundData || []).map((f) => [f.stock_id, f]));

  return data.map((p) => {
    const fund = fundMap[p.id];
    return {
      symbol: p.symbol,
      market_cap_cr: p.market_cap_cr,
      pe: fund?.pe ?? null,
      pb: fund?.pb ?? null,
      // Normalize percentage metrics from database (stored as 28.5) to decimal (0.285) to match Yahoo Finance format
      roe: fund?.roe != null ? fund.roe / 100 : null,
      roce: fund?.roce != null ? fund.roce / 100 : null,
      debt_to_equity: fund?.debt_to_equity ?? null,
      net_margin: fund?.net_margin != null ? fund.net_margin / 100 : null,
      operating_margin: fund?.operating_margin != null ? fund.operating_margin / 100 : null,
      revenue_cr: fund?.revenue_cr ?? null,
      eps: fund?.eps ?? null,
      dividend_yield: fund?.dividend_yield != null ? fund.dividend_yield / 100 : null,
      book_value: fund?.book_value ?? null,
    };
  });
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
  const dataContext = buildDataContext(
    symbol,
    yahoo.quote,
    yahoo.financialData,
    yahoo.fundamentals,
    yahoo.chart,
    peers,
    yahoo.timeSeries,
    yahoo.dataSource,
    yahoo.impliedVolatility,
    sector
  );

  // Compute deterministic quantitative base score
  const quantScore = computeQuantScore(yahoo.fundamentals, peers, sector, yahoo.chart);
  console.log(`  [${symbol}] Quant base score: ${quantScore.overall}/100 (Prof:${quantScore.components.profitability} Val:${quantScore.components.valuation} Health:${quantScore.components.financial_health} Growth:${quantScore.components.growth} Mom:${quantScore.components.momentum})`);

  const prompt = buildAnalysisPrompt(dataContext, sector, quantScore);

  const promptSize = JSON.stringify(prompt).length;
  console.log(`  [${symbol}] Prompt size: ${(promptSize / 1024).toFixed(2)} KB`);
  
  if (promptSize > 25000) {
    console.warn(`  [${symbol}] WARNING: Prompt exceeds 25KB (${(promptSize / 1024).toFixed(2)} KB) - may hit API limits`);
  }

  console.log(`[${symbol}] Calling Mistral LLM API...`);
  let analysisJson;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(LLM_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: "mistral-large-2411",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      let text = result.choices?.[0]?.message?.content;
      if (!text) throw new Error("No content in API response");

      // Remove markdown code fences if present
      text = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      // Try to extract JSON object in case there's surrounding text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }

      analysisJson = JSON.parse(text);
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`  [${symbol}] LLM API attempt ${attempt + 1} failed: ${err.message}. Retrying...`);
      await sleep(3000 * (attempt + 1));
    }
  }

  // Validate basic structure
  if (!analysisJson?.sections) {
    throw new Error(`Invalid analysis JSON structure for ${symbol}`);
  }

  // Enforce hybrid scoring: quant base ± LLM adjustment (clamped to ±15)
  const llmAdjustment = Math.max(-15, Math.min(15, analysisJson.score_adjustment ?? 0));
  const finalScore = Math.max(0, Math.min(100, quantScore.overall + llmAdjustment));

  // Override LLM's overall_score with our enforced calculation
  if (analysisJson.overall_score !== finalScore) {
    console.log(`  [${symbol}] Score enforced: LLM said ${analysisJson.overall_score}, using ${quantScore.overall} + (${llmAdjustment}) = ${finalScore}`);
  }
  analysisJson.overall_score = finalScore;
  analysisJson.quant_base_score = quantScore.overall;
  analysisJson.score_adjustment = llmAdjustment;
  analysisJson.quant_components = quantScore.components;

  // Score rotation
  const scores = await rotateScores(stockId);

  // Upsert into DB
  const { error } = await supabase
    .from("stock_ai_analyses")
    .upsert(
      {
        stock_id: stockId,
        analysis_json: analysisJson,
        overall_score: finalScore,
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
    // if (stocks.indexOf(stock) < stocks.length - 1) {
      await sleep(DELAY_BETWEEN_STOCKS_MS);
    // }
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

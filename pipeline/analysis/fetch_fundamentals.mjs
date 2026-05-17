#!/usr/bin/env node
/**
 * fetch_fundamentals.mjs
 *
 * Comprehensive fundamentals fetcher built on yahoo-finance2. For each active
 * stock it:
 *   1. Fetches from BOTH NSE (`.NS`) and BSE (`.BO`) in parallel and merges
 *      results field-by-field (preferring non-null values). Tracks the source.
 *   2. Pulls full quoteSummary modules + 4Y annual + ~8 quarter historical
 *      statements via fundamentalsTimeSeries.
 *   3. Computes derived metrics that Yahoo does NOT expose directly:
 *        - True ROCE = EBIT / (Total Assets − Current Liabilities)
 *        - Cash conversion = OCF / Net Income
 *        - Interest coverage = EBIT / Interest Expense
 *        - Working capital days (debtor / inventory / payable / CCC)
 *        - FCF, FCF yield, EBITDA, EBITDA margin
 *        - Effective tax rate
 *        - Revenue / PAT / EBITDA 3Y CAGR
 *        - YoY revenue & PAT growth
 *        - PEG (from forward earnings growth if `pegRatio` missing)
 *   4. Upserts into:
 *        - `stocks` (sector, industry, market cap — fixed bug: Yahoo returns
 *          market cap in INR for .NS/.BO tickers, not USD)
 *        - `stock_fundamentals` (extended schema from migration 007)
 *        - `stock_financial_statements` (one row per stock × period)
 *        - `stock_ownership_snapshots` (today's snapshot)
 *
 * Usage:
 *   node fetch_fundamentals.mjs                       # all active stocks
 *   node fetch_fundamentals.mjs --symbol INFY         # single stock
 *   node fetch_fundamentals.mjs --symbols INFY,TCS    # multiple
 *   node fetch_fundamentals.mjs --limit 20            # first N by market cap
 *   node fetch_fundamentals.mjs --dry-run             # log but don't write
 *
 * Environment variables:
 *   PIPELINE_SUPABASE_URL
 *   PIPELINE_SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.PIPELINE_SUPABASE_URL;
const SUPABASE_KEY = process.env.PIPELINE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing required env vars: PIPELINE_SUPABASE_URL, PIPELINE_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Yahoo doesn't formally rate-limit, but be a polite citizen.
const DELAY_BETWEEN_STOCKS_MS = 400;
const MAX_RETRIES = 2;
const UPSERT_BATCH_SIZE = 200;

// Cap historical statements stored per stock to avoid unbounded growth.
const MAX_ANNUAL_PERIODS = 5;
const MAX_QUARTERLY_PERIODS = 8;

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { symbol: null, symbols: null, limit: null, dryRun: false, debug: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--symbol" && args[i + 1]) parsed.symbol = args[++i].toUpperCase();
    else if (args[i] === "--symbols" && args[i + 1]) parsed.symbols = args[++i].toUpperCase().split(",");
    else if (args[i] === "--limit" && args[i + 1]) parsed.limit = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") parsed.dryRun = true;
    else if (args[i] === "--debug") parsed.debug = true;
  }
  return parsed;
}

// Shared args reference so helpers can emit debug output without threading it
// through every call signature.
let DEBUG = false;

// ── Utilities ───────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Round to N decimals, preserving null/NaN. */
function round(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Convert raw INR value to crores. */
function toCr(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return round(v / 1_00_00_000, 2);
}

/** Convert a Yahoo decimal ratio (0.285) to percentage (28.5). */
function toPct(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return round(v * 100, 2);
}

/** Yahoo wraps some values as { raw, fmt }. Unwrap them. */
function unwrap(v) {
  if (v == null) return null;
  if (typeof v === "object" && "raw" in v) return v.raw;
  return v;
}

/** Pick the first non-null among args. */
function firstNonNull(...vals) {
  for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Build YYYY-MM-DD from a Date or ISO string. */
function toDateStr(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "object" && d.raw) return new Date(d.raw * 1000).toISOString().slice(0, 10);
  return null;
}

// ── Yahoo Finance fetch ─────────────────────────────────────────────────────

const QUOTE_SUMMARY_MODULES = [
  // Profile & price
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "price",
  "assetProfile",
  "summaryProfile",
  // Statement history (4 years annual + 4 quarters; reliable field names)
  "incomeStatementHistory",
  "balanceSheetHistory",
  "cashflowStatementHistory",
  "incomeStatementHistoryQuarterly",
  "balanceSheetHistoryQuarterly",
  "cashflowStatementHistoryQuarterly",
  // Analyst & sentiment
  "earningsTrend",
  "earningsHistory",
  "recommendationTrend",
  "upgradeDowngradeHistory",
  "calendarEvents",
  // Ownership & insider activity
  "majorHoldersBreakdown",
  "institutionOwnership",
  "fundOwnership",
  "insiderTransactions",
  "insiderHolders",
  "netSharePurchaseActivity",
];

// fundamentalsTimeSeries goes 5+ years back, so 3Y CAGR computations work.
const FTS_PERIOD1 = new Date(Date.now() - 5.5 * 365 * 24 * 60 * 60 * 1000)
  .toISOString().slice(0, 10);

async function fetchFromExchange(yahooSymbol) {
  try {
    const [quote, annualIS, annualBS, annualCF, qtrIS, qtrBS, qtrCF] = await Promise.all([
      yahooFinance.quoteSummary(yahooSymbol, { modules: QUOTE_SUMMARY_MODULES }).catch(() => null),
      yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1: FTS_PERIOD1, module: "incomeStatement", type: "annual" }).catch(() => null),
      yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1: FTS_PERIOD1, module: "balanceSheet",   type: "annual" }).catch(() => null),
      yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1: FTS_PERIOD1, module: "cashFlow",       type: "annual" }).catch(() => null),
      yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1: FTS_PERIOD1, module: "incomeStatement", type: "quarterly" }).catch(() => null),
      yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1: FTS_PERIOD1, module: "balanceSheet",   type: "quarterly" }).catch(() => null),
      yahooFinance.fundamentalsTimeSeries(yahooSymbol, { period1: FTS_PERIOD1, module: "cashFlow",       type: "quarterly" }).catch(() => null),
    ]);

    if (!quote) return null;

    // Pull statement arrays from quoteSummary (primary source — more reliable
    // field names and consistently 4 annual periods). Inner key names differ
    // by statement type, so handle each explicitly.
    const qsAnnual = {
      incomeStatement: quote.incomeStatementHistory?.incomeStatementHistory ?? [],
      balanceSheet:    quote.balanceSheetHistory?.balanceSheetStatements ?? [],
      cashFlow:        quote.cashflowStatementHistory?.cashflowStatements ?? [],
    };
    const qsQuarterly = {
      incomeStatement: quote.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? [],
      balanceSheet:    quote.balanceSheetHistoryQuarterly?.balanceSheetStatements ?? [],
      cashFlow:        quote.cashflowStatementHistoryQuarterly?.cashflowStatements ?? [],
    };
    // fundamentalsTimeSeries (supplementary — fills in missing line items)
    const ftsAnnual = {
      incomeStatement: annualIS?.timeSeries ?? annualIS ?? [],
      balanceSheet:    annualBS?.timeSeries ?? annualBS ?? [],
      cashFlow:        annualCF?.timeSeries ?? annualCF ?? [],
    };
    const ftsQuarterly = {
      incomeStatement: qtrIS?.timeSeries ?? qtrIS ?? [],
      balanceSheet:    qtrBS?.timeSeries ?? qtrBS ?? [],
      cashFlow:        qtrCF?.timeSeries ?? qtrCF ?? [],
    };

    return {
      yahooSymbol,
      quote,
      annual: { primary: qsAnnual, secondary: ftsAnnual },
      quarterly: { primary: qsQuarterly, secondary: ftsQuarterly },
    };
  } catch (err) {
    return null;
  }
}

/** Merge two exchange responses preferring non-null fields. */
function mergeExchangeData(primary, secondary) {
  if (!primary && !secondary) return null;
  if (!primary) return { ...secondary, source: "BSE" };
  if (!secondary) return { ...primary, source: "NSE" };

  // Merge quoteSummary modules: take primary, fill in missing modules / fields from secondary
  const mergedQuote = { ...secondary.quote, ...primary.quote };
  for (const mod of QUOTE_SUMMARY_MODULES) {
    const p = primary.quote?.[mod];
    const s = secondary.quote?.[mod];
    if (!p && s) mergedQuote[mod] = s;
    else if (p && s && typeof p === "object" && !Array.isArray(p)) {
      const merged = { ...s, ...p };
      for (const k of Object.keys(merged)) {
        if (merged[k] == null && s[k] != null) merged[k] = s[k];
      }
      mergedQuote[mod] = merged;
    }
  }

  // Merge statement series: union by period end date, prefer primary
  const mergeSeries = (a, b) => {
    const seen = new Set();
    const out = [];
    for (const row of [...(a || []), ...(b || [])]) {
      const dt = toDateStr(row?.asOfDate ?? row?.endDate ?? row?.date);
      if (!dt || seen.has(dt)) continue;
      seen.add(dt);
      out.push(row);
    }
    out.sort((x, y) => toDateStr(y.asOfDate ?? y.endDate ?? y.date).localeCompare(toDateStr(x.asOfDate ?? x.endDate ?? x.date)));
    return out;
  };

  const mergeBucket = (p, s) => ({
    primary: {
      incomeStatement: mergeSeries(p.primary?.incomeStatement, s.primary?.incomeStatement),
      balanceSheet:    mergeSeries(p.primary?.balanceSheet,    s.primary?.balanceSheet),
      cashFlow:        mergeSeries(p.primary?.cashFlow,        s.primary?.cashFlow),
    },
    secondary: {
      incomeStatement: mergeSeries(p.secondary?.incomeStatement, s.secondary?.incomeStatement),
      balanceSheet:    mergeSeries(p.secondary?.balanceSheet,    s.secondary?.balanceSheet),
      cashFlow:        mergeSeries(p.secondary?.cashFlow,        s.secondary?.cashFlow),
    },
  });

  return {
    source: "NSE+BSE",
    quote: mergedQuote,
    annual: mergeBucket(primary.annual, secondary.annual),
    quarterly: mergeBucket(primary.quarterly, secondary.quarterly),
  };
}

/** Fetch both NSE and BSE in parallel and merge. */
async function fetchYahooData(symbol) {
  const [nse, bse] = await Promise.all([
    fetchFromExchange(`${symbol}.NS`),
    fetchFromExchange(`${symbol}.BO`),
  ]);

  if (!nse && !bse) return null;

  // Prefer NSE as primary (more liquid, more reliable price data)
  if (nse && bse) return mergeExchangeData(nse, bse);
  if (nse) return { ...nse, source: "NSE" };
  return { ...bse, source: "BSE" };
}

// ── Statement extraction helpers ────────────────────────────────────────────

/**
 * Build a flat statement object from a Yahoo fundamentalsTimeSeries row.
 * Yahoo's shape is { asOfDate, totalRevenue: { raw, fmt }, ... }.
 * Returns plain numeric values.
 */
const STMT_SKIP_KEYS = new Set([
  "asOfDate", "endDate", "date", "periodType", "currencyCode", "maxAge",
]);

function flattenStatementRow(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (STMT_SKIP_KEYS.has(k)) continue;
    const raw = unwrap(v);
    if (raw != null && Number.isFinite(Number(raw))) out[k] = Number(raw);
  }
  return out;
}

/**
 * Build merged statements: { periodEnd, income, balance, cashFlow } sorted desc.
 * Combines primary (quoteSummary) and secondary (fundamentalsTimeSeries) sources;
 * primary fields win, secondary fills gaps.
 */
function buildStatementsByPeriod(bucket) {
  const byDate = new Map();

  const collect = (rows, key, primary) => {
    for (const row of rows || []) {
      const dt = toDateStr(row?.asOfDate ?? row?.endDate ?? row?.date);
      if (!dt) continue;
      const entry = byDate.get(dt) || { periodEnd: dt, income: {}, balance: {}, cashFlow: {} };
      const flat = flattenStatementRow(row);
      if (primary) {
        // Primary fields overwrite (they're more authoritative)
        entry[key] = { ...entry[key], ...flat };
      } else {
        // Secondary only fills missing fields
        for (const [k, v] of Object.entries(flat)) {
          if (entry[key][k] == null) entry[key][k] = v;
        }
      }
      byDate.set(dt, entry);
    }
  };

  collect(bucket.primary?.incomeStatement, "income",   true);
  collect(bucket.primary?.balanceSheet,    "balance",  true);
  collect(bucket.primary?.cashFlow,        "cashFlow", true);
  collect(bucket.secondary?.incomeStatement, "income",   false);
  collect(bucket.secondary?.balanceSheet,    "balance",  false);
  collect(bucket.secondary?.cashFlow,        "cashFlow", false);

  return [...byDate.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

// ── Derived metric computations ─────────────────────────────────────────────

/**
 * Derive EBIT from income statement fields, trying multiple approaches.
 *
 * Yahoo's field names differ by company type and region. Priority:
 *   1. Direct ebit field
 *   2. operatingIncome (standard for most companies)
 *   3. Pretax income + interest expense (add back financing costs)
 *   4. Revenue − totalOperatingExpenses (sometimes Yahoo provides opex as a subtotal)
 *
 * Returns raw INR value (not percentage).
 */
function deriveEBIT(income) {
  // Direct
  const direct = firstNonNull(income.ebit, income.operatingIncome);
  if (direct != null) {
    if (DEBUG) console.log(`      EBIT: direct field → ${direct}`);
    return direct;
  }

  // Pretax + interest expense. Yahoo reports interest as negative for some companies.
  const ptbi     = firstNonNull(income.pretaxIncome, income.incomeBeforeTax);
  const interest = firstNonNull(income.interestExpense);
  if (ptbi != null && interest != null) {
    const ebit = ptbi + Math.abs(interest); // add back interest cost
    if (DEBUG) console.log(`      EBIT: pretaxIncome(${ptbi}) + |interest|(${Math.abs(interest)}) = ${ebit}`);
    return ebit;
  }
  if (ptbi != null) {
    // No interest data — pretax is a rough EBIT proxy (understates for leveraged cos.)
    if (DEBUG) console.log(`      EBIT: pretaxIncome fallback (no interest data) → ${ptbi}`);
    return ptbi;
  }

  // Revenue minus operating expenses subtotal
  const rev  = firstNonNull(income.totalRevenue, income.operatingRevenue);
  const opex = firstNonNull(income.totalOperatingExpenses);
  if (rev != null && opex != null) {
    const ebit = rev - opex;
    if (DEBUG) console.log(`      EBIT: revenue(${rev}) - opex(${opex}) = ${ebit}`);
    return ebit;
  }

  if (DEBUG) console.log(`      EBIT: all methods failed. income keys: ${Object.keys(income).join(", ")}`);
  return null;
}

/**
 * Derive current liabilities from balance sheet, trying multiple field names.
 * Yahoo uses inconsistent naming across company types and regions.
 */
function deriveCurrentLiabilities(balance) {
  // Direct names
  const direct = firstNonNull(balance.currentLiabilities, balance.totalCurrentLiabilities);
  if (direct != null) return direct;

  // Sum components when subtotal is absent
  const ap           = firstNonNull(balance.accountsPayable, balance.payables);
  const shortDebt    = firstNonNull(balance.shortTermDebt, balance.shortLongTermDebt, balance.currentPortionOfLongTermDebt);
  const otherCurrent = firstNonNull(balance.otherCurrentLiabilities, balance.currentOtherLiabilities);
  const accrued      = firstNonNull(balance.accruedLiabilities, balance.accruedExpenses);
  const taxPayable   = firstNonNull(balance.taxPayable, balance.incomeTaxPayable);

  const components = [ap, shortDebt, otherCurrent, accrued, taxPayable].filter((v) => v != null);
  if (components.length > 0) {
    const sum = components.reduce((a, b) => a + b, 0);
    if (DEBUG) console.log(`      CurrentLiab: summed ${components.length} components = ${sum}`);
    return sum;
  }

  if (DEBUG) console.log(`      CurrentLiab: all methods failed. balance keys: ${Object.keys(balance).join(", ")}`);
  return null;
}

/** True ROCE = EBIT / (Total Assets − Current Liabilities). Returns %. */
function computeROCE(income, balance) {
  const ebit       = deriveEBIT(income);
  const totalAssets = firstNonNull(balance.totalAssets);
  const currentLiab = deriveCurrentLiabilities(balance);

  if (DEBUG) console.log(`      ROCE inputs: ebit=${ebit} totalAssets=${totalAssets} currentLiab=${currentLiab}`);
  if (ebit == null || totalAssets == null || currentLiab == null) return null;
  const capitalEmployed = totalAssets - currentLiab;
  if (capitalEmployed <= 0) return null;
  return round((ebit / capitalEmployed) * 100, 2);
}

/** ROA = Net Income / Total Assets. Returns %. */
function computeROA(income, balance, fdFallback) {
  const ni = firstNonNull(income.netIncome, income.netIncomeCommonStockholders);
  const totalAssets = firstNonNull(balance.totalAssets);
  if (ni != null && totalAssets != null && totalAssets > 0) {
    return round((ni / totalAssets) * 100, 2);
  }
  return toPct(fdFallback);
}

/**
 * Detect if a stock is a financial company (bank, NBFC, insurance, AMC).
 * For these, ROCE is not meaningful and totalRevenue is often missing — use
 * ROA and netIncome history as proxies instead.
 */
function isFinancialCompany(quote) {
  const ap = quote?.assetProfile ?? quote?.summaryProfile ?? {};
  const industry = (ap.industry ?? "").toLowerCase();
  const sector = (ap.sector ?? "").toLowerCase();
  const FINANCIAL_KEYWORDS = [
    "bank", "insurance", "asset management", "capital markets",
    "credit services", "financial services", "mortgage", "diversified financial",
  ];
  return FINANCIAL_KEYWORDS.some((kw) => industry.includes(kw) || sector.includes(kw));
}

/** EBITDA = EBIT + D&A. */
function computeEBITDA(income, cashFlow) {
  const ebit = deriveEBIT(income);
  const da = firstNonNull(
    income.reconciledDepreciation,
    cashFlow.depreciationAndAmortization,
    cashFlow.depreciation,
    cashFlow.depreciationDepletion,
  );
  if (ebit == null) return null;
  if (da == null) return ebit; // fallback to EBIT if D&A unavailable
  return ebit + da;
}

/** Cash conversion = OCF / Net Income (ratio, not %). */
function computeCashConversion(cashFlow, income) {
  const ocf = firstNonNull(cashFlow.operatingCashFlow, cashFlow.cashFlowFromContinuingOperatingActivities);
  const ni = firstNonNull(income.netIncome, income.netIncomeCommonStockholders);
  if (ocf == null || ni == null || ni === 0) return null;
  return round(ocf / ni, 2);
}

/** Interest coverage = EBIT / Interest Expense. */
function computeInterestCoverage(income) {
  const ebit = deriveEBIT(income);
  const interest = firstNonNull(income.interestExpense, income.netInterestExpense);
  if (ebit == null || interest == null || interest === 0) return null;
  // Yahoo sometimes returns interest expense as negative; use absolute value
  return round(ebit / Math.abs(interest), 2);
}

/** Effective tax rate = Tax / Pre-tax income. Returns %. */
function computeEffectiveTaxRate(income) {
  const tax = firstNonNull(income.taxProvision, income.incomeTaxExpense);
  const ptbi = firstNonNull(income.pretaxIncome, income.incomeBeforeTax);
  if (tax == null || ptbi == null || ptbi === 0) return null;
  return round((tax / ptbi) * 100, 2);
}

/** FCF = OCF − CapEx. */
function computeFCF(cashFlow) {
  const ocf = firstNonNull(cashFlow.operatingCashFlow, cashFlow.cashFlowFromContinuingOperatingActivities);
  const capex = firstNonNull(cashFlow.capitalExpenditure);
  if (ocf == null) return null;
  if (capex == null) return ocf; // some companies report net of capex
  // capex is typically reported as negative; subtracting a negative adds it
  return ocf + capex;
}

/** Working capital days: receivables ÷ revenue × 365 etc. */
function computeWorkingCapitalDays(income, balance) {
  const revenue = firstNonNull(income.totalRevenue, income.operatingRevenue, income.totalInterestIncome);
  const cogs = firstNonNull(income.costOfRevenue, income.reconciledCostOfRevenue, income.costOfGoodsAndServicesSold);
  const receivables = firstNonNull(balance.accountsReceivable, balance.netReceivables, balance.otherReceivables);
  const inventory = firstNonNull(balance.inventory, balance.inventoryNet);
  const payables = firstNonNull(balance.accountsPayable, balance.payables, balance.tradePayables);

  const debtorDays    = revenue && receivables != null ? round((receivables / revenue) * 365, 1) : null;
  const inventoryDays = (cogs || revenue) && inventory != null
    ? round((inventory / (cogs || revenue)) * 365, 1)
    : null;
  const payableDays   = (cogs || revenue) && payables != null
    ? round((payables / (cogs || revenue)) * 365, 1)
    : null;
  const ccc = (debtorDays != null && inventoryDays != null && payableDays != null)
    ? round(debtorDays + inventoryDays - payableDays, 1)
    : null;

  return { debtorDays, inventoryDays, payableDays, ccc };
}

/** CAGR over N years: (end/start)^(1/N) − 1. */
function cagr(start, end, years) {
  if (start == null || end == null || start <= 0 || end <= 0 || years <= 0) return null;
  return round((Math.pow(end / start, 1 / years) - 1) * 100, 2);
}

/** Compute revenue/PAT/EBITDA CAGR from annual statements (descending by date).
 *  For banks: totalRevenue is typically null. Falls back to totalInterestIncome
 *  or netInterestIncome (banks' nearest equivalent to "revenue").
 */
function computeGrowthMetrics(annualStmts) {
  if (!annualStmts.length) return { revenueCagr3y: null, patCagr3y: null, ebitdaCagr3y: null, revenueYoY: null, patYoY: null };

  const getRevenue = (s) => firstNonNull(
    s.income.totalRevenue,
    s.income.operatingRevenue,
    s.income.totalInterestIncome,
    s.income.netInterestIncome,
  );
  const getPAT     = (s) => firstNonNull(s.income.netIncome, s.income.netIncomeCommonStockholders);
  const getEBITDA  = (s) => computeEBITDA(s.income, s.cashFlow);

  const latest    = annualStmts[0];
  const prior     = annualStmts[1] ?? null;
  const threeBack = annualStmts[3] ?? annualStmts[annualStmts.length - 1] ?? null;

  const periodsBetween = (a, b) => {
    if (!a || !b) return null;
    const yrs = (new Date(a.periodEnd) - new Date(b.periodEnd)) / (1000 * 60 * 60 * 24 * 365.25);
    return Math.round(yrs);
  };

  const yearsBack = periodsBetween(latest, threeBack);
  const useFor3yCagr = yearsBack && yearsBack >= 2 ? yearsBack : null;

  return {
    revenueCagr3y: useFor3yCagr ? cagr(getRevenue(threeBack), getRevenue(latest), useFor3yCagr) : null,
    patCagr3y:     useFor3yCagr ? cagr(getPAT(threeBack),     getPAT(latest),     useFor3yCagr) : null,
    ebitdaCagr3y:  useFor3yCagr ? cagr(getEBITDA(threeBack),  getEBITDA(latest),  useFor3yCagr) : null,
    revenueYoY: prior ? (() => {
      const a = getRevenue(prior), b = getRevenue(latest);
      return a && b ? round(((b - a) / a) * 100, 2) : null;
    })() : null,
    patYoY: prior ? (() => {
      const a = getPAT(prior), b = getPAT(latest);
      return a && b ? round(((b - a) / a) * 100, 2) : null;
    })() : null,
  };
}

// ── Build the fundamentals row ──────────────────────────────────────────────

function buildFundamentalsRecord(stockId, merged) {
  const q = merged.quote ?? {};
  const sd = q.summaryDetail ?? {};
  const ks = q.defaultKeyStatistics ?? {};
  const fd = q.financialData ?? {};
  const pr = q.price ?? {};
  const et = q.earningsTrend ?? {};

  const annualStmts = buildStatementsByPeriod(merged.annual);
  const latest = annualStmts[0] ?? { income: {}, balance: {}, cashFlow: {} };
  const isFinancial = isFinancialCompany(merged.quote);

  // Raw values. For banks, totalRevenue is often null — fall back to interest
  // income or use the Yahoo financialData figure (which is computed differently
  // by Yahoo for financial companies).
  const revenueRaw   = firstNonNull(
    latest.income.totalRevenue,
    latest.income.operatingRevenue,
    latest.income.totalInterestIncome,
    latest.income.netInterestIncome,
    unwrap(fd.totalRevenue),
  );
  const patRaw       = firstNonNull(latest.income.netIncome, latest.income.netIncomeCommonStockholders, unwrap(fd.netIncomeToCommon));
  const ebitRaw      = firstNonNull(latest.income.ebit, latest.income.operatingIncome);
  const ebitdaRaw    = computeEBITDA(latest.income, latest.cashFlow) ?? unwrap(fd.ebitda);
  const ocfRaw       = firstNonNull(latest.cashFlow.operatingCashFlow, unwrap(fd.operatingCashflow));
  const fcfRaw       = computeFCF(latest.cashFlow) ?? unwrap(fd.freeCashflow);
  const totalDebt    = firstNonNull(latest.balance.totalDebt, unwrap(fd.totalDebt));
  const totalCash    = firstNonNull(latest.balance.cashAndCashEquivalents, unwrap(fd.totalCash));
  const netDebt      = (totalDebt != null && totalCash != null) ? totalDebt - totalCash : null;

  // Margins (recomputed for consistency; Yahoo's values can be stale)
  const grossMargin = (() => {
    const gp = firstNonNull(latest.income.grossProfit);
    return (gp != null && revenueRaw) ? round((gp / revenueRaw) * 100, 2) : toPct(unwrap(fd.grossMargins));
  })();
  const ebitdaMargin   = (ebitdaRaw != null && revenueRaw) ? round((ebitdaRaw / revenueRaw) * 100, 2) : null;
  const opMargin       = (ebitRaw != null && revenueRaw) ? round((ebitRaw / revenueRaw) * 100, 2) : toPct(unwrap(fd.operatingMargins));
  const netMargin      = (patRaw != null && revenueRaw) ? round((patRaw / revenueRaw) * 100, 2) : toPct(unwrap(fd.profitMargins));

  // True ROCE from statements. Skipped for financials — ROCE doesn't apply to
  // banks/NBFCs/insurance where "capital employed" isn't well-defined (most
  // assets are funded by customer deposits, not capital).
  const roce = isFinancial ? null : computeROCE(latest.income, latest.balance);
  const roe  = toPct(unwrap(fd.returnOnEquity));
  // ROA is the relevant return metric for financials; useful complement otherwise.
  const roa  = computeROA(latest.income, latest.balance, unwrap(fd.returnOnAssets));

  // Quality / health
  const cashConversion   = computeCashConversion(latest.cashFlow, latest.income);
  const interestCoverage = computeInterestCoverage(latest.income);
  const effectiveTax     = computeEffectiveTaxRate(latest.income);
  const wcDays           = computeWorkingCapitalDays(latest.income, latest.balance);

  // Valuation
  const marketCapRaw = unwrap(pr.marketCap);
  const pe           = firstNonNull(unwrap(sd.trailingPE), unwrap(ks.trailingPE));
  const forwardPE    = firstNonNull(unwrap(sd.forwardPE), unwrap(ks.forwardPE));
  const pb           = firstNonNull(unwrap(sd.priceToBook), unwrap(ks.priceToBook));
  const ps           = firstNonNull(unwrap(sd.priceToSalesTrailing12Months), unwrap(ks.priceToSalesTrailing12Months));
  const evEbitda     = unwrap(ks.enterpriseToEbitda);
  let peg            = unwrap(ks.pegRatio);
  // Fallback: compute PEG from forward earnings growth if Yahoo's pegRatio missing
  if (peg == null && pe != null) {
    const fwdGrowth = unwrap(et.trend?.find((t) => t.period === "+1y")?.growth);
    if (fwdGrowth != null && fwdGrowth > 0) peg = round(pe / (fwdGrowth * 100), 2);
  }
  const fcfYield = (fcfRaw != null && marketCapRaw) ? round((fcfRaw / marketCapRaw) * 100, 2) : null;
  const netDebtToEbitda = (netDebt != null && ebitdaRaw && ebitdaRaw !== 0) ? round(netDebt / ebitdaRaw, 2) : null;

  // Growth
  const growth = computeGrowthMetrics(annualStmts);

  // EPS & book value
  const eps       = firstNonNull(unwrap(ks.trailingEps), unwrap(sd.trailingEps));
  const fwdEps    = unwrap(ks.forwardEps);
  const bookValue = unwrap(ks.bookValue);

  // Graham Number = sqrt(22.5 × EPS × Book Value)
  const grahamNumber = (eps && bookValue && eps > 0 && bookValue > 0)
    ? round(Math.sqrt(22.5 * eps * bookValue), 2)
    : null;

  // Forward earnings growth from analyst estimates
  const fwdEarningsGrowth = unwrap(et.trend?.find((t) => t.period === "+1y")?.growth);

  return {
    stock_id: stockId,

    // Existing columns
    pe: round(pe),
    pb: round(pb),
    roe,
    roce,
    roa,
    is_financial: isFinancial,
    debt_to_equity: round(unwrap(fd.debtToEquity)),
    net_margin: netMargin,
    operating_margin: opMargin,
    revenue_cr: toCr(revenueRaw),
    net_profit_cr: toCr(patRaw),
    eps: round(eps),
    dividend_yield: toPct(unwrap(sd.dividendYield)),
    book_value: round(bookValue),
    graham_number: grahamNumber,

    // Extended columns (migration 007)
    ev_to_ebitda: round(evEbitda),
    peg: round(peg),
    price_to_sales: round(ps),

    gross_margin: grossMargin,
    ebitda_margin: ebitdaMargin,
    ebitda_cr: toCr(ebitdaRaw),
    effective_tax_rate: effectiveTax,

    operating_cash_flow_cr: toCr(ocfRaw),
    fcf_cr: toCr(fcfRaw),
    fcf_yield: fcfYield,
    cash_conversion: cashConversion,

    interest_coverage: interestCoverage,
    current_ratio: round(unwrap(fd.currentRatio)),
    quick_ratio: round(unwrap(fd.quickRatio)),
    net_debt_cr: toCr(netDebt),
    net_debt_to_ebitda: netDebtToEbitda,

    debtor_days: wcDays.debtorDays,
    inventory_days: wcDays.inventoryDays,
    payable_days: wcDays.payableDays,
    cash_conversion_cycle: wcDays.ccc,

    revenue_cagr_3y: growth.revenueCagr3y,
    pat_cagr_3y: growth.patCagr3y,
    ebitda_cagr_3y: growth.ebitdaCagr3y,
    revenue_growth_yoy: growth.revenueYoY,
    pat_growth_yoy: growth.patYoY,

    forward_pe: round(forwardPE),
    forward_eps: round(fwdEps),
    earnings_growth_forward: fwdEarningsGrowth != null ? round(fwdEarningsGrowth * 100, 2) : null,

    data_source: merged.source,
    fundamentals_updated_at: new Date().toISOString(),
    scraped_at: new Date().toISOString(),
  };
}

function buildStockRecord(symbol, merged) {
  const q = merged.quote ?? {};
  const pr = q.price ?? {};
  const ap = q.assetProfile ?? q.summaryProfile ?? {};

  // FIXED: Yahoo returns market cap in INR for .NS/.BO — no USD conversion needed.
  const marketCapRaw = unwrap(pr.marketCap);
  const marketCapCr = marketCapRaw != null ? round(marketCapRaw / 1_00_00_000, 2) : null;

  return {
    symbol,
    exchange: merged.source === "BSE" ? "BSE" : "NSE",
    name: pr.shortName ?? pr.longName ?? null,
    sector: ap.sector ?? null,
    industry: ap.industry ?? null,
    market_cap_cr: marketCapCr,
    is_active: true,
    nse_listed: merged.source !== "BSE",
  };
}

function buildStatementRows(stockId, merged) {
  const rows = [];
  const annual = buildStatementsByPeriod(merged.annual).slice(0, MAX_ANNUAL_PERIODS);
  const quarterly = buildStatementsByPeriod(merged.quarterly).slice(0, MAX_QUARTERLY_PERIODS);

  for (const s of annual) {
    rows.push({
      stock_id: stockId,
      period_type: "annual",
      period_end_date: s.periodEnd,
      income_stmt: s.income,
      balance_sheet: s.balance,
      cash_flow: s.cashFlow,
      source: merged.source,
      fetched_at: new Date().toISOString(),
    });
  }
  for (const s of quarterly) {
    rows.push({
      stock_id: stockId,
      period_type: "quarterly",
      period_end_date: s.periodEnd,
      income_stmt: s.income,
      balance_sheet: s.balance,
      cash_flow: s.cashFlow,
      source: merged.source,
      fetched_at: new Date().toISOString(),
    });
  }
  return rows;
}

function buildOwnershipSnapshot(stockId, merged) {
  const q = merged.quote ?? {};
  const mh = q.majorHoldersBreakdown ?? {};
  const inst = q.institutionOwnership?.ownershipList ?? [];
  const funds = q.fundOwnership?.ownershipList ?? [];
  const tx = q.insiderTransactions?.transactions ?? [];

  // If nothing meaningful, skip
  if (!mh && !inst.length && !funds.length && !tx.length) return null;

  const six_months_ago = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const recentTx = tx
    .filter((t) => {
      const dt = unwrap(t.startDate);
      if (!dt) return false;
      const d = typeof dt === "number" ? new Date(dt * 1000) : new Date(dt);
      return d >= six_months_ago;
    })
    .slice(0, 20)
    .map((t) => ({
      filerName: t.filerName ?? null,
      filerRelation: t.filerRelation ?? null,
      transactionText: t.transactionText ?? null,
      shares: unwrap(t.shares),
      value: unwrap(t.value),
      date: toDateStr(unwrap(t.startDate)),
    }));

  return {
    stock_id: stockId,
    snapshot_date: new Date().toISOString().slice(0, 10),
    insider_pct: toPct(unwrap(mh.insidersPercentHeld)),
    institution_pct: toPct(unwrap(mh.institutionsPercentHeld)),
    float_pct: toPct(unwrap(mh.institutionsFloatPercentHeld)),
    top_institutions: inst.slice(0, 10).map((i) => ({
      organization: i.organization,
      pctHeld: unwrap(i.pctHeld),
      position: unwrap(i.position),
      value: unwrap(i.value),
      reportDate: toDateStr(unwrap(i.reportDate)),
    })),
    top_funds: funds.slice(0, 10).map((f) => ({
      organization: f.organization,
      pctHeld: unwrap(f.pctHeld),
      position: unwrap(f.position),
      value: unwrap(f.value),
      reportDate: toDateStr(unwrap(f.reportDate)),
    })),
    recent_insider_trades: recentTx,
    fetched_at: new Date().toISOString(),
  };
}

// ── DB writes ───────────────────────────────────────────────────────────────

async function upsertInBatches(table, rows, onConflict) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`);
  }
}

// ── Main per-stock processing ───────────────────────────────────────────────

async function processStock(stock, dryRun) {
  const { id: stockId, symbol } = stock;

  let merged;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      merged = await fetchYahooData(symbol);
      break;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }

  if (!merged) {
    console.warn(`  [${symbol}] No data from either NSE or BSE — skipping`);
    return { ok: false, reason: "no_data" };
  }

  const stockRecord = buildStockRecord(symbol, merged);
  const fundamentalsRecord = buildFundamentalsRecord(stockId, merged);
  const statementRows = buildStatementRows(stockId, merged);
  const ownership = buildOwnershipSnapshot(stockId, merged);

  // Coverage check: count how many fundamentals fields we successfully populated
  const numericFields = Object.entries(fundamentalsRecord).filter(([k, v]) =>
    typeof v === "number" && k !== "stock_id"
  );
  const populated = numericFields.length;

  const retLabel = fundamentalsRecord.is_financial
    ? `roa=${fundamentalsRecord.roa ?? "—"}% (fin)`
    : `roce=${fundamentalsRecord.roce ?? "—"}%`;
  console.log(
    `  [${symbol}] source=${merged.source} | ` +
    `populated=${populated} | ` +
    `${retLabel} | ` +
    `peg=${fundamentalsRecord.peg ?? "—"} | ` +
    `fcf=${fundamentalsRecord.fcf_cr ?? "—"}Cr | ` +
    `rev_cagr=${fundamentalsRecord.revenue_cagr_3y ?? "—"}% | ` +
    `pat_cagr=${fundamentalsRecord.pat_cagr_3y ?? "—"}%`
  );

  if (dryRun) return { ok: true, dryRun: true };

  // Update stocks table (sector/industry/market_cap_cr) — only set fields we have
  const stockUpdate = Object.fromEntries(
    Object.entries(stockRecord).filter(([_, v]) => v != null)
  );
  if (Object.keys(stockUpdate).length > 0) {
    const { error } = await supabase
      .from("stocks")
      .update(stockUpdate)
      .eq("id", stockId);
    if (error) console.warn(`  [${symbol}] stocks update failed: ${error.message}`);
  }

  await upsertInBatches("stock_fundamentals", [fundamentalsRecord], "stock_id");
  if (statementRows.length) {
    await upsertInBatches("stock_financial_statements", statementRows, "stock_id,period_type,period_end_date");
  }
  if (ownership) {
    await upsertInBatches("stock_ownership_snapshots", [ownership], "stock_id,snapshot_date");
  }

  return { ok: true };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  DEBUG = args.debug;
  console.log("=== fetch_fundamentals.mjs ===");
  if (args.dryRun) console.log("(DRY RUN — no DB writes)");
  if (DEBUG) console.log("(DEBUG mode — verbose statement field logging)");

  // Determine which stocks to process
  let stocks;
  if (args.symbol) {
    const { data } = await supabase
      .from("stocks")
      .select("id, symbol")
      .eq("symbol", args.symbol)
      .single();
    if (!data) { console.error(`Stock ${args.symbol} not found`); process.exit(1); }
    stocks = [data];
  } else if (args.symbols) {
    const { data } = await supabase
      .from("stocks")
      .select("id, symbol")
      .in("symbol", args.symbols);
    stocks = data || [];
  } else {
    const { data } = await supabase
      .from("stocks")
      .select("id, symbol")
      .eq("is_active", true)
      .order("market_cap_cr", { ascending: false, nullsFirst: false });
    stocks = data || [];
  }

  if (args.limit) stocks = stocks.slice(0, args.limit);

  console.log(`Processing ${stocks.length} stocks...\n`);

  let succeeded = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < stocks.length; i++) {
    const s = stocks[i];
    console.log(`[${i + 1}/${stocks.length}] ${s.symbol}`);
    try {
      const result = await processStock(s, args.dryRun);
      if (result.ok) succeeded++;
      else { failed++; failures.push({ symbol: s.symbol, reason: result.reason }); }
    } catch (err) {
      failed++;
      failures.push({ symbol: s.symbol, reason: err.message });
      console.error(`  [${s.symbol}] ERROR: ${err.message}`);
    }
    if (i < stocks.length - 1) await sleep(DELAY_BETWEEN_STOCKS_MS);
  }

  console.log(`\n=== Done ===`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed:    ${failed}`);
  if (failures.length) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f.symbol}: ${f.reason}`);
  }

  process.exit(failed > 0 && succeeded === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

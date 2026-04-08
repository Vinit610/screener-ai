/**
 * Prompt template and data-context builder for AI stock analysis.
 * Prompt version: v1
 */

export const PROMPT_VERSION = "v1";

/**
 * Build a text representation of the financial data for the LLM.
 */
export function buildDataContext(symbol, quote, financialData, fundamentals, chart, peers, timeSeries) {
  const sd = quote.summaryDetail ?? {};
  const ks = quote.defaultKeyStatistics ?? {};
  const fd = quote.financialData ?? {};
  const pr = quote.price ?? {};
  const ep = quote.earningsTrend ?? {};
  const profile = quote.summaryProfile ?? {};

  const safe = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const toPct = (v) => { const n = safe(v); return n != null ? (n * 100).toFixed(2) + "%" : "N/A"; };
  const toCr = (v) => { const n = safe(v); return n != null ? (n / 1_00_00_000).toFixed(2) + " Cr" : "N/A"; };
  const fmt = (v, suffix = "") => { const n = safe(v); return n != null ? n.toFixed(2) + suffix : "N/A"; };
  const safeText = (text) => {
    if (!text) return "";
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, " ")
      .replace(/\r/g, " ")
      .replace(/\t/g, " ")
      .replace(/  +/g, " ")
      .trim();
  };

  let text = `=== ${symbol} — ${safeText(pr.shortName ?? pr.longName ?? symbol)} ===\n`;
  text += `Sector: ${safeText(profile.sector ?? "N/A")} | Industry: ${safeText(profile.industry ?? "N/A")}\n`;
  text += `Market Cap: ${toCr(pr.marketCap)} | Exchange: NSE\n\n`;

  // Valuation
  text += `── Valuation ──\n`;
  text += `Trailing P/E: ${fmt(sd.trailingPE)} | Forward P/E: ${fmt(sd.forwardPE)}\n`;
  text += `P/B: ${fmt(sd.priceToBook)} | P/S: ${fmt(sd.priceToSalesTrailing12Months)}\n`;
  text += `PEG Ratio: ${fmt(ks.pegRatio)} | Enterprise Value/EBITDA: ${fmt(ks.enterpriseToEbitda)}\n`;
  text += `52-Week High: ${fmt(sd.fiftyTwoWeekHigh)} | 52-Week Low: ${fmt(sd.fiftyTwoWeekLow)}\n`;
  text += `50-Day MA: ${fmt(sd.fiftyDayAverage)} | 200-Day MA: ${fmt(sd.twoHundredDayAverage)}\n\n`;

  // Profitability
  text += `── Profitability ──\n`;
  text += `ROE: ${toPct(fd.returnOnEquity)} | ROA: ${toPct(fd.returnOnAssets)}\n`;
  text += `Profit Margin: ${toPct(fd.profitMargins)} | Operating Margin: ${toPct(fd.operatingMargins)}\n`;
  text += `Gross Margin: ${toPct(fd.grossMargins)}\n`;
  text += `EPS (Trailing): ${fmt(ks.trailingEps)} | EPS (Forward): ${fmt(ks.forwardEps)}\n\n`;

  // Financial Health
  text += `── Financial Health ──\n`;
  text += `Total Revenue: ${toCr(fd.totalRevenue)} | Net Income: ${toCr(fd.netIncomeToCommon ?? ks.netIncomeToCommon)}\n`;
  text += `Total Cash: ${toCr(fd.totalCash)} | Total Debt: ${toCr(fd.totalDebt)}\n`;
  text += `Debt/Equity: ${fmt(fd.debtToEquity)} | Current Ratio: ${fmt(fd.currentRatio)}\n`;
  text += `Quick Ratio: ${fmt(fd.quickRatio)} | Book Value/Share: ${fmt(ks.bookValue)}\n\n`;

  // Dividends
  text += `── Dividends ──\n`;
  text += `Dividend Yield: ${toPct(sd.dividendYield)} | Payout Ratio: ${toPct(sd.payoutRatio)}\n\n`;

  // Growth & Cash Flow
  text += `── Growth ──\n`;
  text += `Revenue Growth (YoY): ${toPct(fd.revenueGrowth)} | Earnings Growth (YoY): ${toPct(fd.earningsGrowth)}\n`;
  text += `Free Cash Flow: ${toCr(fd.freeCashflow)} | Operating Cash Flow: ${toCr(fd.operatingCashflow)}\n\n`;

  // Fundamentals time series data (quarterly & annual)
  if (fundamentals?.income || fundamentals?.balance || fundamentals?.cash) {
    text += `── Recent Financials (Time Series) ──\n`;
    
    // Income statement entries
    if (fundamentals.income) {
      const incomeKeys = Object.keys(fundamentals.income).sort().reverse().slice(0, 3);
      for (const dateKey of incomeKeys) {
        const data = fundamentals.income[dateKey];
        if (data?.TotalRevenue) {
          text += `  ${dateKey}: Revenue ${toCr(data.TotalRevenue)}`;
          if (data.NetIncome) text += ` | Net Income ${toCr(data.NetIncome)}`;
          if (data.OperatingIncome) text += ` | Op Income ${toCr(data.OperatingIncome)}`;
          text += `\n`;
        }
      }
    }

    // Balance sheet entries
    if (fundamentals.balance) {
      const balanceKeys = Object.keys(fundamentals.balance).sort().reverse().slice(0, 3);
      for (const dateKey of balanceKeys) {
        const data = fundamentals.balance[dateKey];
        if (data?.TotalAssets) {
          text += `  ${dateKey}: Assets ${toCr(data.TotalAssets)}`;
          if (data.TotalLiab) text += ` | Liab ${toCr(data.TotalLiab)}`;
          if (data.StockholderEquity) text += ` | Equity ${toCr(data.StockholderEquity)}`;
          text += `\n`;
        }
      }
    }

    // Cash flow entries
    if (fundamentals.cash) {
      const cashKeys = Object.keys(fundamentals.cash).sort().reverse().slice(0, 2);
      for (const dateKey of cashKeys) {
        const data = fundamentals.cash[dateKey];
        if (data?.OperatingCashFlow) {
          text += `  ${dateKey}: Op Cash ${toCr(data.OperatingCashFlow)}`;
          if (data.FreeCashFlow) text += ` | Free Cash ${toCr(data.FreeCashFlow)}`;
          text += `\n`;
        }
      }
    }
    
    text += `\n`;
  }

  // Price performance from chart
  if (chart?.quotes?.length > 1) {
    const quotes = chart.quotes;
    const latest = quotes[quotes.length - 1];
    const oneYr = quotes.length > 252 ? quotes[quotes.length - 253] : quotes[0];
    const sixMo = quotes.length > 126 ? quotes[quotes.length - 127] : quotes[0];
    const threeMo = quotes.length > 63 ? quotes[quotes.length - 64] : quotes[0];
    const oneMo = quotes.length > 21 ? quotes[quotes.length - 22] : quotes[0];

    const ret = (from, to) => from?.close && to?.close ? (((to.close - from.close) / from.close) * 100).toFixed(1) + "%" : "N/A";

    text += `── Price Performance ──\n`;
    text += `Current Price: ₹${safe(latest.close)?.toFixed(2) ?? "N/A"}\n`;
    text += `1M: ${ret(oneMo, latest)} | 3M: ${ret(threeMo, latest)} | 6M: ${ret(sixMo, latest)} | 1Y: ${ret(oneYr, latest)}\n\n`;
  }

  // Historical earnings (if available)
  if (quote?.earningsHistory?.history?.length) {
    text += `── Earnings History ──\n`;
    for (const earning of quote.earningsHistory.history.slice(0, 4)) {
      const date = new Date(earning.epsReportDate).toLocaleDateString("en-IN");
      text += `  ${date}: EPS Reported ${fmt(earning.epsActual)} vs Estimate ${fmt(earning.epsEstimate)}\n`;
    }
    text += `\n`;
  }

  // Dividend history
  if (quote?.dividends?.event?.length) {
    text += `── Dividend History ──\n`;
    for (const div of quote.dividends.event.slice(0, 5)) {
      const date = new Date(div.parseDate).toLocaleDateString("en-IN");
      text += `  ${date}: ₹${fmt(div.amount)} per share\n`;
    }
    text += `\n`;
  }

  // Insider transactions
  if (quote?.insiderTransactions?.transactions?.length) {
    text += `── Recent Insider Activity ──\n`;
    const buyCount = quote.insiderTransactions.transactions.filter(t => t.filerRelation?.includes("buy")).length;
    const sellCount = quote.insiderTransactions.transactions.filter(t => t.filerRelation?.includes("sell")).length;
    text += `  Recent transactions: ${buyCount} buys, ${sellCount} sells\n`;
    if (quote.insiderTransactions.transactions.length > 0) {
      const latest = quote.insiderTransactions.transactions[0];
      const date = new Date(latest.transactionDate).toLocaleDateString("en-IN");
      text += `  Latest: ${latest.ownerName} - ${latest.transactionType} ${latest.shares} shares on ${date}\n`;
    }
    text += `\n`;
  }

  // Institutional ownership
  if (quote?.institutionOwnership?.ownershipList?.length) {
    text += `── Institutional Ownership ──\n`;
    const topHolders = quote.institutionOwnership.ownershipList.slice(0, 5);
    for (const holder of topHolders) {
      text += `  ${holder.organization}: ${toPct(holder.percentage)} ownership\n`;
    }
    text += `\n`;
  }

  // Major holders breakdown
  if (quote?.majorHoldersBreakdown?.insidersPercentHeld != null) {
    text += `── Ownership Breakdown ──\n`;
    text += `  Insiders: ${toPct(quote.majorHoldersBreakdown.insidersPercentHeld)}\n`;
    text += `  Institutions: ${toPct(quote.majorHoldersBreakdown.institutionsPercentHeld)}\n`;
    text += `  Floated: ${toPct(quote.majorHoldersBreakdown.floatPercentHeld)}\n\n`;
  }

  // Recommendation trends
  if (quote?.recommendationTrend?.trend?.length) {
    text += `── Analyst Recommendations ──\n`;
    const latestRec = quote.recommendationTrend.trend[0];
    text += `  Buys: ${latestRec.buy} | Holds: ${latestRec.hold} | Sells: ${latestRec.sell} | Strong Buys: ${latestRec.strongBuy} | Strong Sells: ${latestRec.strongSell}\n\n`;
  }

  // Income statement historical (fallback if no time series data)
  if (quote?.incomeStatementHistory?.incomeStatementHistory?.length && !fundamentals?.income) {
    text += `── Income Statement History (Annual) ──\n`;
    for (const stmt of quote.incomeStatementHistory.incomeStatementHistory.slice(0, 3)) {
      const date = stmt.endDate ? new Date(stmt.endDate).toLocaleDateString("en-IN") : "N/A";
      text += `  ${date}: Revenue ${toCr(stmt.totalRevenue)} | Net Income ${toCr(stmt.netIncome)}\n`;
    }
    text += `\n`;
  }

  // Balance sheet historical (fallback if no time series data)
  if (quote?.balanceSheetHistory?.balanceSheetStatements?.length && !fundamentals?.balance) {
    text += `── Balance Sheet History (Annual) ──\n`;
    for (const bs of quote.balanceSheetHistory.balanceSheetStatements.slice(0, 3)) {
      const date = bs.endDate ? new Date(bs.endDate).toLocaleDateString("en-IN") : "N/A";
      text += `  ${date}: Assets ${toCr(bs.totalAssets)} | Liab ${toCr(bs.totalLiab)} | Equity ${toCr(bs.totalStockholderEquity)}\n`;
    }
    text += `\n`;
  }

  // Cash flow historical (fallback if no time series data)
  if (quote?.cashflowStatementHistory?.cashflowStatements?.length && !fundamentals?.cash) {
    text += `── Cash Flow History (Annual) ──\n`;
    for (const cf of quote.cashflowStatementHistory.cashflowStatements.slice(0, 3)) {
      const date = cf.endDate ? new Date(cf.endDate).toLocaleDateString("en-IN") : "N/A";
      text += `  ${date}: Op Cash ${toCr(cf.totalCashFromOperatingActivities)} | CapEx ${toCr(cf.capitalExpenditures)}\n`;
    }
    text += `\n`;
  }

  // Process fundamentalsTimeSeries data if available
  if (timeSeries) {
    // Income statement from timeSeries - show 2-3 periods max
    if (timeSeries.incomeStatementHistory?.length) {
      text += `── Income Statement (Time Series) ──\n`;
      const incomeData = timeSeries.incomeStatementHistory.slice(0, 3);
      for (const stmt of incomeData) {
        const date = stmt.asOfDate ? new Date(stmt.asOfDate).toLocaleDateString("en-IN") : "N/A";
        const revenue = stmt.totalRevenue ? (stmt.totalRevenue / 1_00_00_000).toFixed(2) : "N/A";
        const netIncome = stmt.netIncome ? (stmt.netIncome / 1_00_00_000).toFixed(2) : "N/A";
        const opMargin = stmt.totalRevenue && stmt.operatingIncome 
          ? ((stmt.operatingIncome / stmt.totalRevenue) * 100).toFixed(2) 
          : "N/A";
        text += `  ${date}: Revenue ₹${revenue}Cr | Net Income ₹${netIncome}Cr | Op Margin ${opMargin}%\n`;
      }
      text += `\n`;
    }

    // Balance sheet from timeSeries - show 2-3 periods max
    if (timeSeries.balanceSheetHistory?.length) {
      text += `── Balance Sheet (Time Series) ──\n`;
      const balanceData = timeSeries.balanceSheetHistory.slice(0, 3);
      for (const bs of balanceData) {
        const date = bs.asOfDate ? new Date(bs.asOfDate).toLocaleDateString("en-IN") : "N/A";
        const assets = bs.totalAssets ? (bs.totalAssets / 1_00_00_000).toFixed(2) : "N/A";
        const liab = bs.totalLiab ? (bs.totalLiab / 1_00_00_000).toFixed(2) : "N/A";
        const equity = bs.totalStockholderEquity ? (bs.totalStockholderEquity / 1_00_00_000).toFixed(2) : "N/A";
        const debtToEquity = bs.totalLiab && bs.totalStockholderEquity
          ? (bs.totalLiab / bs.totalStockholderEquity).toFixed(2)
          : "N/A";
        text += `  ${date}: Assets ₹${assets}Cr | Liab ₹${liab}Cr | Equity ₹${equity}Cr | D/E ${debtToEquity}x\n`;
      }
      text += `\n`;
    }

    // Cash flow from timeSeries - show 2-3 periods max
    if (timeSeries.cashflowStatementHistory?.length) {
      text += `── Cash Flow (Time Series) ──\n`;
      const cfData = timeSeries.cashflowStatementHistory.slice(0, 3);
      for (const cf of cfData) {
        const date = cf.asOfDate ? new Date(cf.asOfDate).toLocaleDateString("en-IN") : "N/A";
        const opCash = cf.operatingCashFlow ? (cf.operatingCashFlow / 1_00_00_000).toFixed(2) : "N/A";
        const freeCash = cf.freeCashFlow ? (cf.freeCashFlow / 1_00_00_000).toFixed(2) : "N/A";
        const capEx = cf.capitalExpenditures ? (cf.capitalExpenditures / 1_00_00_000).toFixed(2) : "N/A";
        text += `  ${date}: Op Cash ₹${opCash}Cr | Free Cash ₹${freeCash}Cr | CapEx ₹${capEx}Cr\n`;
      }
      text += `\n`;
    }
  }

  // Asset profile (business description) - limit to 300 chars
  if (quote?.assetProfile?.businessSummary) {
    text += `── Business Summary ──\n`;
    text += `${safeText(quote.assetProfile.businessSummary).substring(0, 300)}...\n\n`;
  }

  // Peer context
  if (peers?.length) {
    text += `── Sector Peers (Comprehensive Comparison) ──\n`;
    for (const p of peers.slice(0, 5)) {
      text += `  ${p.symbol}:\n`;
      text += `    P/E: ${fmt(p.pe)} | P/B: ${fmt(p.pb)} | ROE: ${toPct(p.roe)} | ROCE: ${toPct(p.roce)}\n`;
      text += `    D/E: ${fmt(p.debt_to_equity)} | Net Margin: ${toPct(p.net_margin)}% | Op Margin: ${toPct(p.operating_margin)}%\n`;
      text += `    Revenue: ${toCr(p.revenue_cr)} | EPS: ${fmt(p.eps)} | Div Yield: ${toPct(p.dividend_yield)}\n`;
    }
    text += `\n`;
  }

  return text;
}

/**
 * The full analysis prompt sent to Gemini.
 */
export function buildAnalysisPrompt(dataContext) {
  return `You are an expert Indian equity research analyst. Analyse the stock below and produce a comprehensive investment analysis in JSON format.

${dataContext}

Return a JSON object with EXACTLY this structure (no markdown fencing, pure JSON):
{
  "overall_score": <integer 0-100>,
  "investment_thesis": "<one-sentence thesis>",
  "sections": {
    "business_model_moat": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<key point>", "supporting_data": "<number or fact>", "implication": "<what this means>" }
      ],
      "vs_sector": "<how this compares to peers>",
      "bull": "<best-case scenario>",
      "bear": "<worst-case scenario>",
      "watch_triggers": ["<event that could change the thesis>"]
    },
    "financial_health": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<key point>", "supporting_data": "<number or fact>", "implication": "<what this means>" }
      ],
      "vs_sector": "<how this compares to peers>",
      "bull": "<best case>",
      "bear": "<worst case>",
      "watch_triggers": ["<trigger>"]
    },
    "profitability_growth": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<key point>", "supporting_data": "<number or fact>", "implication": "<what this means>" }
      ],
      "vs_sector": "<how this compares to peers>",
      "bull": "<best case>",
      "bear": "<worst case>",
      "watch_triggers": ["<trigger>"]
    },
    "balance_sheet_quality": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<key point>", "supporting_data": "<number or fact>", "implication": "<what this means>" }
      ],
      "vs_sector": "<how this compares to peers>",
      "bull": "<best case>",
      "bear": "<worst case>",
      "watch_triggers": ["<trigger>"]
    },
    "valuation_assessment": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<key point>", "supporting_data": "<number or fact>", "implication": "<what this means>" }
      ],
      "vs_sector": "<how this compares to peers>",
      "bull": "<best case>",
      "bear": "<worst case>",
      "watch_triggers": ["<trigger>"]
    },
    "sector_macro_outlook": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<key point>", "supporting_data": "<number or fact>", "implication": "<what this means>" }
      ],
      "vs_sector": "<how this compares to peers>",
      "bull": "<best case>",
      "bear": "<worst case>",
      "watch_triggers": ["<trigger>"]
    },
    "key_investment_risks": {
      "score": <integer 0-100>,
      "headline": "<one-line summary>",
      "findings": [
        { "finding": "<risk>", "supporting_data": "<evidence>", "implication": "<potential impact>" }
      ],
      "vs_sector": "<sector-relative risk level>",
      "bull": "<if risks don't materialise>",
      "bear": "<if risks do materialise>",
      "watch_triggers": ["<trigger>"]
    }
  },
  "bull_case": { "thesis": "<paragraph>", "target_upside": "<X%>" },
  "bear_case": { "thesis": "<paragraph>", "target_downside": "<X%>" },
  "peer_comparison": [
    { "symbol": "<SYMBOL>", "name": "<name>", "overall_score": <0-100>, "vs_this": "<better/worse/similar>" }
  ]
}

RULES:
- Each section MUST have 3-4 findings with supporting_data referencing actual numbers from the data above.
- Scores: 0-30 = poor, 31-50 = below average, 51-70 = average, 71-85 = good, 86-100 = excellent.
- For key_investment_risks, a LOWER score means HIGHER risk (inverted — 20 = very risky, 80 = low risk).
- vs_sector MUST reference specific actual metrics with precise numbers (e.g., "P/E 12x vs peer avg 18x", "Net Margin 15% vs sector avg 12%", "D/E 0.5x vs peer avg 0.8x").
- vs_sector should explain BUSINESS implications, not just metric differences (e.g., "Lower leverage provides stability in downturns" or "Higher margins suggest stronger pricing power and competitive advantage").
- Analyze margin trends: Compare Net Margin and Operating Margin. Indicate if expanding or contracting vs peers. What does this reveal about cost structure or pricing power?
- Evaluate working capital efficiency: Current ratio, asset turnover, days receivable/payable trends. Is the company managing cash efficiently?
- Assess capital allocation: Dividend payout ratio, capex intensity, retained earnings. How does management deploy capital?
- Identify balance sheet quality: Debt trends, interest coverage ratios, asset composition. Is the balance sheet flexible or stressed?
- Compare business durability: ROE consistency, ROCE vs cost of capital, economic moat indicators. Can this competitive advantage sustain?
- All monetary values should be in INR Crores.
- Be specific with numbers; do not say "strong" without citing the actual metric.
- peer_comparison should include 2-4 peers from the sector peers data.
- Respond with ONLY the JSON object, no markdown, no explanation.`;
}

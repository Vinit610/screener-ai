/**
 * Prompt template and data-context builder for AI stock analysis.
 * Prompt version: v2 - Sector-aware analysis with peer context
 */

export const PROMPT_VERSION = "v2";

/**
 * Sector-specific guidance to help LLM understand what metrics matter for different industries.
 * Extensible framework - add more sectors as needed.
 */
export const SECTOR_GUIDANCE = {
  "Financial Services": {
    key_message: "Banks are inherently leveraged. High debt-to-equity is NORMAL and expected.",
    focus_metrics: ["profitability (net margin trend)", "debt quality", "growth sustainability"],
    cautions: ["Do NOT penalize high D/E ratios as financial distress", "Compare ROE/ROA only within banking peers", "Dividend yield is secondary to capital adequacy"],
    interpretation_note: "Evaluate banks on profitability consistency, growth trajectory, and valuation relative to peers—not absolute debt levels.",
  },
  "IT": {
    key_message: "IT services companies are capital-light with high-margin recurring revenue.",
    focus_metrics: ["revenue growth", "operating margin stability", "return on equity", "valuation relative to growth"],
    cautions: ["High debt/equity may be unusual—investigate reason", "Compare P/E to growth rate (PEG)", "Client concentration risk is critical"],
    interpretation_note: "Focus on revenue growth sustainability, margin trends, and whether valuation is justified by growth rates.",
  },
  "Pharmaceuticals": {
    key_message: "Pharma profitability is driven by R&D efficiency and pipeline strength.",
    focus_metrics: ["revenue growth from exports", "net margin consistency", "dividend yield (mature cos)", "earnings stability"],
    cautions: ["High R&D spend reduces margins but is necessary", "Patent cliffs can impact growth suddenly", "Regulatory approvals drive value"],
    interpretation_note: "Evaluate based on margin trends, stability of earnings, and whether valuations reflect pipeline risks.",
  },
  "FMCG": {
    key_message: "FMCG stocks are consumer staples with strong moats and predictable cash flows.",
    focus_metrics: ["dividend yield", "profitability margins", "return on equity", "growth stability"],
    cautions: ["Growth rates lower than other sectors is NORMAL", "High valuations justified by dividend + stability", "Margin compression from inflation is a key risk"],
    interpretation_note: "FMCG attracts defensive investors. Evaluate on dividend sustainability, margin trends, and defensive characteristics.",
  },
  "Automobiles": {
    key_message: "Auto stocks are cyclical and sensitive to industry capacity utilization and OEM growth.",
    focus_metrics: ["revenue growth trends", "operating margins", "debt-to-equity", "return on assets"],
    cautions: ["Cyclical industry—growth can reverse quickly", "EV transition creating winners and losers", "OEM order books are leading indicators"],
    interpretation_note: "Evaluate on cycle position, cost structure, and positioning for EV transition.",
  },
  "Real Estate": {
    key_message: "Real Estate stocks depend on land bank, launch pipeline, and execution.",
    focus_metrics: ["revenue growth", "net margin", "debt levels", "project pipeline value"],
    cautions: ["Land appreciation can be volatile", "Pre-sales provide forward revenue visibility", "High leverage is typical for sector"],
    interpretation_note: "Evaluate on pre-sales growth, margin trends, and whether leverage is manageable by cash flow.",
  },
};

/**
 * Calculate how a stock ranks relative to its peers for a specific metric.
 * Returns: "Top performer", "Above average", "Average", "Below average", or "Laggard"
 */
function rankStock(metric, stockValue, peerValues) {
  if (stockValue == null) return "N/A";
  const validPeers = peerValues.filter(v => v != null && Number.isFinite(v));
  if (validPeers.length === 0) return "No peer data";
  
  const sorted = [...validPeers].sort((a, b) => a - b);
  const percentile = validPeers.filter(v => v <= stockValue).length / validPeers.length;
  
  if (percentile >= 0.75) return "Top performer";
  if (percentile >= 0.60) return "Above average";
  if (percentile >= 0.40) return "Average";
  if (percentile >= 0.25) return "Below average";
  return "Laggard";
}

/**
 * Calculate percentile rank (0-100) of stock among peers.
 */
function calculatePercentile(stockValue, peerValues) {
  if (stockValue == null) return null;
  const validPeers = peerValues.filter(v => v != null && Number.isFinite(v));
  if (validPeers.length === 0) return null;
  
  const below = validPeers.filter(v => v <= stockValue).length;
  return Math.round((below / validPeers.length) * 100);
}

/**
 * Build comprehensive peer comparison context with rankings.
 */
function buildPeerContext(symbol, stock, peers) {
  if (!peers || peers.length === 0) return "";
  
  // Collect peer metrics for comparison
  const metrics = {
    pe: [],
    pb: [],
    roe: [],
    roce: [],
    net_margin: [],
    operating_margin: [],
    dividend_yield: [],
  };
  
  peers.forEach(p => {
    metrics.pe.push(p.pe);
    metrics.pb.push(p.pb);
    metrics.roe.push(p.roe);
    metrics.roce.push(p.roce);
    metrics.net_margin.push(p.net_margin);
    metrics.operating_margin.push(p.operating_margin);
    metrics.dividend_yield.push(p.dividend_yield);
  });
  
  // Calculate averages and stock's ranking
  const peerAvg = (key) => {
    const valid = metrics[key].filter(v => v != null && Number.isFinite(v));
    return valid.length > 0 ? valid.reduce((a, b) => a + b) / valid.length : null;
  };
  
  let context = `── Peer Relative Performance ──\n`;
  context += `Comparing ${symbol} to ${peers.length} sector peers:\n\n`;
  
  // P/E Comparison
  if (stock.pe) {
    const avgPe = peerAvg('pe');
    const rank = rankStock('P/E', stock.pe, metrics.pe);
    const vs = avgPe ? (stock.pe > avgPe ? `Premium` : `Discount`) : '';
    context += `P/E: ${stock.pe.toFixed(2)}x (${rank}) ${vs !== '' ? `(${vs} vs peer avg ${avgPe?.toFixed(2)}x)` : ''}\n`;
  }
  
  // ROE Comparison (higher is better)
  if (stock.roe) {
    const avgRoe = peerAvg('roe');
    const rank = rankStock('ROE', stock.roe, metrics.roe);
    const vs = avgRoe ? (stock.roe > avgRoe ? `Higher` : `Lower`) : '';
    context += `ROE: ${(stock.roe * 100).toFixed(2)}% (${rank}) ${vs !== '' ? `(${vs} than peer avg ${(avgRoe * 100).toFixed(2)}%)` : ''}\n`;
  }
  
  // Net Margin Comparison
  if (stock.net_margin) {
    const avgMargin = peerAvg('net_margin');
    const rank = rankStock('Net Margin', stock.net_margin, metrics.net_margin);
    const vs = avgMargin ? (stock.net_margin > avgMargin ? `Higher` : `Lower`) : '';
    context += `Net Margin: ${(stock.net_margin * 100).toFixed(2)}% (${rank}) ${vs !== '' ? `(${vs} than peer avg ${(avgMargin * 100).toFixed(2)}%)` : ''}\n`;
  }
  
  // Dividend Yield Comparison
  if (stock.dividend_yield) {
    const avgDiv = peerAvg('dividend_yield');
    const rank = rankStock('Dividend Yield', stock.dividend_yield, metrics.dividend_yield);
    const vs = avgDiv ? (stock.dividend_yield > avgDiv ? `Above` : `Below`) : '';
    context += `Dividend Yield: ${(stock.dividend_yield * 100).toFixed(2)}% (${rank}) ${vs !== '' ? `(${vs} peer avg ${(avgDiv * 100).toFixed(2)}%)` : ''}\n`;
  }
  
  context += `\n`;
  return context;
}

/**
 * Build a text representation of the financial data for the LLM.
 */
export function buildDataContext(symbol, quote, financialData, fundamentals, chart, peers, timeSeries, dataSource, impliedVolatility, sector) {
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
  
  // Safe date parser: handles string dates, timestamps, and invalid inputs
  const safeDate = (dateInput) => {
    if (!dateInput) return "N/A";
    try {
      // If it's a number (milliseconds since epoch), use it directly
      let d;
      if (typeof dateInput === 'number') {
        d = new Date(dateInput);
      } else if (typeof dateInput === 'string') {
        // Try parsing the string
        d = new Date(dateInput);
      } else {
        return "N/A";
      }
      // Check if date is valid
      if (isNaN(d.getTime())) return "N/A";
      return d.toLocaleDateString("en-IN");
    } catch (err) {
      return "N/A";
    }
  };
  
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
  
  let exchangeInfo = "Exchange: NSE";
  if (dataSource?.nse && dataSource?.bse) {
    exchangeInfo = "Exchange: NSE + BSE (merged)";
  } else if (dataSource?.bse) {
    exchangeInfo = "Exchange: BSE";
  }
  text += `Market Cap: ${toCr(pr.marketCap)} | ${exchangeInfo}\n\n`;

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
      const date = safeDate(earning.epsReportDate);
      text += `  ${date}: EPS Reported ${fmt(earning.epsActual)} vs Estimate ${fmt(earning.epsEstimate)}\n`;
    }
    text += `\n`;
  }

  // Dividend history
  if (quote?.dividends?.event?.length) {
    text += `── Dividend History ──\n`;
    for (const div of quote.dividends.event.slice(0, 5)) {
      const date = safeDate(div.parseDate);
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
      const date = safeDate(latest.transactionDate);
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

  // Analyst Sentiment & Target Price
  if (quote?.recommendationTrend?.trend?.length) {
    const latestRec = quote.recommendationTrend.trend[0];
    const totalRecs = (latestRec.strongBuy || 0) + (latestRec.buy || 0) + (latestRec.hold || 0) + (latestRec.sell || 0) + (latestRec.strongSell || 0);
    const bullishPct = totalRecs > 0 ? (((latestRec.strongBuy || 0) + (latestRec.buy || 0)) / totalRecs * 100).toFixed(1) : "N/A";
    text += `── Analyst Sentiment ──\n`;
    text += `  Strong Buy: ${latestRec.strongBuy || 0} | Buy: ${latestRec.buy || 0} | Hold: ${latestRec.hold || 0} | Sell: ${latestRec.sell || 0} | Strong Sell: ${latestRec.strongSell || 0}\n`;
    text += `  Bullish Consensus: ${bullishPct}%\n`;
    if (quote?.summaryDetail?.targetMeanPrice) {
      text += `  Target Mean Price: ₹${fmt(quote.summaryDetail.targetMeanPrice)}\n`;
    }
    text += `\n`;
  }

  // Upcoming Events & Catalysts
  if (quote?.calendarEvents) {
    const events = [];
    if (quote.calendarEvents.earnings?.length) {
      const earningsDate = new Date(quote.calendarEvents.earnings[0].date).toLocaleDateString("en-IN");
      events.push(`Earnings: ${earningsDate}`);
    }
    if (quote.calendarEvents.dividends?.length) {
      const divDate = new Date(quote.calendarEvents.dividends[0].date).toLocaleDateString("en-IN");
      events.push(`Dividend Ex-Date: ${divDate}`);
    }
    if (events.length) {
      text += `── Upcoming Events ──\n`;
      for (const evt of events) text += `  • ${evt}\n`;
      text += `\n`;
    }
  }

  // Bid-Ask Spread & Liquidity (from summaryDetail)
  if (quote?.summaryDetail) {
    const sd = quote.summaryDetail;
    text += `── Liquidity & Volatility ──\n`;
    if (sd.bid && sd.ask) {
      const spread = ((sd.ask - sd.bid) / sd.bid * 100).toFixed(2);
      text += `  Bid-Ask Spread: ${spread}%\n`;
    }
    if (sd.volume) text += `  Volume: ${(sd.volume / 1000000).toFixed(2)}M shares\n`;
    if (sd.averageVolume) text += `  Avg Volume: ${(sd.averageVolume / 1000000).toFixed(2)}M shares\n`;
    if (sd.beta) text += `  Beta: ${fmt(sd.beta)}\n`;
    if (impliedVolatility) text += `  Implied Volatility: ${toPct(impliedVolatility)}\n`;
    text += `\n`;
  }

  // Technical Indicators from Fundamentals
  if (quote?.defaultKeyStatistics) {
    const ks = quote.defaultKeyStatistics;
    const currentPrice = quote?.price?.regularMarketPrice ?? pr?.currentPrice;
    text += `── Technical Metrics ──\n`;
    if (ks.fiftyTwoWeekHigh && ks.fiftyTwoWeekLow && currentPrice) {
      const distance = ((currentPrice - ks.fiftyTwoWeekLow) / (ks.fiftyTwoWeekHigh - ks.fiftyTwoWeekLow) * 100).toFixed(1);
      text += `  52-Week Range: ₹${fmt(ks.fiftyTwoWeekLow)} - ₹${fmt(ks.fiftyTwoWeekHigh)} (Current: ${distance}% of range)\n`;
    }
    if (ks.priceToBook) text += `  P/B Ratio: ${fmt(ks.priceToBook)}x\n`;
    if (ks.pegRatio) text += `  PEG Ratio: ${fmt(ks.pegRatio)}\n`;
    text += `\n`;
  }

  // Upgrade/Downgrade History
  if (quote?.upgradeDowngradeHistory?.history?.length) {
    text += `── Recent Analyst Actions ──\n`;
    for (const action of quote.upgradeDowngradeHistory.history.slice(0, 3)) {
      const date = new Date(action.epochGradeDate * 1000).toLocaleDateString("en-IN");
      text += `  ${date}: ${action.firm} - ${action.action}\n`;
    }
    text += `\n`;
  }

  // Add peer ranking context
  if (peers?.length) {
    const stock = {
      pe: sd.trailingPE,
      roe: fd.returnOnEquity,
      net_margin: fd.profitMargins,
      dividend_yield: sd.dividendYield,
    };
    text += buildPeerContext(symbol, stock, peers);
  }

  // Peer context - detailed list
  if (peers?.length) {
    text += `── Sector Peers (Comprehensive Comparison) ──\n`;
    for (const p of peers.slice(0, 5)) {
      text += `  ${p.symbol}:\n`;
      text += `    P/E: ${fmt(p.pe)} | P/B: ${fmt(p.pb)} | ROE: ${toPct(p.roe)} | ROCE: ${toPct(p.roce)}\n`;
      text += `    D/E: ${fmt(p.debt_to_equity)} | Net Margin: ${toPct(p.net_margin)} | Op Margin: ${toPct(p.operating_margin)}\n`;
      text += `    Revenue: ${toCr(p.revenue_cr)} | EPS: ${fmt(p.eps)} | Div Yield: ${toPct(p.dividend_yield)}\n`;
    }
    text += `\n`;
  }

  return text;
}

/**
 * The full analysis prompt sent to LLM.
 */
export function buildAnalysisPrompt(dataContext, sector) {
  // Add sector guidance if available
  let sectorContext = '';
  if (sector && SECTOR_GUIDANCE[sector]) {
    const guidance = SECTOR_GUIDANCE[sector];
    sectorContext = `

[SECTOR ANALYSIS GUIDANCE: ${sector}]
${guidance.key_message}

Key metrics to focus on: ${guidance.focus_metrics.join(", ")}

Important cautions:
${guidance.cautions.map(c => `- ${c}`).join("\n")}

Analysis approach: ${guidance.interpretation_note}
`;
  }

  return `You are an expert Indian equity research analyst specializing in deep fundamental analysis. Analyse the stock below and produce a comprehensive investment analysis in JSON format.

${sectorContext}

${dataContext}

Return a JSON object with EXACTLY this structure (no markdown fencing, pure JSON):
{
  "overall_score": <integer 0-100>,
  "investment_thesis": "<Comprehensive thesis>",
  "sections": {
    "business_model_moat": {
      "score": <integer 0-100>,
      "headline": "<brief summary>",
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
      "headline": "<brief summary>",
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
      "headline": "<brief summary>",
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
      "headline": "<brief summary>",
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
      "headline": "<brief summary>",
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
      "headline": "<brief summary>",
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
      "headline": "<brief summary>",
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
- NO HALLUCINATIONS: If a specific peer metric is unavailable, use "N/A" rather than guessing.
- Respond with ONLY the JSON object, no markdown, no explanation.`;
}

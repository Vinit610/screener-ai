/**
 * Prompt template and data-context builder for AI stock analysis.
 * Prompt version: v2 - Sector-aware analysis with peer context
 */

export const PROMPT_VERSION = "v4";

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

// ── Sector-specific D/E thresholds (what's "normal" varies by sector) ──
const SECTOR_DE_THRESHOLDS = {
  "Financial Services": { low: 5, mid: 10, high: 15 },   // banks are inherently leveraged
  "Real Estate":        { low: 1.0, mid: 2.0, high: 3.5 },
  "Utilities":          { low: 1.0, mid: 2.0, high: 3.0 },
  "default":            { low: 0.5, mid: 1.0, high: 2.0 },
};

/**
 * Compute a deterministic quantitative score (0-100) purely from financial data.
 * This removes LLM scoring bias — LLM can only adjust ±15 from this base.
 *
 * Components (weights sum to 100):
 *   Profitability  25%  — ROE, net margin, operating margin
 *   Valuation      20%  — P/E reasonableness, PEG, P/B
 *   Financial Hlth 20%  — D/E (sector-adjusted), current ratio, cash-to-debt
 *   Growth         20%  — Revenue growth, earnings growth, FCF
 *   Momentum       15%  — Price vs 200 DMA, 52-week range position
 */
export function computeQuantScore(fundamentals, peers, sector, chart) {
  const f = fundamentals ?? {};
  const scores = {};
  const breakdown = {};

  // Helper: clamp 0-100
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

  // Helper: percentile rank among peers for a metric (higher value = higher rank)
  const peerPercentile = (stockVal, peerKey, higherIsBetter = true) => {
    if (stockVal == null) return 50; // neutral if no data
    const vals = (peers ?? []).map(p => p[peerKey]).filter(v => v != null && Number.isFinite(v));
    if (vals.length === 0) return 50;
    const allVals = [...vals, stockVal].sort((a, b) => a - b);
    const rank = allVals.indexOf(stockVal) / (allVals.length - 1); // 0 to 1
    return higherIsBetter ? rank * 100 : (1 - rank) * 100;
  };

  // ── 1. Profitability (25%) ──
  {
    let profScore = 50; // neutral default
    let components = [];

    // ROE: 0% → 0, 10% → 40, 20% → 70, 30%+ → 90
    if (f.roe != null) {
      const roeScore = clamp(f.roe * 100 * 3); // roe is decimal e.g. 0.15
      const roePeer = peerPercentile(f.roe, 'roe', true);
      components.push((roeScore * 0.5 + roePeer * 0.5)); // blend absolute + relative
    }

    // Net margin: negative → bad, 0-5% → poor, 5-15% → ok, 15-25% → good, 25%+ → great
    if (f.net_margin != null) {
      let marginScore;
      if (f.net_margin < 0) marginScore = clamp(10 + f.net_margin * 100); // penalize losses
      else marginScore = clamp(f.net_margin * 100 * 3);
      const marginPeer = peerPercentile(f.net_margin, 'net_margin', true);
      components.push((marginScore * 0.5 + marginPeer * 0.5));
    }

    // Operating margin
    if (f.operating_margin != null) {
      let opScore;
      if (f.operating_margin < 0) opScore = clamp(10 + f.operating_margin * 100);
      else opScore = clamp(f.operating_margin * 100 * 2.5);
      components.push(opScore);
    }

    if (components.length > 0) {
      profScore = components.reduce((a, b) => a + b) / components.length;
    }
    scores.profitability = clamp(profScore);
    breakdown.profitability = { score: scores.profitability, roe: f.roe, net_margin: f.net_margin, operating_margin: f.operating_margin };
  }

  // ── 2. Valuation (20%) ──
  {
    let valScore = 50;
    let components = [];

    // P/E: <0 (loss-making) → 15, 0-10 → 85, 10-20 → 70, 20-40 → 50, 40-80 → 30, 80+ → 15
    if (f.pe != null) {
      let peScore;
      if (f.pe < 0) peScore = 15; // loss-making
      else if (f.pe <= 10) peScore = 85;
      else if (f.pe <= 20) peScore = 75 - (f.pe - 10) * 0.5;
      else if (f.pe <= 40) peScore = 60 - (f.pe - 20) * 1.0;
      else if (f.pe <= 80) peScore = 35 - (f.pe - 40) * 0.25;
      else peScore = 15;
      const pePeer = peerPercentile(f.pe, 'pe', false); // lower P/E is better
      components.push((peScore * 0.4 + pePeer * 0.6)); // weight peer comparison more
    }

    // PEG: <1 → great value, 1-2 → fair, 2-3 → expensive, >3 → very expensive
    if (f.peg != null && f.peg > 0) {
      let pegScore;
      if (f.peg <= 0.5) pegScore = 90;
      else if (f.peg <= 1.0) pegScore = 80;
      else if (f.peg <= 1.5) pegScore = 65;
      else if (f.peg <= 2.0) pegScore = 50;
      else if (f.peg <= 3.0) pegScore = 35;
      else pegScore = 20;
      components.push(pegScore);
    }

    // P/B: context-dependent but lower generally better
    if (f.pb != null) {
      let pbScore;
      if (f.pb < 0) pbScore = 10;
      else if (f.pb <= 1) pbScore = 80;
      else if (f.pb <= 3) pbScore = 65;
      else if (f.pb <= 5) pbScore = 45;
      else pbScore = 25;
      components.push(pbScore * 0.5); // lower weight
    }

    if (components.length > 0) {
      valScore = components.reduce((a, b) => a + b) / components.length;
    }
    scores.valuation = clamp(valScore);
    breakdown.valuation = { score: scores.valuation, pe: f.pe, peg: f.peg, pb: f.pb };
  }

  // ── 3. Financial Health (20%) ──
  {
    let healthScore = 50;
    let components = [];

    // D/E: sector-adjusted
    if (f.debt_to_equity != null) {
      const thresholds = SECTOR_DE_THRESHOLDS[sector] ?? SECTOR_DE_THRESHOLDS["default"];
      let deScore;
      if (f.debt_to_equity <= thresholds.low) deScore = 85;
      else if (f.debt_to_equity <= thresholds.mid) deScore = 65;
      else if (f.debt_to_equity <= thresholds.high) deScore = 40;
      else deScore = 20;
      components.push(deScore);
    }

    // Current ratio: <1 → distress, 1-1.5 → tight, 1.5-3 → healthy, >3 → excess cash
    if (f.current_ratio != null) {
      let crScore;
      if (f.current_ratio < 0.5) crScore = 15;
      else if (f.current_ratio < 1.0) crScore = 35;
      else if (f.current_ratio < 1.5) crScore = 60;
      else if (f.current_ratio <= 3.0) crScore = 80;
      else crScore = 65; // too much idle cash
      components.push(crScore);
    }

    // Cash-to-debt ratio: higher is better
    if (f.cash_to_debt != null) {
      let cashScore;
      if (f.cash_to_debt >= 1.0) cashScore = 85; // more cash than debt
      else if (f.cash_to_debt >= 0.5) cashScore = 65;
      else if (f.cash_to_debt >= 0.2) cashScore = 45;
      else cashScore = 25;
      components.push(cashScore);
    }

    if (components.length > 0) {
      healthScore = components.reduce((a, b) => a + b) / components.length;
    }
    scores.financial_health = clamp(healthScore);
    breakdown.financial_health = { score: scores.financial_health, debt_to_equity: f.debt_to_equity, current_ratio: f.current_ratio, cash_to_debt: f.cash_to_debt };
  }

  // ── 4. Growth (20%) ──
  {
    let growthScore = 50;
    let components = [];

    // Revenue growth: negative → bad, 0-5% → slow, 5-15% → moderate, 15-30% → strong, 30%+ → hyper
    if (f.revenue_growth != null) {
      let revScore;
      if (f.revenue_growth < -0.10) revScore = 10;
      else if (f.revenue_growth < 0) revScore = 30;
      else if (f.revenue_growth < 0.05) revScore = 45;
      else if (f.revenue_growth < 0.15) revScore = 65;
      else if (f.revenue_growth < 0.30) revScore = 80;
      else revScore = 92;
      components.push(revScore);
    }

    // Earnings growth
    if (f.earnings_growth != null) {
      let earnScore;
      if (f.earnings_growth < -0.20) earnScore = 10;
      else if (f.earnings_growth < 0) earnScore = 30;
      else if (f.earnings_growth < 0.10) earnScore = 50;
      else if (f.earnings_growth < 0.25) earnScore = 70;
      else if (f.earnings_growth < 0.50) earnScore = 85;
      else earnScore = 92;
      components.push(earnScore);
    }

    // Free cash flow: positive is good, negative is concerning
    if (f.free_cash_flow != null) {
      let fcfScore;
      if (f.free_cash_flow < 0) fcfScore = 20;
      else if (f.free_cash_flow < 100) fcfScore = 45; // small FCF (<100 Cr)
      else if (f.free_cash_flow < 1000) fcfScore = 65;
      else fcfScore = 80;
      components.push(fcfScore * 0.5); // lower weight
    }

    if (components.length > 0) {
      growthScore = components.reduce((a, b) => a + b) / components.length;
    }
    scores.growth = clamp(growthScore);
    breakdown.growth = { score: scores.growth, revenue_growth: f.revenue_growth, earnings_growth: f.earnings_growth, free_cash_flow: f.free_cash_flow };
  }

  // ── 5. Momentum (15%) ──
  {
    let momentumScore = 50;
    let components = [];

    // Price vs 200 DMA: above → bullish, below → bearish
    if (f.fifty_day_ma != null && f.two_hundred_day_ma != null) {
      // 50 DMA vs 200 DMA (golden cross / death cross)
      const maRatio = f.fifty_day_ma / f.two_hundred_day_ma;
      if (maRatio > 1.05) components.push(80); // strong uptrend
      else if (maRatio > 1.0) components.push(65);
      else if (maRatio > 0.95) components.push(40);
      else components.push(20); // strong downtrend
    }

    // 52-week range position from chart
    if (f.fifty_two_week_high != null && f.fifty_two_week_low != null) {
      // Try to get current price from chart
      const quotes = chart?.quotes;
      const currentPrice = quotes?.length ? quotes[quotes.length - 1]?.close : null;
      if (currentPrice && f.fifty_two_week_high > f.fifty_two_week_low) {
        const rangePosition = (currentPrice - f.fifty_two_week_low) / (f.fifty_two_week_high - f.fifty_two_week_low);
        // Mid-range is neutral; near highs slightly positive; near lows negative
        if (rangePosition > 0.8) components.push(75);
        else if (rangePosition > 0.5) components.push(65);
        else if (rangePosition > 0.3) components.push(45);
        else components.push(25);
      }
    }

    // Beta: high beta → higher risk, slightly penalize
    if (f.beta != null) {
      if (f.beta > 1.5) components.push(30);
      else if (f.beta > 1.2) components.push(45);
      else if (f.beta > 0.8) components.push(60);
      else components.push(55); // very low beta → defensive
    }

    if (components.length > 0) {
      momentumScore = components.reduce((a, b) => a + b) / components.length;
    }
    scores.momentum = clamp(momentumScore);
    breakdown.momentum = { score: scores.momentum, fifty_day_ma: f.fifty_day_ma, two_hundred_day_ma: f.two_hundred_day_ma, beta: f.beta };
  }

  // ── Weighted overall ──
  const overall = clamp(
    scores.profitability * 0.25 +
    scores.valuation * 0.20 +
    scores.financial_health * 0.20 +
    scores.growth * 0.20 +
    scores.momentum * 0.15
  );

  return {
    overall,
    components: scores,
    breakdown,
  };
}

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
export function buildDataContext(symbol, quote, financialData, fundamentals, chart, peers, timeSeries, dataSource, impliedVolatility, sector, trends) {
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

  // Add historical trends (5-year) if available
  if (trends && Object.keys(trends).length > 0) {
    // Format trends into compact LLM-friendly summary
    text += `── Historical Trends (5-Year) ──\n`;

    // P/E trending
    if (trends.pe) {
      const { current, median, cagr, direction } = trends.pe;
      const vsMedian = current > median ? 'above' : 'below';
      text += `P/E: ${current}x (median: ${median}x, ${vsMedian} median, direction: ${direction})`;
      if (cagr !== null && cagr !== undefined) text += ` [CAGR: ${cagr > 0 ? '+' : ''}${cagr}%]`;
      text += `\n`;
    }

    // Margin trends (sm object contains npm, opm, gpm)
    if (trends.sm) {
      // Try different possible keys for margins
      const npmData = trends.sm.npm || trends.sm.NPM;
      if (npmData) {
        const { current, median, cagr, direction } = npmData;
        text += `Net Margin: ${current}% (median: ${median}%, trend: ${direction})`;
        if (cagr !== null && cagr !== undefined) text += ` [CAGR: ${cagr > 0 ? '+' : ''}${cagr}%]`;
        text += `\n`;
      }

      const opmData = trends.sm.opm || trends.sm.OPM;
      if (opmData) {
        const { current, median, cagr, direction } = opmData;
        text += `Operating Margin: ${current}% (median: ${median}%, trend: ${direction})`;
        if (cagr !== null && cagr !== undefined) text += ` [CAGR: ${cagr > 0 ? '+' : ''}${cagr}%]`;
        text += `\n`;
      }
    }

    // P/B trending
    if (trends.ptb) {
      const { current, median, direction } = trends.ptb;
      const vsMedian = current > median ? 'above' : 'below';
      text += `P/B: ${current}x (median: ${median}x, trend: ${direction})\n`;
    }

    // EV/EBITDA trending
    if (trends.evebitda) {
      const { current, median, direction } = trends.evebitda;
      const vsMedian = current > median ? 'above' : 'below';
      text += `EV/EBITDA: ${current}x (median: ${median}x, trend: ${direction})\n`;
    }

    // Market Cap/Sales
    if (trends.mcs) {
      const { current, median, direction } = trends.mcs;
      text += `MCS: ${current}x (median: ${median}x, trend: ${direction})\n`;
    }

    text += `\n`;
  }

  return text;
}

/**
 * The full analysis prompt sent to LLM — NARRATIVE-FIRST v4
 *
 * Philosophy: Numbers support the story, NOT the other way around.
 * Each section reads like institutional research: lead with "why",
 * cite numbers in parentheses as evidence, synthesize conclusions.
 */
export function buildAnalysisPrompt(dataContext, sector, quantScore) {
  let sectorContext = '';
  if (sector && SECTOR_GUIDANCE[sector]) {
    const guidance = SECTOR_GUIDANCE[sector];
    sectorContext = `
[SECTOR CONTEXT: ${sector}]
Core principle: ${guidance.key_message}
Priority metrics: ${guidance.focus_metrics.join(", ")}
Cautions:
${guidance.cautions.map(c => `• ${c}`).join("\n")}
Analytical lens: ${guidance.interpretation_note}
`;
  }

  let quantContext = '';
  if (quantScore) {
    const c = quantScore.components;
    quantContext = `
[QUANTITATIVE FOUNDATION: ${quantScore.overall}/100]
  Profitability (25%):    ${c.profitability}/100
  Valuation (20%):        ${c.valuation}/100
  Financial Health (20%): ${c.financial_health}/100
  Growth (20%):           ${c.growth}/100
  Momentum (15%):         ${c.momentum}/100

Your overall_score MUST = quant_base_score (${quantScore.overall}) + score_adjustment (integer -15 to +15).
Adjust UP (+5 to +15): strong moat, management excellence, hidden catalysts.
Adjust DOWN (-5 to -15): governance risk, structural headwinds, cyclical downswing.
`;
  }

  return `You are a senior equity research analyst with 15+ years covering Indian markets. Produce an institutional-grade investment research note. Your writing must be NARRATIVE-FIRST: lead with insight and reasoning, cite numbers in parentheses as supporting evidence.

CRITICAL WRITING RULES:
1. NARRATIVE FIRST: Lead every paragraph with the analytical insight ("why"), then cite numbers in parentheses. BAD: "P/E is 18x. Moderate valuation." GOOD: "The stock commands a modest premium to peers because its earnings growth trajectory (12% CAGR) justifies a slightly elevated multiple (18x P/E vs sector median 15x), implying a PEG of 1.5x—cheaper than peers on a growth-adjusted basis."
2. EXPLAIN THE WHY: For every claim, explain WHY it matters. Don't just state "high debt"—explain what that debt means for dividend safety, for refinancing risk, for flexibility to invest counter-cyclically.
3. SYNTHESIZE MULTIPLE DATA POINTS: Connect metrics into conclusions. "Margins expanded 150bps YoY (11% vs 9.5%) BECAUSE operating leverage kicked in as revenue scaled faster than fixed costs—this is quality growth, not just topline expansion."
4. NUMBERS IN PARENTHESES: Weave metrics naturally into sentences. "The company generates consistent returns (ROE 18-20%, above peer median 12%) suggesting durable competitive advantage rather than cyclical luck."
5. BE VERBOSE WHERE IT ADDS INSIGHT: Each narrative field should be 2-3 substantive paragraphs. One-liners are unacceptable. Show your analytical reasoning chain.
6. PEER COMPARISONS MUST BE SPECIFIC: "P/E 18x vs TCS 25x and Infosys 22x—cheapest among large-cap IT on absolute basis, and cheapest on PEG (1.5x vs 2.1x and 1.8x)"—not "moderate valuation vs peers."

${sectorContext}
${quantContext}

${dataContext}

Return a JSON object with EXACTLY this structure (no markdown, pure JSON):
{
  "quant_base_score": ${quantScore?.overall ?? '"N/A"'},
  "score_adjustment": <integer -15 to +15>,
  "adjustment_rationale": "<2-3 sentences connecting qualitative reasoning to the numerical adjustment>",
  "overall_score": <integer 0-100, must equal quant_base_score + score_adjustment>,

  "executive_summary": {
    "one_liner": "<15-20 word thesis capturing the essential investment case>",
    "paragraph": "<3-4 sentences: (1) What is the business, (2) Why it matters now, (3) Key opportunity or risk, (4) Verdict>"
  },

  "investment_thesis": "<2-3 paragraph narrative. Lead with the compelling reason to own or avoid. Cite financial evidence in parentheses. Connect business model → competitive advantage → financial performance → valuation → catalyst. This is the 'story' an investor reads first.>",

  "sections": {
    "business_model_moat": {
      "score": <integer 0-100>,
      "narrative": "<2-3 paragraphs. Start with WHY this business is defensible. Pricing power? Brand loyalty? Switching costs? Network effects? Integrate metrics naturally: 'Consistent ROE of 18-20% (vs peer avg 12%) over 5 years suggests sustainable competitive advantage rather than cyclical strength.' Explain what could erode the moat.>",
      "key_strengths": ["<competitive advantage with supporting metric in parentheses>"],
      "vulnerabilities": ["<risk to moat with potential impact quantified>"],
      "bull_case": "<1 paragraph: If moat strengthens, how large could this business become? Reference TAM, share gains, pricing power with data.>",
      "bear_case": "<1 paragraph: How could the moat erode? Competition, disruption, regulation? Cite why credible.>",
      "watch": ["<Specific metric with baseline and trigger threshold>"]
    },

    "financial_health": {
      "score": <integer 0-100>,
      "narrative": "<2-3 paragraphs on balance sheet strength. Lead with capital structure story: Is debt manageable? Compare to sector norms. Connect debt → cash generation → flexibility. Example: 'D/E of 1.2x appears elevated for capital-light IT (vs peer avg 0.6x), BUT FCF conversion of 85% and interest coverage of 4.5x means the company generates sufficient cash to service debt comfortably. The key question is trend direction—is leverage improving or deteriorating?'>",
      "debt_analysis": "<1 paragraph: Absolute debt vs peers, trend direction, coverage ratios (interest coverage, debt/EBITDA). Conclude: manageable or concerning?>",
      "liquidity_assessment": "<1 paragraph: Current ratio, quick ratio, cash conversion. Is cash tied up in inventory/receivables or flowing freely? Trend?>",
      "bull_case": "<1 paragraph: If balance sheet strengthens, what unlocks? Dividends? M&A? Growth capex?>",
      "bear_case": "<1 paragraph: If stress occurs, what's the risk? Dividend cuts? Equity dilution? Covenant breach?>",
      "watch": ["<Observable metric with trigger: 'D/E above 1.5x triggers covenant concern'>"]
    },

    "profitability_growth": {
      "score": <integer 0-100>,
      "narrative": "<2-3 paragraphs. Lead with growth trajectory and profitability quality. Example: 'Revenue CAGR of 15% over 5 years (above sector 10%) indicates market share gains. Simultaneously, net margin expanded from 8% to 11%, suggesting operational leverage—this is quality growth. However, YoY momentum has decelerated from 18% to 12%, warranting caution.' Explain: Is growth structural or cyclical? Can margins sustain if growth slows?>",
      "revenue_analysis": "<1 paragraph: Historical growth (5yr CAGR, recent YoY, quarterly momentum). Direction: accelerating, decelerating, stable? Comparison to sector.>",
      "margin_analysis": "<1 paragraph: Net margin, operating margin trends. Expanding or contracting? Why? Pricing power, cost discipline, or mix shift? Peer comparison.>",
      "cash_generation": "<1 paragraph: FCF as % of net income. Is earnings quality real or accounting? Capital intensity (capex/revenue). Cash conversion trend.>",
      "bull_case": "<1 paragraph: If growth accelerates AND margins expand, what's the prize? Earnings CAGR? Multiple expansion?>",
      "bear_case": "<1 paragraph: If growth stalls and margins compress, what's the downside? Commoditization? Competition?>",
      "watch": ["<Key trigger with threshold: 'Quarterly growth below 8% signals momentum loss'>"]
    },

    "balance_sheet_quality": {
      "score": <integer 0-100>,
      "narrative": "<2 paragraphs. Consolidated view of asset quality, liability composition, capital structure. Is this a fortress balance sheet or a house of cards? Lead with: Is the balance sheet built to create or extract value? Integrate asset composition, liability structure, hidden risks.>",
      "capital_allocation": "<1 paragraph: How does management deploy capital? Organic capex vs acquisitions vs dividends vs buybacks vs debt reduction. Has it created value historically?>",
      "hidden_risks": "<1 paragraph: Contingent liabilities, operating leases, pension obligations, tax disputes, legal risks. Material or immaterial?>",
      "bull_case": "<1 paragraph: If capital structure improves, what unlocks?>",
      "bear_case": "<1 paragraph: If hidden liabilities surface or stress occurs, what's the risk?>",
      "watch": ["<Observable trigger with threshold>"]
    },

    "valuation_assessment": {
      "score": <integer 0-100>,
      "narrative": "<MOST CRITICAL SECTION. 2-3 paragraphs answering: Is this cheap or expensive and WHY? MUST connect P/E to growth (PEG), P/B to ROE (justified P/B), dividend yield to payout ratio (sustainability). Example: 'At 18x P/E, RELIANCE appears moderately valued. But with 12% earnings growth, the PEG is 1.5x. Peers trade at: TCS P/E 25x with 10% growth (PEG 2.5x), ITC P/E 15x with 4% growth (PEG 3.75x). On growth-adjusted basis, RELIANCE is CHEAPEST despite highest absolute P/E. Furthermore, P/B of 2.1x is justified by ROE of 15% (implied P/B at 10% CoE = 1.5x), suggesting modest premium for franchise value. The real question: if growth disappoints to 8%, P/E should compress to 14x (22% downside). If growth reaccelerates to 16%, P/E could expand to 22x (22% upside). Risk-reward skews slightly positive.'>",
      "pe_analysis": "<1 paragraph: P/E vs historical range, vs sector avg, vs specific peers (cite names and numbers). What explains deviation from history/peers?>",
      "growth_adjusted": "<1 paragraph: PEG analysis. Connect P/E to growth rate. Compare PEG vs specific peer PEGs. Verdict: cheap, fair, or expensive on growth-adjusted basis?>",
      "asset_valuation": "<1 paragraph: P/B vs ROE. Justified P/B = ROE / Cost of Equity. Is market pricing franchise value appropriately? Compare to peers.>",
      "yield_analysis": "<1 paragraph: Dividend yield, FCF yield (FCF/Market Cap), payout ratio. Is dividend safe? Is FCF yield attractive? Compare to peers.>",
      "bull_case": "<1 paragraph: Under what scenario is this a bargain? Growth reacceleration? Margin expansion? Sentiment normalization? Give upside target.>",
      "bear_case": "<1 paragraph: Under what scenario is this expensive? Growth disappointment? Margin compression? Give downside target.>",
      "watch": ["<Trigger: 'LTM growth below 10% triggers multiple compression risk'>"]
    },

    "sector_macro_outlook": {
      "score": <integer 0-100>,
      "narrative": "<2 paragraphs. Where is the industry in its cycle? Growth, mature, or declining? What macro tailwinds/headwinds affect this sector? Is THIS company positioned to benefit or suffer? Connect sector dynamics to company-specific positioning.>",
      "tailwinds": ["<Specific positive factor with data>"],
      "headwinds": ["<Specific negative factor with data>"],
      "bull_case": "<1 paragraph: If sector tailwinds accelerate and company executes?>",
      "bear_case": "<1 paragraph: If sector headwinds intensify or company stumbles?>",
      "watch": ["<Sector-level trigger to monitor>"]
    },

    "key_investment_risks": {
      "score": <integer 0-100, INVERTED: 20 = very risky, 80 = low risk>,
      "narrative": "<2 paragraphs synthesizing top 2-3 risks. For each: (1) evidence it's real, (2) why it matters (quantify downside), (3) timeline, (4) what you're watching. Example: 'The primary risk is margin compression. Gross margins slipped from 35% to 33% in recent quarters due to input inflation. If structural (labor cost ratchet), margins could settle at 30%, implying 15% earnings downside. We're watching: (a) quarterly margin trend for stabilization, (b) price realization in next 2 quarters, (c) peer margin trends for comparison.'>",
      "primary_risks": [
        {
          "risk": "<Description>",
          "evidence": "<Why credible—cite data or trends>",
          "impact": "<Quantified downside if realized>",
          "timeline": "<imminent/6-12mo/2yr>",
          "monitor": "<Observable metric or event>"
        }
      ],
      "watch": ["<Specific warning trigger with threshold>"]
    }
  },

  "bull_case_thesis": {
    "narrative": "<2 paragraphs telling the complete bull story. Why should an investor own this? Business strength → growth catalysts → valuation opportunity → macro tailwinds. Cite specific numbers. Conclude with return potential over 2-3 years.>",
    "return_target": "<percentage, e.g. '25-35%'>",
    "key_catalysts": [
      {"catalyst": "<Specific event or milestone>", "timeframe": "<6-12mo / 1-2yr / 2-3yr>"}
    ]
  },

  "bear_case_thesis": {
    "narrative": "<2 paragraphs telling the complete bear story. Why avoid? Moat erosion → growth deceleration → valuation compression → macro headwinds. Cite specific numbers. Conclude with downside risk.>",
    "return_target": "<percentage, typically negative, e.g. '-15 to -25%'>",
    "key_risks": [
      {"risk": "<Event or data point confirming bear thesis>", "timeframe": "<6-12mo / 1-2yr / 2-3yr>"}
    ]
  },

  "catalysts": [
    {
      "event": "<Specific upcoming event>",
      "timeframe": "<Expected timing>",
      "impact_if_positive": "<How this helps>",
      "impact_if_negative": "<How this hurts>"
    }
  ],

  "peer_comparison": {
    "narrative": "<1-2 paragraphs comparing to 2-4 peers. Who is best-in-sector? Who is cheapest? On a growth-adjusted basis, where does this stock rank? Is there a better alternative?>",
    "peers": [
      {
        "symbol": "<SYMBOL>",
        "name": "<Full name>",
        "comparison": "<1-2 sentences: How does this peer compare on key metrics? Why buy this stock instead of the peer, or vice versa?>",
        "metrics": {"pe": "<Xnumber>", "roe": "<X%>", "growth": "<X%>", "dividend_yield": "<X%>"}
      }
    ]
  },

  "recommendation": {
    "action": "<BUY / HOLD / AVOID>",
    "qualifier": "<Qualify: 'BUY on dips below ₹X' or 'HOLD with ₹X target' or 'AVOID until Y improves'>",
    "key_metrics_to_track": [
      "<Specific metric with target: 'Quarterly earnings growth >12% to justify 18x P/E'>",
      "<Specific metric with target: 'Operating margin >12% confirms quality growth'>",
      "<Specific metric with target: 'FCF conversion >70% validates earnings quality'>",
      "<Specific metric with target: 'D/E ratio <1.0x maintains financial flexibility'>"
    ]
  }
}

ADDITIONAL RULES:
- Scores: 0-30 poor, 31-50 below avg, 51-70 average, 71-85 good, 86-100 excellent.
- Section scores should anchor to quant component scores ± 10 points.
- key_investment_risks score is INVERTED (low score = high risk).
- All monetary values in INR Crores.
- peer_comparison must use actual peer data provided—NO HALLUCINATIONS. If metric unavailable, use "N/A".
- Recommendation: 75+ BUY, 60-74 HOLD, <60 AVOID. Qualify with specific conditions.
- Respond with ONLY the JSON object. No markdown, no explanation.`;
}

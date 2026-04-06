import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const dynamic = "force-dynamic";

const yahooFinance = new YahooFinance();

interface RouteContext {
  params: Promise<{ symbol: string }>;
}

/**
 * GET /api/stock/[symbol]
 *
 * Fetches live fundamentals for a single NSE stock from Yahoo Finance.
 * Returns a normalised object matching the FundamentalsGrid shape.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  const { symbol } = await context.params;
  const upper = symbol.toUpperCase();
  const yahooSymbol = `${upper}.NS`;

  try {
    const result = await yahooFinance.quoteSummary(yahooSymbol, {
      modules: [
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "price",
      ],
    });

    const sd = result.summaryDetail;
    const ks = result.defaultKeyStatistics;
    const fd = result.financialData;
    const pr = result.price;

    const safe = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const toPct = (v: unknown): number | null => {
      const n = safe(v);
      return n != null ? Math.round(n * 100 * 100) / 100 : null;
    };

    const toCr = (v: unknown): number | null => {
      const n = safe(v);
      return n != null ? Math.round((n / 1_00_00_000) * 100) / 100 : null;
    };

    const pe = safe(sd?.trailingPE ?? ks?.trailingPE);
    const pb = safe(sd?.priceToBook ?? ks?.priceToBook);
    const roe = toPct(fd?.returnOnEquity);
    const roce = toPct(fd?.returnOnAssets); // closest proxy
    const debtToEquity = safe(fd?.debtToEquity);
    const dividendYield = toPct(sd?.dividendYield);
    const eps = safe(ks?.trailingEps ?? sd?.trailingEps);
    const bookValue = safe(ks?.bookValue);
    const revenueCr = toCr(fd?.totalRevenue);
    const netProfitCr = toCr(fd?.netIncomeToCommon ?? ks?.netIncomeToCommon);
    const netMargin = toPct(fd?.profitMargins);
    const operatingMargin = toPct(fd?.operatingMargins);

    let grahamNumber: number | null = null;
    if (eps != null && bookValue != null && eps > 0 && bookValue > 0) {
      grahamNumber =
        Math.round(Math.sqrt(22.5 * eps * bookValue) * 100) / 100;
    }

    const marketCapCr = toCr(pr?.marketCap);

    return NextResponse.json({
      symbol: upper,
      name: pr?.shortName ?? pr?.longName ?? upper,
      sector: null, // quoteSummary doesn't include sector in these modules
      market_cap_cr: marketCapCr,
      current_price: safe(pr?.regularMarketPrice),
      fundamentals: {
        pe,
        pb,
        roe,
        roce,
        debt_to_equity: debtToEquity,
        dividend_yield: dividendYield,
        eps,
        book_value: bookValue,
        revenue_cr: revenueCr,
        net_profit_cr: netProfitCr,
        net_margin: netMargin,
        operating_margin: operatingMargin,
        graham_number: grahamNumber,
      },
    });
  } catch (err) {
    console.error(`yahoo-finance2 quoteSummary failed for ${yahooSymbol}:`, err);
    return NextResponse.json(
      { error: `Failed to fetch data for ${upper}` },
      { status: 502 }
    );
  }
}

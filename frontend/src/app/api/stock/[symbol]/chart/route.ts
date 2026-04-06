import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

export const dynamic = "force-dynamic";

const yahooFinance = new YahooFinance();

interface RouteContext {
  params: Promise<{ symbol: string }>;
}

// Map our UI range labels to Yahoo Finance period + interval
const RANGE_CONFIG: Record<
  string,
  { period1: string; interval: "1d" | "1wk" | "1mo" | "5m" | "15m" | "1h" }
> = {
  "1D": { period1: "1d", interval: "5m" },
  "1W": { period1: "5d", interval: "15m" },
  "1M": { period1: "1mo", interval: "1d" },
  "3M": { period1: "3mo", interval: "1d" },
  "6M": { period1: "6mo", interval: "1d" },
  "1Y": { period1: "1y", interval: "1d" },
  "3Y": { period1: "3y", interval: "1wk" },
  "5Y": { period1: "5y", interval: "1wk" },
  MAX: { period1: "max", interval: "1mo" },
};

/**
 * GET /api/stock/[symbol]/chart?range=1Y
 *
 * Fetches historical price data from Yahoo Finance for charting.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const { symbol } = await context.params;
  const upper = symbol.toUpperCase();
  const yahooSymbol = `${upper}.NS`;

  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1Y";
  const config = RANGE_CONFIG[rangeParam] ?? RANGE_CONFIG["1Y"];

  // Compute period1 as a Date from the shorthand
  const period1 = rangeToPeriod1(config.period1);

  try {
    const result = await yahooFinance.chart(yahooSymbol, {
      period1,
      interval: config.interval,
    });

    const quotes = result.quotes ?? [];

    const prices = quotes
      .filter((q) => q.close != null)
      .map((q) => ({
        date: q.date instanceof Date ? q.date.toISOString() : String(q.date),
        open: q.open ?? null,
        high: q.high ?? null,
        low: q.low ?? null,
        close: q.close!,
        volume: q.volume ?? null,
      }));

    return NextResponse.json({ symbol: upper, range: rangeParam, prices });
  } catch (err) {
    console.error(`yahoo-finance2 chart failed for ${yahooSymbol}:`, err);
    return NextResponse.json(
      { error: `Failed to fetch chart data for ${upper}` },
      { status: 502 }
    );
  }
}

function rangeToPeriod1(shorthand: string): Date {
  const now = new Date();
  switch (shorthand) {
    case "1d":
      return new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    case "5d":
      return new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    case "1mo":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3mo":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "6mo":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "3y":
      return new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    case "5y":
      return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    case "max":
      return new Date("1980-01-01");
    default:
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  }
}

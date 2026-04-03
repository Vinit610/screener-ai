"use client";

import StockCard from "@/components/screener/StockCard";
import FundamentalsGrid from "@/components/stock/FundamentalsGrid";
import PriceChart from "@/components/stock/PriceChart";
import NewsFeed from "@/components/stock/NewsFeed";

interface StockDetailClientProps {
  data: {
    id: string;
    symbol: string;
    name: string;
    sector: string | null;
    market_cap_cr: number | null;
    fundamentals?: {
      pe?: number | null;
      pb?: number | null;
      roe?: number | null;
      roce?: number | null;
      debt_to_equity?: number | null;
      net_margin?: number | null;
      revenue_cr?: number | null;
      net_profit_cr?: number | null;
      eps?: number | null;
      book_value?: number | null;
      graham_number?: number | null;
      dividend_yield?: number | null;
    } | null;
    latest_price?: {
      date: string;
      close: number;
      open?: number | null;
      high?: number | null;
      low?: number | null;
      volume?: number | null;
    } | null;
    price_history?: {
      date: string;
      close: number;
      open?: number | null;
      high?: number | null;
      low?: number | null;
      volume?: number | null;
    }[];
  };
  symbol: string;
}

function getMarketCapCategory(mcap: number | null | undefined): string | undefined {
  if (mcap == null) return undefined;
  if (mcap >= 20_000) return "large";
  if (mcap >= 5_000) return "mid";
  if (mcap >= 500) return "small";
  return "micro";
}

export default function StockDetailClient({
  data,
  symbol,
}: StockDetailClientProps) {
  const screenerUrl = new URL("/screener", window.location.origin);
  if (data.sector) {
    screenerUrl.searchParams.set("sector", data.sector);
  }
  const mcapCategory = getMarketCapCategory(data.market_cap_cr);
  if (mcapCategory) {
    screenerUrl.searchParams.set("market_cap_category", mcapCategory);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      {/* StockCard detail variant — triggers AI stream */}
      <StockCard
        stock={{
          id: data.id,
          symbol: data.symbol,
          name: data.name,
          sector: data.sector,
          market_cap_cr: data.market_cap_cr,
          fundamentals: data.fundamentals
            ? {
                pe: data.fundamentals.pe ?? null,
                pb: data.fundamentals.pb ?? null,
                roe: data.fundamentals.roe ?? null,
                roce: data.fundamentals.roce ?? null,
                debt_to_equity: data.fundamentals.debt_to_equity ?? null,
                net_margin: data.fundamentals.net_margin ?? null,
                dividend_yield: data.fundamentals.dividend_yield ?? null,
                eps: data.fundamentals.eps ?? null,
                revenue_cr: data.fundamentals.revenue_cr ?? null,
                net_profit_cr: data.fundamentals.net_profit_cr ?? null,
                book_value: data.fundamentals.book_value ?? null,
                graham_number: data.fundamentals.graham_number ?? null,
              }
            : null,
        }}
        variant="detail"
      />

      {/* Open in Screener */}
      <div className="flex gap-3">
        <a
          href={screenerUrl.toString()}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-xs text-muted transition hover:border-primary hover:text-white"
        >
          Open in Screener →
        </a>
      </div>

      {/* Price chart */}
      <PriceChart
        prices={data.price_history ?? []}
        symbol={symbol}
      />

      {/* Fundamentals grid */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Fundamentals</h2>
        <FundamentalsGrid fundamentals={data.fundamentals ?? null} />
      </div>

      {/* News feed */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Recent News</h2>
        <NewsFeed symbol={symbol} />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import StockCard from "@/components/screener/StockCard";
import FundamentalsGrid, { type FullFundamentals } from "@/components/stock/FundamentalsGrid";
import PriceChart from "@/components/stock/PriceChart";
import NewsFeed from "@/components/stock/NewsFeed";
import AIAnalysisPanel from "@/components/stock/AIAnalysisPanel";
import TradeButton from "@/components/portfolio/TradeButton";
import { useUserStore } from "@/store/userStore";
import { getBackendUrl } from "@/lib/api";

interface StockDetailClientProps {
  data: {
    id: string;
    symbol: string;
    name: string;
    sector: string | null;
    industry: string | null;
    market_cap_cr: number | null;
    fundamentals?: FullFundamentals | null;
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

export default function StockDetailClient({ data, symbol }: StockDetailClientProps) {
  const { user, accessToken } = useUserStore();
  const [cashBalance, setCashBalance] = useState(1000000);
  const [heldQuantity, setHeldQuantity] = useState(0);
  // Only fetch live price — all fundamentals come from the DB via the server component
  const [livePrice, setLivePrice] = useState<number | null>(null);

  useEffect(() => {
    async function fetchLivePrice() {
      try {
        const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.current_price != null) setLivePrice(json.current_price);
      } catch {
        // silently fall back to latest_price from DB
      }
    }
    fetchLivePrice();
  }, [symbol]);

  const fetchPaperInfo = useCallback(async () => {
    if (!accessToken) return;
    try {
      const resp = await fetch(`${getBackendUrl()}/api/portfolio/paper`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) return;
      const json = await resp.json();
      setCashBalance(json.cash_balance);
      const holding = (json.holdings || []).find(
        (h: { symbol: string }) => h.symbol === symbol.toUpperCase()
      );
      setHeldQuantity(holding ? holding.quantity : 0);
    } catch {
      // silently fail
    }
  }, [accessToken, symbol]);

  useEffect(() => {
    if (accessToken) fetchPaperInfo();
  }, [accessToken, fetchPaperInfo]);

  const currentPrice = livePrice ?? data.latest_price?.close ?? null;
  const fundamentals = data.fundamentals ?? null;

  // Build screener URL (path-only so it works SSR and client)
  const params = new URLSearchParams();
  if (data.sector) params.set("sector", data.sector);
  const mcapCategory = getMarketCapCategory(data.market_cap_cr);
  if (mcapCategory) params.set("market_cap_category", mcapCategory);
  const screenerPath = `/screener${params.size > 0 ? `?${params.toString()}` : ""}`;

  // Data freshness badge
  const updatedAt = fundamentals?.fundamentals_updated_at;
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header card */}
      <StockCard
        stock={{
          id: data.id,
          symbol: data.symbol,
          name: data.name,
          sector: data.sector,
          market_cap_cr: data.market_cap_cr,
          fundamentals: fundamentals
            ? {
                pe: fundamentals.pe ?? null,
                pb: fundamentals.pb ?? null,
                roe: fundamentals.roe ?? null,
                roce: fundamentals.roce ?? null,
                debt_to_equity: fundamentals.debt_to_equity ?? null,
                net_margin: fundamentals.net_margin ?? null,
                dividend_yield: fundamentals.dividend_yield ?? null,
                eps: fundamentals.eps ?? null,
                revenue_cr: fundamentals.revenue_cr ?? null,
                net_profit_cr: fundamentals.net_profit_cr ?? null,
                book_value: fundamentals.book_value ?? null,
                graham_number: fundamentals.graham_number ?? null,
              }
            : null,
        }}
        variant="detail"
        showAI={false}
      />

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={screenerPath}
            className="rounded-lg border border-border bg-surface px-4 py-2 text-xs text-muted transition hover:border-primary hover:text-white"
          >
            Open in Screener →
          </a>
          {user && accessToken && (
            <TradeButton
              symbol={symbol.toUpperCase()}
              currentPrice={currentPrice}
              cashBalance={cashBalance}
              heldQuantity={heldQuantity}
              backendUrl={getBackendUrl()}
              token={accessToken}
              onTradeComplete={fetchPaperInfo}
            />
          )}
        </div>
        {updatedLabel && (
          <span className="text-[10px] text-muted/60">
            Fundamentals updated {updatedLabel}
          </span>
        )}
      </div>

      {/* Price chart */}
      <PriceChart prices={data.price_history ?? []} symbol={symbol} />

      {/* AI Analysis — compact by default */}
      <AIAnalysisPanel symbol={symbol} />

      {/* Fundamentals — all sections */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Fundamentals</h2>
        <FundamentalsGrid fundamentals={fundamentals} />
      </div>

      {/* News */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Recent News</h2>
        <NewsFeed symbol={symbol} />
      </div>
    </div>
  );
}

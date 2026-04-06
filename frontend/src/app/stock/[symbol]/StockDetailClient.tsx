"use client";

import { useEffect, useState, useCallback } from "react";
import StockCard from "@/components/screener/StockCard";
import FundamentalsGrid from "@/components/stock/FundamentalsGrid";
import PriceChart from "@/components/stock/PriceChart";
import NewsFeed from "@/components/stock/NewsFeed";
import TradeButton from "@/components/portfolio/TradeButton";
import { useUserStore } from "@/store/userStore";
import { getBackendUrl } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";

interface FundamentalsData {
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
}

interface StockDetailClientProps {
  data: {
    id: string;
    symbol: string;
    name: string;
    sector: string | null;
    market_cap_cr: number | null;
    fundamentals?: FundamentalsData | null;
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
  const { user, accessToken } = useUserStore();
  const [cashBalance, setCashBalance] = useState(1000000);
  const [heldQuantity, setHeldQuantity] = useState(0);

  // Live fundamentals from Yahoo Finance
  const [liveFundamentals, setLiveFundamentals] = useState<FundamentalsData | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveMarketCap, setLiveMarketCap] = useState<number | null>(null);
  const [fundLoading, setFundLoading] = useState(true);

  useEffect(() => {
    async function fetchLive() {
      try {
        const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setLiveFundamentals(json.fundamentals ?? null);
        setLivePrice(json.current_price ?? null);
        setLiveMarketCap(json.market_cap_cr ?? null);
      } catch {
        // Fall back to DB data — liveFundamentals stays null
      } finally {
        setFundLoading(false);
      }
    }
    fetchLive();
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

  // Use live data when available, fall back to DB data
  const fundamentals = liveFundamentals ?? data.fundamentals ?? null;
  const currentPrice = livePrice ?? data.latest_price?.close ?? null;
  const marketCap = liveMarketCap ?? data.market_cap_cr;

  const screenerUrl = new URL("/screener", window.location.origin);
  if (data.sector) {
    screenerUrl.searchParams.set("sector", data.sector);
  }
  const mcapCategory = getMarketCapCategory(marketCap);
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
          market_cap_cr: marketCap,
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
      />

      {/* Open in Screener + Paper Trade */}
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={screenerUrl.toString()}
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

      {/* Price chart — live from Yahoo Finance */}
      <PriceChart
        prices={data.price_history ?? []}
        symbol={symbol}
      />

      {/* Fundamentals grid — live from Yahoo Finance */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Fundamentals</h2>
          {liveFundamentals && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
              Live
            </span>
          )}
        </div>
        {fundLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <FundamentalsGrid fundamentals={fundamentals} />
        )}
      </div>

      {/* News feed */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-white">Recent News</h2>
        <NewsFeed symbol={symbol} />
      </div>
    </div>
  );
}

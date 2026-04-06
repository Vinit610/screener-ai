"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/Skeleton";

interface PricePoint {
  date: string;
  close: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}

interface PriceChartProps {
  /** Pre-loaded prices from DB (SSR fallback). Ignored once live data loads. */
  prices?: PricePoint[];
  symbol: string;
}

type TimeRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "MAX";

const RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y", "MAX"];

function formatDate(dateStr: string, range: TimeRange): string {
  const d = new Date(dateStr);
  if (range === "1D" || range === "1W") {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatPrice(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Calculate optimal minTickGap based on data density and range */
function getMinTickGap(dataLength: number, range: TimeRange): number {
  if (range === "1D" || range === "1W") return 20;
  if (range === "1M" || range === "3M") return 30;
  if (range === "6M" || range === "1Y") return 40;
  if (dataLength > 200) return 50;
  return 40;
}

export default function PriceChart({ prices: ssrPrices, symbol }: PriceChartProps) {
  const [range, setRange] = useState<TimeRange>("1Y");
  const [livePrices, setLivePrices] = useState<PricePoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChart = useCallback(
    async (r: TimeRange) => {
      setLoading(true);
      setError(null);
      setLivePrices(null); // Clear immediately to prevent stale data display
      try {
        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/chart?range=${r}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        // Only update if still the current range (prevents race conditions)
        if (json.prices && Array.isArray(json.prices) && json.prices.length > 0) {
          setLivePrices(json.prices);
        } else {
          setError("No data available for this time period");
        }
      } catch (err) {
        setError("Failed to fetch chart data. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [symbol]
  );

  useEffect(() => {
    fetchChart(range);
  }, [range, fetchChart]);

  // Use fetched live data if available; SSR fallback only for initial 1Y view
  const displayPrices = livePrices ?? (range === "1Y" ? ssrPrices : []) ?? [];

  const startPrice = displayPrices.length > 0 ? displayPrices[0].close : 0;
  const endPrice =
    displayPrices.length > 0
      ? displayPrices[displayPrices.length - 1].close
      : 0;
  const isPositive = endPrice >= startPrice;
  const gradientId = `priceGradient-${range}-${isPositive ? "up" : "down"}`;

  if (!loading && displayPrices.length === 0 && !error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No price data available for {symbol}.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* Header with range selector */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Price Chart</h3>
          {!loading && displayPrices.length > 0 && (
            <p className="mt-0.5 text-xs text-muted">
              {formatPrice(endPrice)}
              <span
                className={`ml-2 ${
                  isPositive ? "text-accent" : "text-danger"
                }`}
              >
                {isPositive ? "+" : ""}
                {startPrice > 0
                  ? (((endPrice - startPrice) / startPrice) * 100).toFixed(2)
                  : "0.00"}
                %
              </span>
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded px-2 py-1 text-xs transition ${
                range === r
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-surface-hover hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <Skeleton className="h-[280px] w-full rounded-lg" />
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex h-[280px] items-center justify-center text-xs text-danger">
          {error}
        </div>
      )}

      {/* Chart */}
      {!loading && !error && displayPrices.length > 0 && (
        <ResponsiveContainer key={range} width="100%" height={280}>
          <AreaChart data={displayPrices}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={isPositive ? "#22c55e" : "#ef4444"}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={isPositive ? "#22c55e" : "#ef4444"}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDate(d, range)}
              tick={{ fill: "#888", fontSize: 10 }}
              axisLine={{ stroke: "#222" }}
              tickLine={false}
              minTickGap={getMinTickGap(displayPrices.length, range)}
            />
            <YAxis
              tickFormatter={(v) => `₹${v}`}
              tick={{ fill: "#888", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={60}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#111",
                border: "1px solid #222",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelFormatter={(label) => {
                const d = new Date(label);
                if (range === "1D" || range === "1W") {
                  return d.toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                }
                return d.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                });
              }}
              formatter={(value) => [formatPrice(Number(value)), "Close"]}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={isPositive ? "#22c55e" : "#ef4444"}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

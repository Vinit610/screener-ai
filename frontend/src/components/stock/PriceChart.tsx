"use client";

import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface PricePoint {
  date: string;
  close: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}

interface PriceChartProps {
  prices: PricePoint[];
  symbol: string;
}

type TimeRange = "1M" | "3M" | "6M" | "1Y" | "MAX";

const RANGE_DAYS: Record<TimeRange, number | null> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  MAX: null,
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatPrice(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function PriceChart({ prices, symbol }: PriceChartProps) {
  const [range, setRange] = useState<TimeRange>("1Y");

  const filteredPrices = useMemo(() => {
    if (!prices.length) return [];
    const days = RANGE_DAYS[range];
    if (days === null) return prices;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return prices.filter((p) => p.date >= cutoffStr);
  }, [prices, range]);

  const startPrice = filteredPrices.length > 0 ? filteredPrices[0].close : 0;
  const endPrice =
    filteredPrices.length > 0
      ? filteredPrices[filteredPrices.length - 1].close
      : 0;
  const isPositive = endPrice >= startPrice;

  if (!prices.length) {
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
          {filteredPrices.length > 0 && (
            <p className="mt-0.5 text-xs text-muted">
              {formatPrice(endPrice)}
              <span
                className={`ml-2 ${
                  isPositive ? "text-accent" : "text-danger"
                }`}
              >
                {isPositive ? "+" : ""}
                {((endPrice - startPrice) / startPrice * 100).toFixed(2)}%
              </span>
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(Object.keys(RANGE_DAYS) as TimeRange[]).map((r) => (
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

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={filteredPrices}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
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
            tickFormatter={formatDate}
            tick={{ fill: "#888", fontSize: 10 }}
            axisLine={{ stroke: "#222" }}
            tickLine={false}
            minTickGap={40}
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
            fill="url(#priceGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

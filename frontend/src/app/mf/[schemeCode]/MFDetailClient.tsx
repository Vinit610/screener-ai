"use client";

import Badge from "@/components/ui/Badge";
import Metric from "@/components/ui/Metric";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useState, useMemo } from "react";

interface NAVPoint {
  date: string;
  nav: number;
}

interface MFDetailData {
  id: string;
  scheme_code: string;
  scheme_name: string;
  fund_house: string;
  category?: string | null;
  sub_category?: string | null;
  expense_ratio?: number | null;
  aum_cr?: number | null;
  benchmark?: string | null;
  is_direct?: boolean | null;
  is_growth?: boolean | null;
  nav_history?: NAVPoint[];
  sharpe_ratio?: number | null;
}

interface MFDetailClientProps {
  data: MFDetailData;
}

type TimeRange = "1M" | "3M" | "6M" | "1Y" | "2Y" | "3Y" | "MAX";

const RANGE_DAYS: Record<TimeRange, number | null> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "2Y": 730,
  "3Y": 1095,
  MAX: null,
};

function fmt(v: number | null | undefined): string {
  if (v == null) return "–";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtCr(v: number | null | undefined): string {
  if (v == null) return "–";
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L Cr`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(1)}K Cr`;
  return `₹${v.toFixed(0)} Cr`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatNav(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function MFDetailClient({ data }: MFDetailClientProps) {
  const [range, setRange] = useState<TimeRange>("1Y");
  const navs = data.nav_history ?? [];

  const filteredNavs = useMemo(() => {
    if (!navs.length) return [];
    const days = RANGE_DAYS[range];
    if (days === null) return navs;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return navs.filter((n) => n.date >= cutoffStr);
  }, [navs, range]);

  const startNav = filteredNavs.length > 0 ? filteredNavs[0].nav : 0;
  const endNav =
    filteredNavs.length > 0 ? filteredNavs[filteredNavs.length - 1].nav : 0;
  const isPositive = endNav >= startNav;
  const gradientId = `navGradient-${range}-${isPositive ? "up" : "down"}`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white">{data.scheme_name}</h1>
        <p className="mt-1 text-xs text-muted">{data.fund_house}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {data.category && <Badge label={data.category} variant="sector" />}
          {data.sub_category && (
            <Badge label={data.sub_category} variant="neutral" />
          )}
          {data.is_direct && <Badge label="Direct" variant="positive" />}
          {data.is_growth && <Badge label="Growth" variant="positive" />}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-3">
          <Metric
            label="Expense Ratio"
            value={
              data.expense_ratio != null ? `${fmt(data.expense_ratio)}%` : "–"
            }
            color={
              data.expense_ratio != null
                ? data.expense_ratio <= 0.5
                  ? "green"
                  : data.expense_ratio > 2
                  ? "red"
                  : "default"
                : "default"
            }
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <Metric label="AUM" value={fmtCr(data.aum_cr)} />
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <Metric
            label="Sharpe Ratio"
            value={data.sharpe_ratio != null ? fmt(data.sharpe_ratio) : "–"}
            color={
              data.sharpe_ratio != null
                ? data.sharpe_ratio >= 1
                  ? "green"
                  : data.sharpe_ratio < 0
                  ? "red"
                  : "default"
                : "default"
            }
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <Metric
            label="Benchmark"
            value={data.benchmark ?? "–"}
          />
        </div>
      </div>

      {/* NAV Chart */}
      {navs.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">NAV History</h3>
              {filteredNavs.length > 0 && (
                <p className="mt-0.5 text-xs text-muted">
                  {formatNav(endNav)}
                  <span
                    className={`ml-2 ${
                      isPositive ? "text-accent" : "text-danger"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {startNav > 0
                      ? (((endNav - startNav) / startNav) * 100).toFixed(2)
                      : "0.00"}
                    %
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

          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={filteredNavs}>
              <defs>
                <linearGradient
                  id={gradientId}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
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
                formatter={(value) => [formatNav(Number(value)), "NAV"]}
              />
              <Area
                type="monotone"
                dataKey="nav"
                stroke={isPositive ? "#22c55e" : "#ef4444"}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
          No NAV history available for this fund.
        </div>
      )}

      {/* Back link */}
      <a
        href="/mf"
        className="inline-block text-xs text-primary hover:underline"
      >
        ← Back to MF Screener
      </a>

      <p className="text-[10px] text-muted/60">
        Educational insight only — not investment advice.
      </p>
    </div>
  );
}

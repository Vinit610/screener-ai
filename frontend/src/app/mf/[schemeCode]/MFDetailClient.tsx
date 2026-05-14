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

interface MFMetrics {
  return_1y?: number | null;
  return_3y?: number | null;
  return_5y?: number | null;
  rank_1y?: number | null;
  peers_1y?: number | null;
  rank_3y?: number | null;
  peers_3y?: number | null;
  rank_5y?: number | null;
  peers_5y?: number | null;
  sharpe_3y?: number | null;
  sortino_3y?: number | null;
  max_drawdown?: number | null;
  max_drawdown_peak_date?: string | null;
  max_drawdown_trough_date?: string | null;
  max_drawdown_recovery_date?: string | null;
  nav_history_start?: string | null;
  latest_nav_date?: string | null;
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
  metrics?: MFMetrics | null;
}

interface MFDetailClientProps {
  data: MFDetailData;
}

type TimeRange = "1M" | "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "MAX";

const RANGE_DAYS: Record<TimeRange, number | null> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "2Y": 730,
  "3Y": 1095,
  "5Y": 1825,
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

function formatDate(dateStr: string, withYear: boolean): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: withYear ? undefined : "numeric",
    month: "short",
    year: withYear ? "2-digit" : undefined,
  });
}

function formatNav(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function ratioColor(
  v: number | null | undefined,
): "default" | "green" | "red" {
  if (v == null) return "default";
  if (v >= 1) return "green";
  if (v < 0) return "red";
  return "default";
}

function fmtMonthYear(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function monthsBetween(a: string, b: string): number {
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.max(
    0,
    Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
  );
}

// "Sectoral/Thematic" funds track unrelated themes, so peer ranking by
// return is misleading — suppress the rank section for them.
function isSectoralThematic(subCategory: string | null | undefined): boolean {
  return /sector|thematic/i.test(subCategory ?? "");
}

export default function MFDetailClient({ data }: MFDetailClientProps) {
  const [range, setRange] = useState<TimeRange>("1Y");
  const navs = data.nav_history ?? [];
  const m = data.metrics;

  // Sharpe/Sortino need a full 3Y window. When they're null but the fund has
  // NAV history starting less than ~3y ago, it's because the fund is young.
  const launchedRecently =
    m?.nav_history_start != null &&
    new Date(m.nav_history_start).getTime() >
      Date.now() - 3 * 365 * 24 * 60 * 60 * 1000;
  const ratiosUnavailable = m != null && m.sharpe_3y == null && launchedRecently;

  const showRank = m != null && !isSectoralThematic(data.sub_category);
  const rankRows: { period: string; rank: number; peers: number }[] = [];
  if (showRank && m) {
    if (m.rank_1y != null && m.peers_1y != null)
      rankRows.push({ period: "1Y", rank: m.rank_1y, peers: m.peers_1y });
    if (m.rank_3y != null && m.peers_3y != null)
      rankRows.push({ period: "3Y", rank: m.rank_3y, peers: m.peers_3y });
    if (m.rank_5y != null && m.peers_5y != null)
      rankRows.push({ period: "5Y", rank: m.rank_5y, peers: m.peers_5y });
  }

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
  const axisWithYear = range !== "1M" && range !== "3M";

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
            label="Sharpe (3Y)"
            value={m?.sharpe_3y != null ? fmt(m.sharpe_3y) : "–"}
            color={ratioColor(m?.sharpe_3y)}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <Metric
            label="Sortino (3Y)"
            value={m?.sortino_3y != null ? fmt(m.sortino_3y) : "–"}
            color={ratioColor(m?.sortino_3y)}
          />
        </div>
      </div>

      {/* Benchmark + Max drawdown */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-3">
          <Metric label="Benchmark" value={data.benchmark ?? "–"} />
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <span className="text-xs text-muted">Max Drawdown</span>
          <div className="mt-0.5 text-sm font-semibold text-danger">
            {m?.max_drawdown != null ? `${fmt(m.max_drawdown)}%` : "–"}
          </div>
          {m?.max_drawdown != null &&
            m.max_drawdown < 0 &&
            m.max_drawdown_peak_date &&
            m.max_drawdown_trough_date && (
              <p className="mt-1 text-[11px] text-muted">
                {fmtMonthYear(m.max_drawdown_peak_date)} →{" "}
                {fmtMonthYear(m.max_drawdown_trough_date)} ·{" "}
                {m.max_drawdown_recovery_date
                  ? `recovered in ${monthsBetween(
                      m.max_drawdown_trough_date,
                      m.max_drawdown_recovery_date,
                    )} mo`
                  : "not yet recovered"}
              </p>
            )}
        </div>
      </div>

      {ratiosUnavailable && (
        <p className="text-xs text-muted">
          Sharpe and Sortino need 3 years of history — this fund launched in{" "}
          {fmtMonthYear(m?.nav_history_start)}, so they aren&apos;t shown yet.
        </p>
      )}

      {/* Category rank */}
      {showRank && rankRows.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <h2 className="text-sm font-semibold text-white">
            Category Rank
            {data.sub_category ? ` · ${data.sub_category}` : ""}
          </h2>
          <div className="mt-2 flex flex-wrap gap-4">
            {rankRows.map((r) => (
              <div key={r.period} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{r.period} return</span>
                <span className="text-sm font-semibold text-foreground">
                  {r.rank}{" "}
                  <span className="text-muted">/ {r.peers}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Ranked purely by trailing return against other Direct-Growth funds
            in the same category. Risk (Sharpe, drawdown) is shown separately —
            it isn&apos;t blended into the rank.
          </p>
        </div>
      )}
      {m != null && isSectoralThematic(data.sub_category) && (
        <p className="text-xs text-muted">
          Category rank isn&apos;t shown for sectoral / thematic funds — they
          track different themes and aren&apos;t directly comparable by return.
        </p>
      )}

      {/* About Sharpe & Sortino */}
      {m != null && (m.sharpe_3y != null || m.sortino_3y != null) && (
        <details className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
          <summary className="cursor-pointer font-medium text-white">
            How to read Sharpe &amp; Sortino
          </summary>
          <div className="mt-3 space-y-2">
            <p>
              Both measure{" "}
              <span className="text-white">risk-adjusted return</span> — how
              much extra return the fund delivered for each unit of risk —
              computed over a fixed{" "}
              <span className="text-white">trailing 3-year window</span> so
              funds are comparable.
            </p>
            <p>
              <span className="text-white">Sharpe</span> ={" "}
              <span className="font-mono">
                (3Y return − 6.5% risk-free) ÷ total volatility
              </span>
              . <span className="text-white">Sortino</span> uses only{" "}
              <span className="text-white">downside</span> volatility, so it
              doesn&apos;t penalise a fund for big up-days.
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <span className="text-accent">Above 1</span> — rewarded its
                risk well.
              </li>
              <li>
                <span className="text-accent">Above 2</span> — exceptional
                risk-adjusted performance.
              </li>
              <li>
                <span className="text-muted">Around 0</span> — barely beat the
                risk-free rate.
              </li>
              <li>
                <span className="text-danger">Negative</span> — you would have
                done better in a fixed deposit.
              </li>
            </ul>
            <p>
              If Sortino is much higher than Sharpe, the fund&apos;s volatility
              is mostly to the upside — choppy in your favour.
            </p>
            <p className="text-muted/60">
              Based on past performance. Not predictive of future returns.
            </p>
          </div>
        </details>
      )}

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
                tickFormatter={(d) => formatDate(d, axisWithYear)}
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

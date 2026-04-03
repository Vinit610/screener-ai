"use client";

import { clsx } from "clsx";
import { useState } from "react";

interface MetricCellProps {
  label: string;
  value: string | number | null | undefined;
  tooltip: string;
  color?: "default" | "green" | "red";
}

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

function MetricCell({ label, value, tooltip, color = "default" }: MetricCellProps) {
  const [showTip, setShowTip] = useState(false);

  const display = typeof value === "number" ? fmt(value) : value ?? "–";

  return (
    <div className="relative flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted">{label}</span>
        <button
          type="button"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          onClick={() => setShowTip((p) => !p)}
          className="text-muted/50 hover:text-muted"
          aria-label={`Info about ${label}`}
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {showTip && (
          <div className="absolute left-0 top-full z-10 mt-1 w-52 rounded-lg border border-border bg-surface p-2 text-[11px] text-muted shadow-lg">
            {tooltip}
          </div>
        )}
      </div>
      <span
        className={clsx(
          "text-sm font-semibold",
          color === "green" && "text-accent",
          color === "red" && "text-danger",
          color === "default" && "text-foreground"
        )}
      >
        {display}
      </span>
    </div>
  );
}

interface FundamentalsGridProps {
  fundamentals: {
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
}

export default function FundamentalsGrid({ fundamentals }: FundamentalsGridProps) {
  if (!fundamentals) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No fundamental data available for this stock.
      </div>
    );
  }

  const f = fundamentals;

  const metrics: MetricCellProps[] = [
    {
      label: "PE Ratio",
      value: f.pe,
      tooltip: "Price-to-Earnings ratio. Lower PE may indicate undervaluation. Compare within the same sector.",
      color: f.pe != null ? (f.pe < 15 ? "green" : f.pe > 40 ? "red" : "default") : "default",
    },
    {
      label: "PB Ratio",
      value: f.pb,
      tooltip: "Price-to-Book ratio. Below 1 may mean stock trades below book value. Useful for banking and asset-heavy sectors.",
      color: f.pb != null ? (f.pb < 1 ? "green" : f.pb > 5 ? "red" : "default") : "default",
    },
    {
      label: "ROE",
      value: f.roe != null ? `${fmt(f.roe)}%` : null,
      tooltip: "Return on Equity — how efficiently the company uses shareholder capital. Above 15% is generally good.",
      color: f.roe != null ? (f.roe >= 15 ? "green" : f.roe < 0 ? "red" : "default") : "default",
    },
    {
      label: "ROCE",
      value: f.roce != null ? `${fmt(f.roce)}%` : null,
      tooltip: "Return on Capital Employed — overall profitability relative to total capital. Higher is better.",
      color: f.roce != null ? (f.roce >= 15 ? "green" : f.roce < 0 ? "red" : "default") : "default",
    },
    {
      label: "D/E Ratio",
      value: f.debt_to_equity,
      tooltip: "Debt-to-Equity ratio. Lower means less leverage. Below 0.5 is generally healthy for non-financial companies.",
      color: f.debt_to_equity != null
        ? f.debt_to_equity <= 0.5
          ? "green"
          : f.debt_to_equity > 2
          ? "red"
          : "default"
        : "default",
    },
    {
      label: "Net Margin",
      value: f.net_margin != null ? `${fmt(f.net_margin)}%` : null,
      tooltip: "Net profit as a percentage of revenue. Higher margins indicate better pricing power and efficiency.",
      color: f.net_margin != null ? (f.net_margin >= 15 ? "green" : f.net_margin < 0 ? "red" : "default") : "default",
    },
    {
      label: "Revenue",
      value: f.revenue_cr != null ? fmtCr(f.revenue_cr) : null,
      tooltip: "Total revenue (turnover) in crores. Look for consistent growth over time.",
    },
    {
      label: "Net Profit",
      value: f.net_profit_cr != null ? fmtCr(f.net_profit_cr) : null,
      tooltip: "Bottom-line profit after all expenses, taxes, and interest. Positive and growing is ideal.",
      color: f.net_profit_cr != null ? (f.net_profit_cr > 0 ? "green" : "red") : "default",
    },
    {
      label: "EPS",
      value: f.eps != null ? `₹${fmt(f.eps)}` : null,
      tooltip: "Earnings Per Share — net profit divided by outstanding shares. Higher is better.",
    },
    {
      label: "Book Value",
      value: f.book_value != null ? `₹${fmt(f.book_value)}` : null,
      tooltip: "Net asset value per share. If stock price is below book value, it may be undervalued.",
    },
    {
      label: "Graham Number",
      value: f.graham_number != null ? `₹${fmt(f.graham_number)}` : null,
      tooltip: "Fair value estimate using Benjamin Graham's formula: √(22.5 × EPS × Book Value). Price below this may indicate a value opportunity.",
    },
    {
      label: "Dividend Yield",
      value: f.dividend_yield != null ? `${fmt(f.dividend_yield)}%` : null,
      tooltip: "Annual dividend as a percentage of stock price. Above 2% is considered decent for Indian markets.",
      color: f.dividend_yield != null ? (f.dividend_yield >= 2 ? "green" : "default") : "default",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {metrics.map((m) => (
        <MetricCell key={m.label} {...m} />
      ))}
    </div>
  );
}

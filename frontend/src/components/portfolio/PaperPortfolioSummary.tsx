"use client";

import { clsx } from "clsx";

interface PaperPortfolioSummaryProps {
  cashBalance: number;
  totalHoldingsValue: number;
  totalPortfolioValue: number;
  pnlVsBaseline: number;
  pnlPct: number;
}

function fmtCurrency(v: number): string {
  return v.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export default function PaperPortfolioSummary({
  cashBalance,
  totalHoldingsValue,
  totalPortfolioValue,
  pnlVsBaseline,
  pnlPct,
}: PaperPortfolioSummaryProps) {
  const isPositive = pnlVsBaseline >= 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted">
          Paper Portfolio
        </h2>
        <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
          VIRTUAL
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div>
          <p className="text-xs text-muted">Total Value</p>
          <p className="text-lg font-bold">{fmtCurrency(totalPortfolioValue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Cash Balance</p>
          <p className="text-lg font-bold">{fmtCurrency(cashBalance)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Holdings Value</p>
          <p className="text-lg font-bold">{fmtCurrency(totalHoldingsValue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">P&L vs ₹10L</p>
          <p
            className={clsx(
              "text-lg font-bold",
              isPositive ? "text-green-400" : "text-red-400"
            )}
          >
            {isPositive ? "+" : ""}
            {fmtCurrency(pnlVsBaseline)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Returns</p>
          <p
            className={clsx(
              "text-lg font-bold",
              isPositive ? "text-green-400" : "text-red-400"
            )}
          >
            {fmtPct(pnlPct)}
          </p>
        </div>
      </div>
    </div>
  );
}

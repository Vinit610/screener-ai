"use client";

import { clsx } from "clsx";

interface PnLSummaryProps {
  totalInvested: number;
  totalCurrentValue: number;
  totalPnl: number;
  totalPnlPct: number;
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

export default function PnLSummary({
  totalInvested,
  totalCurrentValue,
  totalPnl,
  totalPnlPct,
}: PnLSummaryProps) {
  const isPositive = totalPnl >= 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-muted">Portfolio Summary</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted">Current Value</p>
          <p className="text-lg font-bold">{fmtCurrency(totalCurrentValue)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Total Invested</p>
          <p className="text-lg font-bold">{fmtCurrency(totalInvested)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Unrealised P&L</p>
          <p
            className={clsx(
              "text-lg font-bold",
              isPositive ? "text-green-400" : "text-red-400"
            )}
          >
            {isPositive ? "+" : ""}
            {fmtCurrency(totalPnl)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">P&L %</p>
          <p
            className={clsx(
              "text-lg font-bold",
              isPositive ? "text-green-400" : "text-red-400"
            )}
          >
            {fmtPct(totalPnlPct)}
          </p>
        </div>
      </div>
    </div>
  );
}

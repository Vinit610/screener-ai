"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { PortfolioHolding } from "@/types";

type SortField =
  | "symbol"
  | "quantity"
  | "avg_buy_price"
  | "current_price"
  | "current_value"
  | "pnl"
  | "pnl_pct";

interface HoldingsTableProps {
  holdings: PortfolioHolding[];
}

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return "–";
  return v.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "–";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function computePnl(h: PortfolioHolding) {
  const invested = h.quantity * h.avg_buy_price;
  const cv = h.current_value ?? invested;
  const pnl = cv - invested;
  const pnl_pct = invested > 0 ? (pnl / invested) * 100 : 0;
  const current_price = h.quantity > 0 ? cv / h.quantity : 0;
  return { invested, cv, pnl, pnl_pct, current_price };
}

export default function HoldingsTable({ holdings }: HoldingsTableProps) {
  const [sortField, setSortField] = useState<SortField>("symbol");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const enriched = holdings.map((h) => ({ ...h, ...computePnl(h) }));

  const sorted = [...enriched].sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    switch (sortField) {
      case "symbol":
        av = a.symbol;
        bv = b.symbol;
        break;
      case "quantity":
        av = a.quantity;
        bv = b.quantity;
        break;
      case "avg_buy_price":
        av = a.avg_buy_price;
        bv = b.avg_buy_price;
        break;
      case "current_price":
        av = a.current_price;
        bv = b.current_price;
        break;
      case "current_value":
        av = a.cv;
        bv = b.cv;
        break;
      case "pnl":
        av = a.pnl;
        bv = b.pnl;
        break;
      case "pnl_pct":
        av = a.pnl_pct;
        bv = b.pnl_pct;
        break;
    }
    if (typeof av === "string" && typeof bv === "string") {
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortDir === "asc"
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });

  const columns: { label: string; field: SortField }[] = [
    { label: "Stock", field: "symbol" },
    { label: "Qty", field: "quantity" },
    { label: "Avg Buy Price", field: "avg_buy_price" },
    { label: "Current Price", field: "current_price" },
    { label: "Current Value", field: "current_value" },
    { label: "P&L", field: "pnl" },
    { label: "P&L %", field: "pnl_pct" },
  ];

  if (holdings.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted">
        No holdings yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.field}
                className="cursor-pointer px-4 py-3 text-left text-xs font-medium text-muted hover:text-white"
                onClick={() => handleSort(col.field)}
              >
                {col.label}
                {sortField === col.field && (
                  <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr
              key={h.id}
              className="border-b border-border/50 transition hover:bg-surface-hover"
            >
              <td className="px-4 py-3">
                <a
                  href={`/stock/${h.symbol}`}
                  className="font-medium text-primary hover:underline"
                >
                  {h.symbol}
                </a>
              </td>
              <td className="px-4 py-3">{h.quantity}</td>
              <td className="px-4 py-3">{fmtCurrency(h.avg_buy_price)}</td>
              <td className="px-4 py-3">{fmtCurrency(h.current_price)}</td>
              <td className="px-4 py-3">{fmtCurrency(h.cv)}</td>
              <td
                className={clsx(
                  "px-4 py-3 font-medium",
                  h.pnl >= 0 ? "text-green-400" : "text-red-400"
                )}
              >
                {h.pnl >= 0 ? "+" : ""}
                {fmtCurrency(h.pnl)}
              </td>
              <td
                className={clsx(
                  "px-4 py-3 font-medium",
                  h.pnl_pct >= 0 ? "text-green-400" : "text-red-400"
                )}
              >
                {fmtPct(h.pnl_pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

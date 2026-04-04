"use client";

import { clsx } from "clsx";

interface Trade {
  id: string;
  symbol: string;
  trade_type: string;
  quantity: number;
  price: number;
  total_value: number;
  traded_at: string | null;
}

interface TradeHistoryProps {
  trades: Trade[];
}

function fmtCurrency(v: number): string {
  return v.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string | null): string {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TradeHistory({ trades }: TradeHistoryProps) {
  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-muted">
        No trades yet. Start by buying a stock!
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left text-xs font-medium text-muted">
              Date
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted">
              Symbol
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted">
              Type
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted">
              Qty
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted">
              Price
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr
              key={t.id}
              className="border-b border-border/50 transition hover:bg-surface-hover"
            >
              <td className="px-4 py-3 text-xs text-muted">
                {fmtDate(t.traded_at)}
              </td>
              <td className="px-4 py-3">
                <a
                  href={`/stock/${t.symbol}`}
                  className="font-medium text-primary hover:underline"
                >
                  {t.symbol}
                </a>
              </td>
              <td className="px-4 py-3">
                <span
                  className={clsx(
                    "rounded px-2 py-0.5 text-xs font-medium",
                    t.trade_type === "buy"
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-red-400"
                  )}
                >
                  {t.trade_type.toUpperCase()}
                </span>
              </td>
              <td className="px-4 py-3 text-right">{t.quantity}</td>
              <td className="px-4 py-3 text-right">{fmtCurrency(t.price)}</td>
              <td className="px-4 py-3 text-right font-medium">
                {fmtCurrency(t.total_value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

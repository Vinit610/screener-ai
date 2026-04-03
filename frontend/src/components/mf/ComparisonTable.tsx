"use client";

import { clsx } from "clsx";

interface ComparisonMetric {
  label: string;
  valueA: string;
  valueB: string;
  winner: "a" | "b" | "tie" | "none";
}

interface ComparisonTableProps {
  nameA: string;
  nameB: string;
  metrics: ComparisonMetric[];
}

export default function ComparisonTable({
  nameA,
  nameB,
  metrics,
}: ComparisonTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-2.5 text-left text-muted font-medium">
              Metric
            </th>
            <th className="px-4 py-2.5 text-right text-white font-medium">
              {nameA}
            </th>
            <th className="px-4 py-2.5 text-right text-white font-medium">
              {nameB}
            </th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label} className="border-b border-border/50 last:border-0">
              <td className="px-4 py-2 text-muted">{m.label}</td>
              <td
                className={clsx(
                  "px-4 py-2 text-right font-medium",
                  m.winner === "a" ? "text-accent" : "text-foreground"
                )}
              >
                {m.valueA}
              </td>
              <td
                className={clsx(
                  "px-4 py-2 text-right font-medium",
                  m.winner === "b" ? "text-accent" : "text-foreground"
                )}
              >
                {m.valueB}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Build comparison metrics for two stocks.
 */
export function buildStockMetrics(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): ComparisonMetric[] {
  const fa = (a.fundamentals ?? {}) as Record<string, unknown>;
  const fb = (b.fundamentals ?? {}) as Record<string, unknown>;

  function num(v: unknown): number | null {
    return typeof v === "number" ? v : null;
  }

  function fmt(v: number | null): string {
    if (v == null) return "–";
    return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function fmtCr(v: number | null): string {
    if (v == null) return "–";
    if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L Cr`;
    if (v >= 1_000) return `₹${(v / 1_000).toFixed(1)}K Cr`;
    return `₹${v.toFixed(0)} Cr`;
  }

  // winner logic: for PE, D/E lower is better. For ROE, margin, etc higher is better.
  function winner(
    va: number | null,
    vb: number | null,
    lowerIsBetter: boolean
  ): "a" | "b" | "tie" | "none" {
    if (va == null || vb == null) return "none";
    if (va === vb) return "tie";
    if (lowerIsBetter) return va < vb ? "a" : "b";
    return va > vb ? "a" : "b";
  }

  const peA = num(fa.pe);
  const peB = num(fb.pe);
  const pbA = num(fa.pb);
  const pbB = num(fb.pb);
  const roeA = num(fa.roe);
  const roeB = num(fb.roe);
  const roceA = num(fa.roce);
  const roceB = num(fb.roce);
  const deA = num(fa.debt_to_equity);
  const deB = num(fb.debt_to_equity);
  const marginA = num(fa.net_margin);
  const marginB = num(fb.net_margin);
  const dyA = num(fa.dividend_yield);
  const dyB = num(fb.dividend_yield);
  const epsA = num(fa.eps);
  const epsB = num(fb.eps);
  const mcapA = num(a.market_cap_cr);
  const mcapB = num(b.market_cap_cr);

  return [
    { label: "PE Ratio", valueA: fmt(peA), valueB: fmt(peB), winner: winner(peA, peB, true) },
    { label: "PB Ratio", valueA: fmt(pbA), valueB: fmt(pbB), winner: winner(pbA, pbB, true) },
    { label: "ROE (%)", valueA: roeA != null ? `${fmt(roeA)}%` : "–", valueB: roeB != null ? `${fmt(roeB)}%` : "–", winner: winner(roeA, roeB, false) },
    { label: "ROCE (%)", valueA: roceA != null ? `${fmt(roceA)}%` : "–", valueB: roceB != null ? `${fmt(roceB)}%` : "–", winner: winner(roceA, roceB, false) },
    { label: "D/E Ratio", valueA: fmt(deA), valueB: fmt(deB), winner: winner(deA, deB, true) },
    { label: "Net Margin (%)", valueA: marginA != null ? `${fmt(marginA)}%` : "–", valueB: marginB != null ? `${fmt(marginB)}%` : "–", winner: winner(marginA, marginB, false) },
    { label: "Dividend Yield", valueA: dyA != null ? `${fmt(dyA)}%` : "–", valueB: dyB != null ? `${fmt(dyB)}%` : "–", winner: winner(dyA, dyB, false) },
    { label: "EPS", valueA: epsA != null ? `₹${fmt(epsA)}` : "–", valueB: epsB != null ? `₹${fmt(epsB)}` : "–", winner: winner(epsA, epsB, false) },
    { label: "Market Cap", valueA: fmtCr(mcapA), valueB: fmtCr(mcapB), winner: "none" },
  ];
}

/**
 * Build comparison metrics for two mutual funds.
 */
export function buildMFMetrics(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): ComparisonMetric[] {
  function num(v: unknown): number | null {
    return typeof v === "number" ? v : null;
  }

  function fmt(v: number | null): string {
    if (v == null) return "–";
    return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function fmtCr(v: number | null): string {
    if (v == null) return "–";
    if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L Cr`;
    if (v >= 1_000) return `₹${(v / 1_000).toFixed(1)}K Cr`;
    return `₹${v.toFixed(0)} Cr`;
  }

  function winner(
    va: number | null,
    vb: number | null,
    lowerIsBetter: boolean
  ): "a" | "b" | "tie" | "none" {
    if (va == null || vb == null) return "none";
    if (va === vb) return "tie";
    if (lowerIsBetter) return va < vb ? "a" : "b";
    return va > vb ? "a" : "b";
  }

  const erA = num(a.expense_ratio);
  const erB = num(b.expense_ratio);
  const aumA = num(a.aum_cr);
  const aumB = num(b.aum_cr);

  return [
    { label: "Expense Ratio", valueA: erA != null ? `${fmt(erA)}%` : "–", valueB: erB != null ? `${fmt(erB)}%` : "–", winner: winner(erA, erB, true) },
    { label: "AUM", valueA: fmtCr(aumA), valueB: fmtCr(aumB), winner: "none" },
    { label: "Category", valueA: String(a.category ?? "–"), valueB: String(b.category ?? "–"), winner: "none" },
    { label: "Fund House", valueA: String(a.fund_house ?? "–"), valueB: String(b.fund_house ?? "–"), winner: "none" },
  ];
}

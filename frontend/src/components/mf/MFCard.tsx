"use client";

import Badge from "@/components/ui/Badge";
import Metric from "@/components/ui/Metric";

interface MFCardProps {
  fund: {
    id: string;
    scheme_code: string;
    scheme_name: string;
    fund_house: string;
    category?: string | null;
    sub_category?: string | null;
    expense_ratio?: number | null;
    aum_cr?: number | null;
    is_direct?: boolean | null;
    is_growth?: boolean | null;
    returns?: {
      return_1y?: number | null;
      return_3y?: number | null;
    } | null;
    sharpe_ratio?: number | null;
  };
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

function returnColor(v: number | null | undefined): "default" | "green" | "red" {
  if (v == null) return "default";
  return v >= 0 ? "green" : "red";
}

export default function MFCard({ fund }: MFCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 transition hover:border-muted/50">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <a
            href={`/mf/${fund.scheme_code}`}
            className="text-sm font-semibold text-primary hover:underline line-clamp-1"
          >
            {fund.scheme_name}
          </a>
          <p className="mt-0.5 text-xs text-muted truncate">{fund.fund_house}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {fund.category && <Badge label={fund.category} variant="sector" />}
          {fund.is_direct && (
            <Badge label="Direct" variant="positive" />
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-3 flex flex-wrap gap-4">
        <Metric
          label="Expense Ratio"
          value={fund.expense_ratio != null ? `${fmt(fund.expense_ratio)}%` : "–"}
          color={
            fund.expense_ratio != null
              ? fund.expense_ratio <= 0.5
                ? "green"
                : fund.expense_ratio > 2
                ? "red"
                : "default"
              : "default"
          }
        />
        <Metric label="AUM" value={fmtCr(fund.aum_cr)} />
        <Metric
          label="1Y Return"
          value={fund.returns?.return_1y != null ? `${fmt(fund.returns.return_1y)}%` : "–"}
          color={returnColor(fund.returns?.return_1y)}
        />
        <Metric
          label="3Y Return"
          value={fund.returns?.return_3y != null ? `${fmt(fund.returns.return_3y)}%` : "–"}
          color={returnColor(fund.returns?.return_3y)}
        />
        <Metric
          label="Sharpe"
          value={fund.sharpe_ratio != null ? fmt(fund.sharpe_ratio) : "–"}
          color={
            fund.sharpe_ratio != null
              ? fund.sharpe_ratio >= 1
                ? "green"
                : fund.sharpe_ratio < 0
                ? "red"
                : "default"
              : "default"
          }
        />
      </div>

      <p className="mt-2 text-[10px] text-muted/60">
        Educational insight only — not investment advice.
      </p>
    </div>
  );
}

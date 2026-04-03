"use client";

import { useState } from "react";
import { clsx } from "clsx";
import Badge from "@/components/ui/Badge";
import Metric from "@/components/ui/Metric";
import StreamingText from "@/components/ui/StreamingText";
import { Skeleton } from "@/components/ui/Skeleton";
import { useStockExplanation } from "@/hooks/useStockExplanation";
import type { StockCardProps } from "@/types";
import { useUserStore } from "@/store/userStore";

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

export default function StockCard({ stock, variant, showAI }: StockCardProps) {
  const f = stock.fundamentals;
  const isDetail = variant === "detail";
  const [aiEnabled, setAiEnabled] = useState(isDetail);
  const { user } = useUserStore();
  const isAuthenticated = !!user;
  const effectiveShowAI = showAI !== false && isAuthenticated;
  const { explanation, isStreaming, error: aiError } = useStockExplanation(
    stock.symbol,
    aiEnabled && effectiveShowAI,
  );

  const pe = f?.pe ?? stock.pe ?? null;
  const roe = f?.roe ?? stock.roe ?? null;
  const de = f?.debt_to_equity ?? null;
  const dy = f?.dividend_yield ?? stock.dividend_yield ?? null;
  const mcap = stock.market_cap_cr;

  const isCompact = variant === "table-row";

  return (
    <div
      className={clsx(
        "group rounded-lg border border-border bg-surface transition hover:border-muted/50",
        isCompact ? "p-3" : "p-5"
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <a
          href={`/stock/${stock.symbol}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          {stock.symbol}
        </a>
        <span className="truncate text-xs text-muted">{stock.name}</span>
        {stock.sector && <Badge label={stock.sector} variant="sector" />}
      </div>

      {/* Metrics row */}
      <div
        className={clsx(
          "mt-2 flex flex-wrap gap-4",
          isDetail && "gap-6"
        )}
      >
        <Metric label="PE" value={fmt(pe)} />
        <Metric
          label="ROE"
          value={pe != null ? `${fmt(roe)}%` : "–"}
          color={roe != null ? (roe >= 15 ? "green" : roe < 0 ? "red" : "default") : "default"}
        />
        <Metric
          label="D/E"
          value={fmt(de)}
          color={de != null ? (de <= 0.5 ? "green" : de > 2 ? "red" : "default") : "default"}
        />
        <Metric label="Mcap" value={fmtCr(mcap)} />
        <Metric
          label="Div Yield"
          value={dy != null ? `${fmt(dy)}%` : "–"}
          color={dy != null ? (dy >= 2 ? "green" : "default") : "default"}
        />
      </div>

      {/* Detail-only: extra metrics */}
      {isDetail && f && (
        <div className="mt-3 flex flex-wrap gap-4">
          <Metric label="ROCE" value={f.roce != null ? `${fmt(f.roce)}%` : "–"} />
          <Metric label="Net Margin" value={f.net_margin != null ? `${fmt(f.net_margin)}%` : "–"} />
          <Metric label="EPS" value={fmt(f.eps)} />
          <Metric label="Book Value" value={fmt(f.book_value)} />
          <Metric label="Graham №" value={fmt(f.graham_number)} />
        </div>
      )}

      {/* AI explanation */}
      {!isCompact && (
        <div className="mt-3 rounded bg-background/50 p-2 text-xs text-muted">
          {!isAuthenticated ? (
            <p className="italic">
              <a href="/auth/login" className="text-primary hover:underline">
                Log in to see AI insights personalised to your investing style &rarr;
              </a>
            </p>
          ) : !aiEnabled ? (
            <button
              type="button"
              onClick={() => setAiEnabled(true)}
              className="italic text-primary hover:underline"
            >
              Show AI insight
            </button>
          ) : isStreaming && !explanation ? (
            <Skeleton className="h-12 w-full" />
          ) : aiError ? (
            <p className="italic text-red-400">Could not generate insight.</p>
          ) : (
            <StreamingText text={explanation} isStreaming={isStreaming} />
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p className="mt-2 text-[10px] text-muted/60">
        Educational insight only — not investment advice.
      </p>
    </div>
  );
}

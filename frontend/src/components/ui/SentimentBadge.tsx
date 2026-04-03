"use client";

import { clsx } from "clsx";

interface SentimentBadgeProps {
  sentiment: "positive" | "negative" | "neutral";
  score?: number | null;
}

export default function SentimentBadge({ sentiment, score }: SentimentBadgeProps) {
  const colorMap = {
    positive: { bg: "bg-accent/15", text: "text-accent", bar: "bg-accent" },
    negative: { bg: "bg-danger/15", text: "text-danger", bar: "bg-danger" },
    neutral: { bg: "bg-muted/15", text: "text-muted", bar: "bg-muted" },
  };

  const c = colorMap[sentiment];
  const label = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
  const pct = score != null ? Math.round(Math.abs(score) * 100) : null;

  return (
    <div className={clsx("inline-flex items-center gap-2 rounded-full px-3 py-1", c.bg)}>
      <span className={clsx("text-xs font-medium", c.text)}>{label}</span>
      {pct != null && (
        <div className="h-1.5 w-12 rounded-full bg-border">
          <div
            className={clsx("h-full rounded-full", c.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

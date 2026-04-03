"use client";

import type { ScreenerFilters } from "@/types";

interface FilterAppliedMessageProps {
  content: string;
  filters?: Partial<ScreenerFilters>;
  filterCount?: number;
  resultCount?: number;
}

const FILTER_LABELS: Record<string, string> = {
  market_cap_category: "Market Cap",
  sector: "Sector",
  min_pe: "Min PE",
  max_pe: "Max PE",
  min_pb: "Min PB",
  max_pb: "Max PB",
  min_roe: "Min ROE",
  max_roe: "Max ROE",
  min_roce: "Min ROCE",
  max_roce: "Max ROCE",
  max_debt_to_equity: "Max D/E",
  min_net_margin: "Min Net Margin",
  min_dividend_yield: "Min Dividend Yield",
  exclude_loss_making: "Exclude Loss-Making",
};

export default function FilterAppliedMessage({
  content,
  filters,
  filterCount,
  resultCount,
}: FilterAppliedMessageProps) {
  const filterEntries = filters ? Object.entries(filters) : [];

  return (
    <div className="mr-auto max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm text-gray-200">
      <p className="mb-2">{content}</p>
      {filterEntries.length > 0 && (
        <div className="rounded border border-border bg-background/50 p-2">
          <p className="mb-1 text-xs font-medium text-primary">
            Applied {filterCount ?? filterEntries.length} filter{(filterCount ?? filterEntries.length) !== 1 ? "s" : ""}
          </p>
          <ul className="space-y-0.5 text-xs text-muted">
            {filterEntries.map(([key, value]) => (
              <li key={key}>
                <span className="text-gray-400">{FILTER_LABELS[key] || key}:</span>{" "}
                <span className="text-white">{String(value)}</span>
              </li>
            ))}
          </ul>
          {resultCount != null && (
            <p className="mt-1 text-xs text-muted">
              {resultCount} stock{resultCount !== 1 ? "s" : ""} found
            </p>
          )}
        </div>
      )}
    </div>
  );
}

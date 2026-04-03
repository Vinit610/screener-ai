"use client";

import { useScreenerStore } from "@/store/screenerStore";
import FilterSection from "./FilterSection";
import FilterSlider from "./FilterSlider";
import type { ScreenerFilters } from "@/types";

const SECTOR_OPTIONS = [
  "IT",
  "Banking",
  "FMCG",
  "Pharma",
  "Auto",
  "Energy",
  "Metals",
  "Cement",
  "Realty",
  "Chemicals",
  "Telecom",
  "Infrastructure",
  "Consumer Durables",
  "Financial Services",
  "Media",
  "Textiles",
];

const MARKET_CAP_OPTIONS = [
  { label: "Large", value: "large" },
  { label: "Mid", value: "mid" },
  { label: "Small", value: "small" },
  { label: "Micro", value: "micro" },
] as const;

export default function FilterPanel() {
  const filters = useScreenerStore((s) => s.filters);
  const setFilters = useScreenerStore((s) => s.setFilters);
  const resetFilters = useScreenerStore((s) => s.resetFilters);

  const update = (partial: Partial<ScreenerFilters>) => setFilters(partial);

  return (
    <aside className="flex w-full flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-bold text-foreground">Filters</h2>

      {/* Size — Market Cap Category */}
      <FilterSection title="Size" defaultOpen>
        <div className="flex flex-wrap gap-2">
          {MARKET_CAP_OPTIONS.map((opt) => {
            const active = filters.market_cap_category === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  update({
                    market_cap_category: active ? undefined : opt.value,
                  })
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted hover:border-muted"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* Sector */}
      <FilterSection title="Sector" defaultOpen={false}>
        <select
          value={filters.sector ?? ""}
          onChange={(e) =>
            update({ sector: e.target.value || undefined })
          }
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-xs text-foreground"
        >
          <option value="">All Sectors</option>
          {SECTOR_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FilterSection>

      {/* Valuation */}
      <FilterSection title="Valuation">
        <FilterSlider
          label="PE Ratio"
          min={0}
          max={100}
          step={0.5}
          value={filters.pe}
          onChange={(pe) => update({ pe })}
        />
        <FilterSlider
          label="PB Ratio"
          min={0}
          max={20}
          step={0.1}
          value={filters.pb}
          onChange={(pb) => update({ pb })}
        />
      </FilterSection>

      {/* Quality */}
      <FilterSection title="Quality">
        <FilterSlider
          label="ROE (%)"
          min={0}
          max={100}
          step={1}
          value={filters.roe}
          onChange={(roe) => update({ roe })}
        />
        <FilterSlider
          label="ROCE (%)"
          min={0}
          max={100}
          step={1}
          value={filters.roce}
          onChange={(roce) => update({ roce })}
        />
        <FilterSlider
          label="D/E Ratio"
          min={0}
          max={5}
          step={0.1}
          value={filters.debt_to_equity}
          onChange={(debt_to_equity) => update({ debt_to_equity })}
        />
        <FilterSlider
          label="Net Margin (%)"
          min={-50}
          max={50}
          step={1}
          value={filters.net_margin}
          onChange={(net_margin) => update({ net_margin })}
        />
      </FilterSection>

      {/* Income */}
      <FilterSection title="Income" defaultOpen={false}>
        <FilterSlider
          label="Dividend Yield (%)"
          min={0}
          max={15}
          step={0.1}
          value={filters.dividend_yield}
          onChange={(dividend_yield) => update({ dividend_yield })}
        />
      </FilterSection>

      {/* Other */}
      <FilterSection title="Other" defaultOpen={false}>
        <label className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={filters.exclude_loss_making ?? false}
            onChange={(e) =>
              update({ exclude_loss_making: e.target.checked || undefined })
            }
            className="rounded border-border accent-primary"
          />
          Exclude loss-making companies
        </label>
      </FilterSection>

      {/* Reset */}
      <button
        type="button"
        onClick={resetFilters}
        className="mt-2 w-full rounded border border-border py-1.5 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground transition"
      >
        Reset Filters
      </button>
    </aside>
  );
}

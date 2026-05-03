"use client";

import { useScreenerStore } from "@/store/screenerStore";
import SemanticSelector from "./SemanticSelector";
import QualityGate from "./QualityGate";
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
] as const;

export default function FilterPanel() {
  const filters = useScreenerStore((s) => s.filters);
  const setFilters = useScreenerStore((s) => s.setFilters);
  const resetFilters = useScreenerStore((s) => s.resetFilters);

  const update = (partial: Partial<ScreenerFilters>) => setFilters(partial);

  return (
    <aside className="flex w-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      {/* Header with Reset */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">Filters</h2>
        <button
          type="button"
          onClick={resetFilters}
          className="text-xs text-muted hover:text-foreground transition underline"
        >
          Reset
        </button>
      </div>

      {/* Sector Pills */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-foreground">Sector</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => update({ sector: undefined })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              !filters.sector
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted hover:border-muted"
            }`}
          >
            All
          </button>
          {SECTOR_OPTIONS.map((sector) => {
            const active = filters.sector === sector;
            return (
              <button
                key={sector}
                type="button"
                onClick={() =>
                  update({ sector: active ? undefined : sector })
                }
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted hover:border-muted"
                }`}
              >
                {sector}
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-border" />

      {/* Valuation Selectors */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Valuation
        </h3>

        <SemanticSelector
          label="P/E Ratio"
          description="Price relative to earnings"
          buckets={{
            cheap: { min: 0, max: 15 },
            fair: { min: 15, max: 22 },
            expensive: { min: 22, max: 100 },
          }}
          value={filters.pe_semantic}
          onChange={(pe_semantic) => update({ pe_semantic })}
        />

        <SemanticSelector
          label="P/B Ratio"
          description="Price relative to book value"
          buckets={{
            cheap: { min: 0, max: 1.2 },
            fair: { min: 1.2, max: 2.0 },
            expensive: { min: 2.0, max: 20 },
          }}
          value={filters.pb_semantic}
          onChange={(pb_semantic) => update({ pb_semantic })}
        />

        <SemanticSelector
          label="Dividend Yield"
          description="Annual dividend as % of price"
          buckets={{
            cheap: { min: 2, max: 15 },
            fair: { min: 1, max: 2 },
            expensive: { min: 0, max: 1 },
          }}
          value={filters.dividend_yield_semantic}
          onChange={(dividend_yield_semantic) => update({ dividend_yield_semantic })}
        />
      </div>

      <hr className="border-border" />

      {/* Quality Gate */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
          Quality
        </h3>
        <QualityGate
          checked={filters.quality_gate ?? false}
          onChange={(quality_gate) => update({ quality_gate })}
        />
      </div>

      <hr className="border-border" />

      {/* Other Filters */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
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
      </div>
    </aside>
  );
}
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

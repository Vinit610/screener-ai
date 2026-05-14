"use client";

import { useState } from "react";

interface MFFilterPanelProps {
  filters: {
    fund_house?: string;
    max_expense_ratio?: number;
    min_aum_cr?: number;
  };
  onChange: (filters: MFFilterPanelProps["filters"]) => void;
  onReset: () => void;
}

export default function MFFilterPanel({
  filters,
  onChange,
  onReset,
}: MFFilterPanelProps) {
  const [fundHouseInput, setFundHouseInput] = useState(filters.fund_house ?? "");

  function update(partial: Partial<MFFilterPanelProps["filters"]>) {
    onChange({ ...filters, ...partial });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-white">Filters</h3>

      {/* Fund House */}
      <div>
        <label className="mb-1 block text-xs text-muted">Fund House</label>
        <input
          type="text"
          value={fundHouseInput}
          onChange={(e) => setFundHouseInput(e.target.value)}
          onBlur={() => update({ fund_house: fundHouseInput || undefined })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              update({ fund_house: fundHouseInput || undefined });
            }
          }}
          placeholder="e.g. HDFC, SBI, ICICI"
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs text-white placeholder:text-muted/50 focus:border-primary focus:outline-none"
        />
      </div>

      {/* Max Expense Ratio */}
      <div>
        <label className="mb-1 block text-xs text-muted">
          Max Expense Ratio: {filters.max_expense_ratio ?? "Any"}%
        </label>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={filters.max_expense_ratio ?? 3}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            update({ max_expense_ratio: v >= 3 ? undefined : v });
          }}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted">
          <span>0%</span>
          <span>3%</span>
        </div>
      </div>

      {/* Min AUM */}
      <div>
        <label className="mb-1 block text-xs text-muted">
          Min AUM: {filters.min_aum_cr != null ? `₹${filters.min_aum_cr} Cr` : "Any"}
        </label>
        <input
          type="range"
          min={0}
          max={50000}
          step={500}
          value={filters.min_aum_cr ?? 0}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            update({ min_aum_cr: v === 0 ? undefined : v });
          }}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted">
          <span>₹0</span>
          <span>₹50K Cr</span>
        </div>
      </div>

      {/* Reset */}
      <button
        type="button"
        onClick={onReset}
        className="w-full rounded border border-border px-3 py-1.5 text-xs text-muted transition hover:border-muted hover:text-white"
      >
        Reset Filters
      </button>
    </div>
  );
}

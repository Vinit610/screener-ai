"use client";

import FilterPanel from "./FilterPanel";
import ResultsTable from "./ResultsTable";

export default function ScreenerLayout() {
  return (
    <div className="flex flex-1 flex-col h-[calc(100vh-2rem)] overflow-hidden">
      {/* Full width layout */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row gap-4 p-4">
        {/* Left panel: FilterPanel (≈20% on desktop, full width on mobile) */}
        <div className="w-full md:w-72 md:shrink-0 overflow-y-auto">
          <FilterPanel />
        </div>

        {/* Right panel: Results (≈80% on desktop, full width on mobile) */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <ResultsTable />
        </div>
      </div>
    </div>
  );
}

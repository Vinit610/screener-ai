"use client";

import { useState } from "react";
import FilterPanel from "./FilterPanel";
import ResultsTable from "./ResultsTable";
import ChatPanel from "@/components/chat/ChatPanel";

type MobileTab = "screener" | "chat";

export default function ScreenerLayout() {
  const [mobileTab, setMobileTab] = useState<MobileTab>("screener");

  return (
    <div className="flex flex-1 flex-col h-[calc(100vh-2rem)] overflow-hidden">
      {/* ── Desktop layout (≥768px) ─────────────────────────────────── */}
      <div className="hidden flex-1 md:flex overflow-hidden">
        {/* Left panel: FilterPanel + ResultsTable (≈60%) */}
        <div className="flex gap-4 overflow-hidden p-4" style={{ flex: "0 0 60%" }}>
          {/* Filter sidebar */}
          <div className="w-64 shrink-0 overflow-y-auto">
            <FilterPanel />
          </div>

          {/* Results area */}
          <div className="flex flex-1 flex-col overflow-y-auto">
            <ResultsTable />
          </div>
        </div>

        {/* Right panel: Chat (≈40%) */}
        <div className="flex flex-col border-l border-border overflow-hidden" style={{ flex: "0 0 40%" }}>
          <ChatPanel />
        </div>
      </div>

      {/* ── Mobile layout (<768px) ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col md:hidden">
        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-3">
          {mobileTab === "screener" && (
            <div className="flex flex-col gap-3">
              <FilterPanel />
              <ResultsTable />
            </div>
          )}
          {mobileTab === "chat" && (
            <div className="flex flex-1">
              <ChatPanel />
            </div>
          )}
        </div>

        {/* Bottom tab bar */}
        <nav className="flex border-t border-border bg-surface">
          <button
            type="button"
            onClick={() => setMobileTab("screener")}
            className={`flex-1 py-3 text-center text-xs font-medium transition ${
              mobileTab === "screener"
                ? "text-primary"
                : "text-muted"
            }`}
          >
            Screener
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("chat")}
            className={`flex-1 py-3 text-center text-xs font-medium transition ${
              mobileTab === "chat"
                ? "text-primary"
                : "text-muted"
            }`}
          >
            Chat
          </button>
        </nav>
      </div>
    </div>
  );
}

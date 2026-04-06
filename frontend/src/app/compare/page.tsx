"use client";

import { useState, useCallback } from "react";
import ComparisonTable, {
  buildStockMetrics,
  buildMFMetrics,
} from "@/components/mf/ComparisonTable";
import StreamingText from "@/components/ui/StreamingText";
import { Skeleton } from "@/components/ui/Skeleton";
import { getBackendUrl } from "@/lib/api";

type CompareMode = "stocks" | "mf";

export default function ComparePage() {
  const [mode, setMode] = useState<CompareMode>("stocks");
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonData, setComparisonData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [narrative, setNarrative] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  const fetchComparison = useCallback(async () => {
    if (!inputA.trim() || !inputB.trim()) {
      setError("Please enter both instruments to compare.");
      return;
    }
    setLoading(true);
    setError(null);
    setComparisonData(null);
    setNarrative("");
    setIsStreaming(false);

    try {
      const params = new URLSearchParams();
      if (mode === "stocks") {
        params.set("symbol_a", inputA.trim().toUpperCase());
        params.set("symbol_b", inputB.trim().toUpperCase());
      } else {
        params.set("scheme_code_a", inputA.trim());
        params.set("scheme_code_b", inputB.trim());
      }

      const res = await fetch(
        `${getBackendUrl()}/api/compare/?${params.toString()}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.detail || `Comparison failed (${res.status})`
        );
      }
      const data = await res.json();

      // For stock comparisons, enrich with live fundamentals from Yahoo Finance
      if (mode === "stocks" && data.instrument_a && data.instrument_b) {
        const [liveA, liveB] = await Promise.all([
          fetch(`/api/stock/${encodeURIComponent(inputA.trim().toUpperCase())}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`/api/stock/${encodeURIComponent(inputB.trim().toUpperCase())}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        if (liveA?.fundamentals) {
          data.instrument_a.fundamentals = liveA.fundamentals;
          if (liveA.market_cap_cr != null) data.instrument_a.market_cap_cr = liveA.market_cap_cr;
        }
        if (liveB?.fundamentals) {
          data.instrument_b.fundamentals = liveB.fundamentals;
          if (liveB.market_cap_cr != null) data.instrument_b.market_cap_cr = liveB.market_cap_cr;
        }
      }

      setComparisonData(data);
      setLoading(false);

      // Stream AI narrative for stock comparisons
      if (mode === "stocks") {
        streamNarrative(inputA.trim().toUpperCase(), inputB.trim().toUpperCase());
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch comparison"
      );
      setLoading(false);
    }
  }, [inputA, inputB, mode]);

  async function streamNarrative(symbolA: string, symbolB: string) {
    setIsStreaming(true);
    setNarrative("");

    try {
      const res = await fetch(`${getBackendUrl()}/api/ai/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol_a: symbolA,
          symbol_b: symbolB,
          investment_style: "value",
        }),
      });

      if (!res.ok) return;

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const event = JSON.parse(payload);
            if (event.type === "token" && event.text) {
              setNarrative((prev) => prev + event.text);
            }
            if (event.type === "done") break;
          } catch {
            // skip
          }
        }
      }
    } catch {
      // narrative streaming is best-effort
    } finally {
      setIsStreaming(false);
    }
  }

  const instA = comparisonData?.instrument_a as Record<string, unknown> | undefined;
  const instB = comparisonData?.instrument_b as Record<string, unknown> | undefined;

  const metrics =
    comparisonData && instA && instB
      ? mode === "stocks"
        ? buildStockMetrics(instA, instB)
        : buildMFMetrics(instA, instB)
      : [];

  const nameA =
    mode === "stocks"
      ? String(instA?.symbol ?? inputA.toUpperCase())
      : String(instA?.scheme_name ?? inputA);
  const nameB =
    mode === "stocks"
      ? String(instB?.symbol ?? inputB.toUpperCase())
      : String(instB?.scheme_name ?? inputB);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 className="text-lg font-bold text-white">Compare Instruments</h1>

      {/* Mode selector */}
      <div className="flex gap-2">
        {(["stocks", "mf"] as CompareMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setComparisonData(null);
              setNarrative("");
              setError(null);
            }}
            className={`rounded-lg px-4 py-2 text-xs font-medium transition ${
              mode === m
                ? "bg-primary text-white"
                : "bg-surface text-muted hover:text-white"
            }`}
          >
            {m === "stocks" ? "Stock vs Stock" : "MF vs MF"}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted">
            {mode === "stocks" ? "Stock A (Symbol)" : "MF A (Scheme Code)"}
          </label>
          <input
            type="text"
            value={inputA}
            onChange={(e) => setInputA(e.target.value)}
            placeholder={mode === "stocks" ? "e.g. TCS" : "e.g. 118989"}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex items-end pb-0.5 text-sm text-muted">vs</div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-muted">
            {mode === "stocks" ? "Stock B (Symbol)" : "MF B (Scheme Code)"}
          </label>
          <input
            type="text"
            value={inputB}
            onChange={(e) => setInputB(e.target.value)}
            placeholder={mode === "stocks" ? "e.g. INFY" : "e.g. 120644"}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={fetchComparison}
        disabled={loading}
        className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white transition hover:bg-primary/80 disabled:opacity-50"
      >
        {loading ? "Comparing…" : "Compare"}
      </button>

      {error && (
        <p className="text-sm text-danger">{error}</p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {/* Results table */}
      {comparisonData && metrics.length > 0 && (
        <>
          <ComparisonTable
            nameA={nameA}
            nameB={nameB}
            metrics={metrics}
          />

          {/* AI Narrative */}
          {(narrative || isStreaming) && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-2 text-sm font-semibold text-white">
                AI Analysis
              </h3>
              <div className="text-xs text-muted leading-relaxed">
                <StreamingText text={narrative} isStreaming={isStreaming} />
              </div>
              <p className="mt-2 text-[10px] text-muted/60">
                Educational insight only — not investment advice.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
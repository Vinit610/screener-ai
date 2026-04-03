"use client";

import { useEffect } from "react";
import { useScreenerStore } from "@/store/screenerStore";
import StockCard from "./StockCard";
import { SkeletonRow } from "@/components/ui/Skeleton";

export default function ResultsTable() {
  const results = useScreenerStore((s) => s.results);
  const isLoading = useScreenerStore((s) => s.isLoading);
  const total = useScreenerStore((s) => s.total);
  const page = useScreenerStore((s) => s.page);
  const limit = useScreenerStore((s) => s.limit);
  const error = useScreenerStore((s) => s.error);
  const fetchResults = useScreenerStore((s) => s.fetchResults);
  const setPage = useScreenerStore((s) => s.setPage);
  const filters = useScreenerStore((s) => s.filters);
  const sortBy = useScreenerStore((s) => s.sortBy);
  const sortDir = useScreenerStore((s) => s.sortDir);

  // Fetch on mount and whenever filters, page, or sort changes
  useEffect(() => {
    fetchResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, limit, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex flex-1 flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted">
          {isLoading
            ? "Loading…"
            : `${total} result${total !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Loading skeletons */}
      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {/* Results */}
      {!isLoading && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {results.map((stock) => (
            <StockCard key={stock.id} stock={stock} variant="table-row" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && results.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted">
          No stocks match your filters. Try relaxing the criteria.
        </div>
      )}

      {/* Pagination */}
      {!isLoading && total > limit && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded border border-border px-3 py-1 text-xs text-foreground disabled:opacity-30"
          >
            ← Prev
          </button>

          <span className="text-xs tabular-nums text-muted">
            Page {page} / {totalPages}
          </span>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded border border-border px-3 py-1 text-xs text-foreground disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

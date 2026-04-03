"use client";

import { useState, useEffect, useCallback } from "react";
import MFCard from "@/components/mf/MFCard";
import MFFilterPanel from "@/components/mf/MFFilterPanel";
import { Skeleton } from "@/components/ui/Skeleton";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface MFFilters {
  category?: string;
  fund_house?: string;
  max_expense_ratio?: number;
  min_aum_cr?: number;
  is_direct?: boolean;
}

interface MFResult {
  id: string;
  scheme_code: string;
  scheme_name: string;
  fund_house: string;
  category?: string | null;
  sub_category?: string | null;
  expense_ratio?: number | null;
  aum_cr?: number | null;
  is_direct?: boolean | null;
  is_growth?: boolean | null;
}

const defaultFilters: MFFilters = {};

export default function MFPage() {
  const [filters, setFilters] = useState<MFFilters>(defaultFilters);
  const [results, setResults] = useState<MFResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const fetchResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.category) params.set("category", filters.category);
      if (filters.fund_house) params.set("fund_house", filters.fund_house);
      if (filters.max_expense_ratio != null)
        params.set("max_expense_ratio", String(filters.max_expense_ratio));
      if (filters.min_aum_cr != null)
        params.set("min_aum_cr", String(filters.min_aum_cr));
      if (filters.is_direct != null)
        params.set("is_direct", String(filters.is_direct));
      params.set("page", String(page));
      params.set("limit", String(limit));
      params.set("sort_by", "aum_cr");
      params.set("sort_dir", "desc");

      const res = await fetch(
        `${BACKEND_URL}/api/mf/screen?${params.toString()}`
      );
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setResults(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  function handleFilterChange(newFilters: MFFilters) {
    setFilters(newFilters);
    setPage(1);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      {/* Filter sidebar */}
      <div className="w-full shrink-0 overflow-y-auto p-4 lg:w-72">
        <MFFilterPanel
          filters={filters}
          onChange={handleFilterChange}
          onReset={() => {
            setFilters({});
            setPage(1);
          }}
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Mutual Funds</h1>
          <span className="text-xs text-muted">
            {total} fund{total !== 1 ? "s" : ""} found
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <Skeleton className="mb-2 h-4 w-2/3" />
                <Skeleton className="mb-3 h-3 w-1/3" />
                <div className="flex gap-4">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
            No mutual funds match your filters. Try adjusting your criteria.
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {results.map((fund) => (
                <MFCard key={fund.id} fund={fund} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded border border-border px-3 py-1 text-xs text-muted transition hover:text-white disabled:opacity-30"
                >
                  Previous
                </button>
                <span className="text-xs text-muted">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-border px-3 py-1 text-xs text-muted transition hover:text-white disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
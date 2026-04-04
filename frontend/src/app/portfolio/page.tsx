"use client";

import { useEffect, useState, useCallback } from "react";
import { useUserStore } from "@/store/userStore";
import { getBackendUrl } from "@/lib/api";
import PnLSummary from "@/components/portfolio/PnLSummary";
import HoldingsTable from "@/components/portfolio/HoldingsTable";
import CSVUploader from "@/components/portfolio/CSVUploader";
import type { PortfolioHolding } from "@/types";

interface PortfolioData {
  total_invested: number;
  total_current_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  holdings: PortfolioHolding[];
}

interface AddHoldingForm {
  symbol: string;
  quantity: string;
  avg_buy_price: string;
}

export default function PortfolioPage() {
  const { user, accessToken } = useUserStore();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddHoldingForm>({
    symbol: "",
    quantity: "",
    avg_buy_price: "",
  });
  const [isAdding, setIsAdding] = useState(false);

  const fetchPortfolio = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${getBackendUrl()}/api/portfolio`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) throw new Error("Failed to fetch portfolio");
      const json: PortfolioData = await resp.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading portfolio");
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) fetchPortfolio();
  }, [accessToken, fetchPortfolio]);

  async function handleAddHolding(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setIsAdding(true);
    try {
      const resp = await fetch(`${getBackendUrl()}/api/portfolio/holding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          symbol: addForm.symbol.toUpperCase(),
          instrument_type: "stock",
          quantity: parseFloat(addForm.quantity),
          avg_buy_price: parseFloat(addForm.avg_buy_price),
        }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => null);
        throw new Error(d?.detail || "Failed to add holding");
      }
      setShowAddForm(false);
      setAddForm({ symbol: "", quantity: "", avg_buy_price: "" });
      fetchPortfolio();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add holding");
    } finally {
      setIsAdding(false);
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted">
          <a href="/auth/login" className="text-primary hover:underline">
            Log in
          </a>{" "}
          to view your portfolio.
        </p>
      </div>
    );
  }

  const hasHoldings = data && data.holdings.length > 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Portfolio</h1>
        {hasHoldings && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary/80"
          >
            + Add Holding
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-muted">Loading portfolio...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!isLoading && !hasHoldings && (
        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <h2 className="mb-2 text-lg font-semibold">
              Import your portfolio
            </h2>
            <p className="mb-6 text-sm text-muted">
              Upload a broker CSV file or add holdings manually.
            </p>
            {accessToken && (
              <CSVUploader
                onUploadSuccess={fetchPortfolio}
                backendUrl={getBackendUrl()}
                token={accessToken}
              />
            )}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="text-sm text-primary hover:underline"
              >
                or Add manually
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLoading && hasHoldings && data && (
        <>
          <PnLSummary
            totalInvested={data.total_invested}
            totalCurrentValue={data.total_current_value}
            totalPnl={data.total_pnl}
            totalPnlPct={data.total_pnl_pct}
          />
          <HoldingsTable holdings={data.holdings} />
        </>
      )}

      {/* Add Holding Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <form
            onSubmit={handleAddHolding}
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Add Holding</h3>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-muted hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted">Symbol</label>
                <input
                  type="text"
                  required
                  value={addForm.symbol}
                  onChange={(e) =>
                    setAddForm({ ...addForm, symbol: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-primary"
                  placeholder="e.g. INFY"
                />
              </div>
              <div>
                <label className="text-xs text-muted">Quantity</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="any"
                  value={addForm.quantity}
                  onChange={(e) =>
                    setAddForm({ ...addForm, quantity: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted">
                  Avg Buy Price (₹)
                </label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="any"
                  value={addForm.avg_buy_price}
                  onChange={(e) =>
                    setAddForm({ ...addForm, avg_buy_price: e.target.value })
                  }
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={isAdding}
                className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/80 disabled:opacity-50"
              >
                {isAdding ? "Adding..." : "Add Holding"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
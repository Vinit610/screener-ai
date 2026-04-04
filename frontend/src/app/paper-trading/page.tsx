"use client";

import { useEffect, useState, useCallback } from "react";
import { useUserStore } from "@/store/userStore";
import { getBackendUrl } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import PaperPortfolioSummary from "@/components/portfolio/PaperPortfolioSummary";
import HoldingsTable from "@/components/portfolio/HoldingsTable";
import TradeHistory from "@/components/portfolio/TradeHistory";
import type { PortfolioHolding } from "@/types";

interface Trade {
  id: string;
  symbol: string;
  trade_type: string;
  quantity: number;
  price: number;
  total_value: number;
  traded_at: string | null;
}

interface PaperPortfolioData {
  cash_balance: number;
  holdings: PortfolioHolding[];
  total_holdings_value: number;
  total_portfolio_value: number;
  pnl_vs_baseline: number;
  pnl_pct: number;
  trades: Trade[];
}

export default function PaperTradingPage() {
  const { user } = useUserStore();
  const [data, setData] = useState<PaperPortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    async function getToken() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) setToken(session.access_token);
    }
    getToken();
  }, []);

  const fetchPaper = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${getBackendUrl()}/api/portfolio/paper`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed to fetch paper portfolio");
      const json: PaperPortfolioData = await resp.json();
      setData(json);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Error loading paper portfolio"
      );
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchPaper();
  }, [token, fetchPaper]);

  async function handleReset() {
    if (!token) return;
    setIsResetting(true);
    try {
      const resp = await fetch(
        `${getBackendUrl()}/api/portfolio/paper/reset`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!resp.ok) throw new Error("Failed to reset");
      setShowResetConfirm(false);
      fetchPaper();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsResetting(false);
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted">
          <a href="/auth/login" className="text-primary hover:underline">
            Log in
          </a>{" "}
          to use paper trading.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Paper Trading</h1>
        <button
          type="button"
          onClick={() => setShowResetConfirm(true)}
          className="rounded border border-red-500/50 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/10"
        >
          Reset Portfolio
        </button>
      </div>

      {/* Explainer for new users */}
      {data && data.holdings.length === 0 && data.trades.length === 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-sm text-yellow-300">
            Practice investing with ₹10,00,000 virtual money. No real money at
            risk.
          </p>
          <p className="mt-1 text-xs text-muted">
            Visit any{" "}
            <a href="/screener" className="text-primary hover:underline">
              stock page
            </a>{" "}
            and click &quot;Simulate Buy&quot; to get started.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-muted">Loading paper portfolio...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {!isLoading && data && (
        <>
          <PaperPortfolioSummary
            cashBalance={data.cash_balance}
            totalHoldingsValue={data.total_holdings_value}
            totalPortfolioValue={data.total_portfolio_value}
            pnlVsBaseline={data.pnl_vs_baseline}
            pnlPct={data.pnl_pct}
          />

          {data.holdings.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted">
                Paper Holdings
              </h2>
              <HoldingsTable holdings={data.holdings} />
            </div>
          )}

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted">
              Trade History
            </h2>
            <TradeHistory trades={data.trades} />
          </div>
        </>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
            <h3 className="mb-2 text-sm font-semibold">Reset Paper Portfolio?</h3>
            <p className="mb-4 text-xs text-muted">
              This will delete all paper holdings and trades, and reset your cash
              balance to ₹10,00,000. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 rounded border border-border px-4 py-2 text-sm text-muted transition hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={isResetting}
                className="flex-1 rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {isResetting ? "Resetting..." : "Reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
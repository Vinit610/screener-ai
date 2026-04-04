"use client";

import { useState } from "react";

interface TradeButtonProps {
  symbol: string;
  currentPrice: number | null;
  cashBalance: number;
  heldQuantity: number;
  backendUrl: string;
  token: string;
  onTradeComplete: () => void;
}

function fmtCurrency(v: number): string {
  return v.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

export default function TradeButton({
  symbol,
  currentPrice,
  cashBalance,
  heldQuantity,
  backendUrl,
  token,
  onTradeComplete,
}: TradeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = parseFloat(quantity) || 0;
  const totalCost = qty * (currentPrice ?? 0);
  const canBuy = currentPrice !== null && qty > 0 && totalCost <= cashBalance;
  const canSell = currentPrice !== null && qty > 0 && qty <= heldQuantity;

  async function handleTrade() {
    setError(null);
    setIsSubmitting(true);
    try {
      const resp = await fetch(
        `${backendUrl}/api/portfolio/paper/${mode}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ symbol, quantity: qty }),
        }
      );
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.detail || "Trade failed");
      }
      setIsOpen(false);
      setQuantity("");
      onTradeComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Trade failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (currentPrice === null) return null;

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMode("buy");
            setIsOpen(true);
            setError(null);
            setQuantity("");
          }}
          className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-500"
        >
          Simulate Buy
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("sell");
            setIsOpen(true);
            setError(null);
            setQuantity("");
          }}
          disabled={heldQuantity <= 0}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Simulate Sell
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {mode === "buy" ? "Buy" : "Sell"} {symbol}
              </h3>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-muted hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted">
                  Current Price
                </label>
                <p className="font-medium">{fmtCurrency(currentPrice)}</p>
              </div>

              <div>
                <label className="text-xs text-muted">Quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-white outline-none focus:border-primary"
                  placeholder={
                    mode === "sell"
                      ? `Max ${heldQuantity}`
                      : "Enter quantity"
                  }
                />
              </div>

              {qty > 0 && (
                <div className="rounded bg-background/50 p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">Total Cost</span>
                    <span className="font-medium">{fmtCurrency(totalCost)}</span>
                  </div>
                  {mode === "buy" && (
                    <div className="mt-1 flex justify-between">
                      <span className="text-muted">Cash After Trade</span>
                      <span
                        className={
                          cashBalance - totalCost < 0
                            ? "text-red-400"
                            : "text-green-400"
                        }
                      >
                        {fmtCurrency(cashBalance - totalCost)}
                      </span>
                    </div>
                  )}
                  {mode === "sell" && (
                    <div className="mt-1 flex justify-between">
                      <span className="text-muted">Remaining Holdings</span>
                      <span>{heldQuantity - qty}</span>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}

              <button
                type="button"
                onClick={handleTrade}
                disabled={
                  isSubmitting ||
                  (mode === "buy" ? !canBuy : !canSell)
                }
                className={`w-full rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  mode === "buy"
                    ? "bg-green-600 hover:bg-green-500"
                    : "bg-red-600 hover:bg-red-500"
                }`}
              >
                {isSubmitting
                  ? "Processing..."
                  : `Confirm ${mode === "buy" ? "Buy" : "Sell"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { useUserStore } from "@/store/userStore";
import { createClient } from "@/lib/supabase/client";
import type { InvestmentStyle } from "@/types";

const STYLES: {
  id: InvestmentStyle;
  name: string;
  description: string;
  example: string;
  icon: string;
}[] = [
  {
    id: "value",
    name: "Value Investor",
    description:
      "You look for undervalued stocks trading below their intrinsic worth. Patience and margin of safety are your edge.",
    example: "Prefers low PE, high ROE, strong balance sheets",
    icon: "📊",
  },
  {
    id: "growth",
    name: "Growth Investor",
    description:
      "You seek companies with strong earnings momentum and expanding market share, even if valuation is higher.",
    example: "Focuses on revenue growth, ROCE, and expanding margins",
    icon: "🚀",
  },
  {
    id: "dividend",
    name: "Dividend Investor",
    description:
      "You prefer steady income from established companies with a track record of consistent payouts.",
    example: "Prioritises dividend yield, low debt, stable cash flows",
    icon: "💰",
  },
];

export default function OnboardingPage() {
  const [selected, setSelected] = useState<InvestmentStyle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { completeOnboarding } = useUserStore();

  async function handleSubmit() {
    if (!selected) return;
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/auth/login";
        return;
      }

      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

      const resp = await fetch(`${backendUrl}/api/auth/onboarding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ investment_style: selected }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to save investment style");
      }

      completeOnboarding(selected);
      window.location.href = "/screener";
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong"
      );
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">
            Choose your investing style
          </h1>
          <p className="mt-2 text-sm text-muted">
            This personalises AI insights to match your approach. You can change
            this later.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              onClick={() => setSelected(style.id)}
              className={`flex flex-col items-start rounded-xl border p-5 text-left transition ${
                selected === style.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:border-muted/50"
              }`}
            >
              <span className="text-2xl">{style.icon}</span>
              <h2 className="mt-3 text-sm font-semibold text-white">
                {style.name}
              </h2>
              <p className="mt-1 text-xs text-muted">{style.description}</p>
              <p className="mt-3 text-[11px] text-primary">{style.example}</p>
            </button>
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-danger">{error}</p>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selected || loading}
            className="rounded-lg bg-primary px-8 py-2.5 text-sm font-medium text-white transition hover:bg-primary/80 disabled:opacity-50"
          >
            {loading ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

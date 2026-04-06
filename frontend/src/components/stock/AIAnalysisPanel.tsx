"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { getBackendUrl } from "@/lib/api";
import AnalysisSection from "./AnalysisSection";
import BullBearCase from "./BullBearCase";
import PeerComparison from "./PeerComparison";
import { Skeleton } from "@/components/ui/Skeleton";

interface AIAnalysisPanelProps {
  symbol: string;
}

interface AnalysisData {
  symbol: string;
  analysis_json: {
    overall_score: number;
    investment_thesis: string;
    sections: Record<string, {
      score: number;
      headline: string;
      findings: { finding: string; supporting_data: string; implication: string }[];
      vs_sector: string;
      bull: string;
      bear: string;
      watch_triggers: string[];
    }>;
    bull_case: { thesis: string; target_upside: string };
    bear_case: { thesis: string; target_downside: string };
    peer_comparison: { symbol: string; name: string; overall_score: number; vs_this: string }[];
  };
  overall_score: number;
  generated_at: string;
  score_1d_ago: number | null;
  score_7d_ago: number | null;
  score_30d_ago: number | null;
}

const SECTION_LABELS: Record<string, string> = {
  business_model_moat: "Business Model & Moat",
  financial_health: "Financial Health",
  profitability_growth: "Profitability & Growth",
  balance_sheet_quality: "Balance Sheet Quality",
  valuation_assessment: "Valuation Assessment",
  sector_macro_outlook: "Sector & Macro Outlook",
  key_investment_risks: "Key Investment Risks",
};

function scoreColor(score: number): string {
  if (score >= 71) return "text-accent";
  if (score >= 51) return "text-primary";
  if (score >= 31) return "text-yellow-500";
  return "text-danger";
}

function scoreBg(score: number): string {
  if (score >= 71) return "bg-accent/15 border-accent/30";
  if (score >= 51) return "bg-primary/15 border-primary/30";
  if (score >= 31) return "bg-yellow-500/15 border-yellow-500/30";
  return "bg-danger/15 border-danger/30";
}

function scoreLabel(score: number): string {
  if (score >= 86) return "Excellent";
  if (score >= 71) return "Good";
  if (score >= 51) return "Average";
  if (score >= 31) return "Below Avg";
  return "Poor";
}

function ScoreDelta({ label, prev, current }: { label: string; prev: number | null; current: number }) {
  if (prev == null) return null;
  const delta = current - prev;
  if (delta === 0) return null;
  return (
    <span className={clsx("text-[10px] font-medium", delta > 0 ? "text-accent" : "text-danger")}>
      {label}: {delta > 0 ? "+" : ""}{delta}
    </span>
  );
}

export default function AIAnalysisPanel({ symbol }: AIAnalysisPanelProps) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchAnalysis() {
      try {
        const res = await fetch(
          `${getBackendUrl()}/api/stocks/${encodeURIComponent(symbol)}/analysis`
        );
        if (!res.ok) {
          setError(true);
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalysis();
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) return null; // Silently hide when no analysis exists

  const { analysis_json: analysis, overall_score, generated_at, score_1d_ago, score_7d_ago, score_30d_ago } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white">AI Analysis</h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
          AI Generated
        </span>
      </div>

      {/* Hero Score Card */}
      <div className={clsx("rounded-xl border p-5", scoreBg(overall_score))}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className={clsx("text-4xl font-bold", scoreColor(overall_score))}>
                {overall_score}
              </div>
              <div className={clsx("text-xs font-medium", scoreColor(overall_score))}>
                {scoreLabel(overall_score)}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-foreground font-medium leading-snug">
                {analysis.investment_thesis}
              </p>
              <div className="flex gap-3">
                <ScoreDelta label="1d" prev={score_1d_ago} current={overall_score} />
                <ScoreDelta label="7d" prev={score_7d_ago} current={overall_score} />
                <ScoreDelta label="30d" prev={score_30d_ago} current={overall_score} />
              </div>
            </div>
          </div>
          <div className="text-[10px] text-muted shrink-0">
            {new Date(generated_at).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>

      {/* 7 Section Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(SECTION_LABELS).map(([key, label]) => {
          const section = analysis.sections?.[key];
          if (!section) return null;
          return <AnalysisSection key={key} title={label} data={section} />;
        })}
      </div>

      {/* Bull/Bear Cases */}
      <BullBearCase
        bullCase={analysis.bull_case}
        bearCase={analysis.bear_case}
        investmentThesis={analysis.investment_thesis}
      />

      {/* Peer Comparison */}
      <PeerComparison
        peers={analysis.peer_comparison ?? []}
        currentSymbol={symbol.toUpperCase()}
        currentScore={overall_score}
      />
    </div>
  );
}

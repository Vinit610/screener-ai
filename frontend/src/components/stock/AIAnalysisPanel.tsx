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

/* ── v4 JSON shape ── */

interface RiskItem {
  risk: string;
  evidence: string;
  impact: string;
  timeline: string;
  monitor: string;
}

interface SectionData {
  score: number;
  narrative?: string;
  // v4 optional sub-fields
  key_strengths?: string[];
  vulnerabilities?: string[];
  debt_analysis?: string;
  liquidity_assessment?: string;
  revenue_analysis?: string;
  margin_analysis?: string;
  cash_generation?: string;
  capital_allocation?: string;
  hidden_risks?: string;
  pe_analysis?: string;
  growth_adjusted?: string;
  asset_valuation?: string;
  yield_analysis?: string;
  tailwinds?: string[];
  headwinds?: string[];
  primary_risks?: RiskItem[];
  bull_case?: string;
  bear_case?: string;
  watch?: string[];
  // v3 legacy
  headline?: string;
  findings?: { finding: string; supporting_data: string; implication: string }[];
  vs_sector?: string;
  bull?: string;
  bear?: string;
  watch_triggers?: string[];
}

interface CatalystItem {
  catalyst?: string;
  event?: string;
  risk?: string;
  timeframe: string;
  impact_if_positive?: string;
  impact_if_negative?: string;
}

interface PeerItem {
  symbol: string;
  name: string;
  comparison?: string;
  metrics?: Record<string, string>;
  // v3 legacy
  overall_score?: number;
  vs_this?: string;
}

interface AnalysisData {
  symbol: string;
  analysis_json: {
    overall_score: number;
    executive_summary?: {
      one_liner: string;
      paragraph: string;
    };
    investment_thesis: string;
    sections: Record<string, SectionData>;
    // v4 shape
    bull_case_thesis?: {
      narrative: string;
      return_target: string;
      key_catalysts?: CatalystItem[];
    };
    bear_case_thesis?: {
      narrative: string;
      return_target: string;
      key_risks?: CatalystItem[];
    };
    catalysts?: CatalystItem[];
    peer_comparison?:
      | { narrative: string; peers: PeerItem[] }
      | PeerItem[];
    recommendation?: {
      action: string;
      qualifier: string;
      key_metrics_to_track: string[];
    };
    // v3 legacy
    bull_case?: { thesis: string; target_upside: string };
    bear_case?: { thesis: string; target_downside: string };
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
        if (!res.ok) { setError(true); return; }
        setData(await res.json());
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

  if (error || !data) return null;

  const { analysis_json: analysis, overall_score, generated_at } = data;

  // Normalize peer_comparison: v4 is object with narrative+peers, v3 is array
  const peerData = analysis.peer_comparison;
  const isV4Peers = peerData && !Array.isArray(peerData) && "narrative" in peerData;
  const v4Peers = isV4Peers
    ? (peerData as { narrative: string; peers: PeerItem[] })
    : null;
  const legacyPeers = Array.isArray(peerData) ? peerData : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">AI Analysis</h2>
          <span className={clsx(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
            scoreBg(overall_score), scoreColor(overall_score)
          )}>
            {overall_score} · {scoreLabel(overall_score)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {analysis.recommendation?.action && (
            <span className={clsx(
              "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              analysis.recommendation.action === "BUY" && "bg-accent/15 text-accent",
              analysis.recommendation.action === "HOLD" && "bg-yellow-500/15 text-yellow-500",
              (analysis.recommendation.action === "AVOID" || analysis.recommendation.action === "SELL") && "bg-danger/15 text-danger",
            )}>
              {analysis.recommendation.action}
            </span>
          )}
          <span className="text-[10px] text-muted shrink-0">
            {new Date(generated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>

      {/* Executive Summary */}
      {analysis.executive_summary && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
          <h3 className="text-xs font-semibold text-primary uppercase tracking-wider">Executive Summary</h3>
          {analysis.executive_summary.one_liner && (
            <p className="text-sm font-medium text-white">{analysis.executive_summary.one_liner}</p>
          )}
          <p className="text-xs text-muted leading-relaxed">{analysis.executive_summary.paragraph}</p>
        </div>
      )}

      {/* Investment Thesis */}
      {analysis.investment_thesis && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-2 text-xs font-semibold text-muted uppercase tracking-wider">Investment Thesis</h3>
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{analysis.investment_thesis}</p>
        </div>
      )}

      {/* Section Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(SECTION_LABELS).map(([key, label]) => {
          const section = analysis.sections?.[key];
          if (!section) return null;
          return <AnalysisSection key={key} sectionKey={key} title={label} data={section} />;
        })}
      </div>

      {/* Bull/Bear Cases */}
      <BullBearCase
        bullThesis={analysis.bull_case_thesis}
        bearThesis={analysis.bear_case_thesis}
        catalysts={analysis.catalysts}
        legacyBull={analysis.bull_case}
        legacyBear={analysis.bear_case}
      />

      {/* Peer Comparison */}
      {v4Peers && (
        <PeerComparison
          narrative={v4Peers.narrative}
          peers={v4Peers.peers}
          currentSymbol={symbol.toUpperCase()}
          currentScore={overall_score}
        />
      )}
      {legacyPeers && (
        <PeerComparison
          peers={legacyPeers.map(p => ({
            symbol: p.symbol,
            name: p.name,
            comparison: p.vs_this || "",
            metrics: {},
            overall_score: p.overall_score,
          }))}
          currentSymbol={symbol.toUpperCase()}
          currentScore={overall_score}
        />
      )}

      {/* Recommendation & Metrics to Track */}
      {analysis.recommendation && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Recommendation</h3>
            <span className={clsx(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              analysis.recommendation.action === "BUY" && "bg-accent/15 text-accent",
              analysis.recommendation.action === "HOLD" && "bg-yellow-500/15 text-yellow-500",
              (analysis.recommendation.action === "AVOID" || analysis.recommendation.action === "SELL") && "bg-danger/15 text-danger",
            )}>
              {analysis.recommendation.action}
            </span>
          </div>
          {analysis.recommendation.qualifier && (
            <p className="text-sm text-foreground leading-relaxed">{analysis.recommendation.qualifier}</p>
          )}
          {analysis.recommendation.key_metrics_to_track?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-muted uppercase">Key Metrics to Track</p>
              {analysis.recommendation.key_metrics_to_track.map((m, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                  <span className="text-primary mt-0.5">→</span>
                  <span>{m}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

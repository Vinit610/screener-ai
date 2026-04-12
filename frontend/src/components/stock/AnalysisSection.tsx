"use client";

import { useState } from "react";
import { clsx } from "clsx";

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

interface AnalysisSectionProps {
  sectionKey: string;
  title: string;
  data: SectionData;
}

function scoreColor(score: number): string {
  if (score >= 71) return "text-accent";
  if (score >= 51) return "text-primary";
  if (score >= 31) return "text-yellow-500";
  return "text-danger";
}

function scoreBg(score: number): string {
  if (score >= 71) return "bg-accent/15";
  if (score >= 51) return "bg-primary/15";
  if (score >= 31) return "bg-yellow-500/15";
  return "bg-danger/15";
}

function SubSection({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg bg-background p-3 space-y-1">
      <p className="text-[11px] font-semibold text-primary uppercase tracking-wide">{label}</p>
      <p className="text-xs text-foreground leading-relaxed">{text}</p>
    </div>
  );
}

const SECTION_SUBFIELDS: Record<string, { key: string; label: string }[]> = {
  business_model_moat: [],
  financial_health: [
    { key: "debt_analysis", label: "Debt Analysis" },
    { key: "liquidity_assessment", label: "Liquidity & Efficiency" },
  ],
  profitability_growth: [
    { key: "revenue_analysis", label: "Revenue Dynamics" },
    { key: "margin_analysis", label: "Profitability" },
    { key: "cash_generation", label: "Cash Generation" },
  ],
  balance_sheet_quality: [
    { key: "capital_allocation", label: "Capital Allocation" },
    { key: "hidden_risks", label: "Hidden Risks" },
  ],
  valuation_assessment: [
    { key: "pe_analysis", label: "P/E Analysis" },
    { key: "growth_adjusted", label: "Growth-Adjusted Valuation" },
    { key: "asset_valuation", label: "Asset-Based Valuation" },
    { key: "yield_analysis", label: "Yield & Income" },
  ],
  sector_macro_outlook: [],
  key_investment_risks: [],
};

export default function AnalysisSection({ sectionKey, title, data }: AnalysisSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const isV4 = !!data.narrative;
  const subfields = SECTION_SUBFIELDS[sectionKey] ?? [];
  const dataRecord = data as unknown as Record<string, unknown>;
  const hasDetails = subfields.some(sf => dataRecord[sf.key]);
  const bullText = data.bull_case || data.bull;
  const bearText = data.bear_case || data.bear;
  const watchItems = data.watch || data.watch_triggers || [];

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white leading-tight">{title}</h3>
        <span className={clsx(
          "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold",
          scoreBg(data.score), scoreColor(data.score)
        )}>
          {data.score}
        </span>
      </div>

      {/* Main Narrative (v4) or Headline + Findings (v3 legacy) */}
      {isV4 ? (
        <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{data.narrative}</p>
      ) : (
        <>
          {data.headline && <p className="text-xs text-muted leading-relaxed">{data.headline}</p>}
          {data.findings?.map((f, i) => (
            <div key={i} className="rounded-lg bg-background p-2.5 space-y-0.5">
              <p className="text-xs font-medium text-foreground">{f.finding}</p>
              <p className="text-[11px] text-primary">{f.supporting_data}</p>
              <p className="text-[11px] text-muted">{f.implication}</p>
            </div>
          ))}
          {data.vs_sector && (
            <p className="text-[11px] text-muted">
              <span className="font-medium text-primary">vs Sector:</span> {data.vs_sector}
            </p>
          )}
        </>
      )}

      {/* Strengths / Vulnerabilities (business_model_moat) */}
      {data.key_strengths && data.key_strengths.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-accent">Strengths</p>
          {data.key_strengths.map((s, i) => (
            <p key={i} className="text-xs text-foreground pl-2 border-l-2 border-accent/30">{s}</p>
          ))}
        </div>
      )}
      {data.vulnerabilities && data.vulnerabilities.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-danger">Vulnerabilities</p>
          {data.vulnerabilities.map((v, i) => (
            <p key={i} className="text-xs text-foreground pl-2 border-l-2 border-danger/30">{v}</p>
          ))}
        </div>
      )}

      {/* Tailwinds / Headwinds (sector_macro_outlook) */}
      {data.tailwinds && data.tailwinds.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-accent">Tailwinds</p>
          {data.tailwinds.map((t, i) => (
            <p key={i} className="text-xs text-foreground pl-2 border-l-2 border-accent/30">{t}</p>
          ))}
        </div>
      )}
      {data.headwinds && data.headwinds.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-danger">Headwinds</p>
          {data.headwinds.map((h, i) => (
            <p key={i} className="text-xs text-foreground pl-2 border-l-2 border-danger/30">{h}</p>
          ))}
        </div>
      )}

      {/* Primary Risks (key_investment_risks) */}
      {data.primary_risks && data.primary_risks.length > 0 && (
        <div className="space-y-2">
          {data.primary_risks.map((r, i) => (
            <div key={i} className="rounded-lg bg-danger/5 border border-danger/10 p-3 space-y-1">
              <p className="text-xs font-semibold text-danger">{r.risk}</p>
              <p className="text-[11px] text-foreground">{r.evidence}</p>
              <div className="flex gap-3 text-[10px] text-muted">
                <span>Impact: {r.impact}</span>
                <span>Timeline: {r.timeline}</span>
              </div>
              <p className="text-[10px] text-primary">Monitor: {r.monitor}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Detail Sub-sections */}
      {hasDetails && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-primary hover:underline"
          >
            {expanded ? "▾ Hide detailed analysis" : "▸ Show detailed analysis"}
          </button>
          {expanded && (
            <div className="space-y-2">
              {subfields.map(sf => {
                const text = dataRecord[sf.key] as string | undefined;
                if (!text) return null;
                return <SubSection key={sf.key} label={sf.label} text={text} />;
              })}
            </div>
          )}
        </>
      )}

      {/* Mini Bull/Bear */}
      {(bullText || bearText) && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {bullText && (
            <div className="rounded-lg bg-accent/5 p-2">
              <span className="font-medium text-accent">Bull: </span>
              <span className="text-muted">{bullText}</span>
            </div>
          )}
          {bearText && (
            <div className="rounded-lg bg-danger/5 p-2">
              <span className="font-medium text-danger">Bear: </span>
              <span className="text-muted">{bearText}</span>
            </div>
          )}
        </div>
      )}

      {/* Watch Triggers */}
      {watchItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {watchItems.map((t, i) => (
            <span key={i} className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-500">
              ⚡ {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

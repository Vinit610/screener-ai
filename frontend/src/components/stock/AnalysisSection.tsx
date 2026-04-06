"use client";

import { clsx } from "clsx";

interface Finding {
  finding: string;
  supporting_data: string;
  implication: string;
}

interface SectionData {
  score: number;
  headline: string;
  findings: Finding[];
  vs_sector: string;
  bull: string;
  bear: string;
  watch_triggers: string[];
}

interface AnalysisSectionProps {
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

export default function AnalysisSection({ title, data }: AnalysisSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white leading-tight">{title}</h3>
        <span
          className={clsx(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold",
            scoreBg(data.score),
            scoreColor(data.score)
          )}
        >
          {data.score}
        </span>
      </div>

      {/* Headline */}
      <p className="text-xs text-muted leading-relaxed">{data.headline}</p>

      {/* Findings */}
      <div className="space-y-2">
        {data.findings?.map((f, i) => (
          <div key={i} className="rounded-lg bg-background p-2.5 space-y-0.5">
            <p className="text-xs font-medium text-foreground">{f.finding}</p>
            <p className="text-[11px] text-primary">{f.supporting_data}</p>
            <p className="text-[11px] text-muted">{f.implication}</p>
          </div>
        ))}
      </div>

      {/* Vs Sector */}
      {data.vs_sector && (
        <p className="text-[11px] text-muted">
          <span className="font-medium text-primary">vs Sector:</span> {data.vs_sector}
        </p>
      )}

      {/* Mini Bull/Bear */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-accent/5 p-2">
          <span className="font-medium text-accent">Bull: </span>
          <span className="text-muted">{data.bull}</span>
        </div>
        <div className="rounded-lg bg-danger/5 p-2">
          <span className="font-medium text-danger">Bear: </span>
          <span className="text-muted">{data.bear}</span>
        </div>
      </div>

      {/* Watch Triggers */}
      {data.watch_triggers?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.watch_triggers.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-500"
            >
              ⚡ {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

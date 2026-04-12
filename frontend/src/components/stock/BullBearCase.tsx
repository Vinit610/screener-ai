"use client";

interface CatalystItem {
  catalyst?: string;
  event?: string;
  risk?: string;
  timeframe: string;
  impact_if_positive?: string;
  impact_if_negative?: string;
}

interface ThesisBlock {
  narrative: string;
  return_target: string;
  key_catalysts?: CatalystItem[];
  key_risks?: CatalystItem[];
}

interface BullBearProps {
  bullThesis?: ThesisBlock | null;
  bearThesis?: ThesisBlock | null;
  catalysts?: CatalystItem[] | null;
  // Legacy v3 support
  legacyBull?: { thesis: string; target_upside: string } | null;
  legacyBear?: { thesis: string; target_downside: string } | null;
}

export default function BullBearCase({ bullThesis, bearThesis, catalysts, legacyBull, legacyBear }: BullBearProps) {
  const hasBull = bullThesis || legacyBull;
  const hasBear = bearThesis || legacyBear;
  if (!hasBull && !hasBear) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Bull Case */}
        {(bullThesis || legacyBull) && (
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-accent text-lg">📈</span>
              <h3 className="text-sm font-semibold text-accent">Bull Case</h3>
              <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                {bullThesis?.return_target || legacyBull?.target_upside || ""}
              </span>
            </div>
            <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">
              {bullThesis?.narrative || legacyBull?.thesis}
            </p>
            {bullThesis?.key_catalysts && bullThesis.key_catalysts.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-accent/10">
                <p className="text-[10px] font-semibold text-accent uppercase">Catalysts</p>
                {bullThesis.key_catalysts.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="text-accent shrink-0">→</span>
                    <span className="text-foreground">{c.catalyst}</span>
                    <span className="text-muted ml-auto shrink-0">{c.timeframe}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bear Case */}
        {(bearThesis || legacyBear) && (
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-danger text-lg">📉</span>
              <h3 className="text-sm font-semibold text-danger">Bear Case</h3>
              <span className="ml-auto rounded-full bg-danger/15 px-2 py-0.5 text-xs font-bold text-danger">
                {bearThesis?.return_target || legacyBear?.target_downside || ""}
              </span>
            </div>
            <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">
              {bearThesis?.narrative || legacyBear?.thesis}
            </p>
            {bearThesis?.key_risks && bearThesis.key_risks.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-danger/10">
                <p className="text-[10px] font-semibold text-danger uppercase">Key Risks to Watch</p>
                {bearThesis.key_risks.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="text-danger shrink-0">⚠</span>
                    <span className="text-foreground">{r.risk}</span>
                    <span className="text-muted ml-auto shrink-0">{r.timeframe}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upcoming Catalysts */}
      {catalysts && catalysts.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Upcoming Catalysts (6-12 Months)</h3>
          <div className="space-y-2">
            {catalysts.map((c, i) => (
              <div key={i} className="rounded-lg bg-background p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">{c.event || c.catalyst}</p>
                  <span className="text-[10px] text-muted shrink-0">{c.timeframe}</span>
                </div>
                {c.impact_if_positive && (
                  <p className="text-[11px] text-accent">If positive: {c.impact_if_positive}</p>
                )}
                {c.impact_if_negative && (
                  <p className="text-[11px] text-danger">If negative: {c.impact_if_negative}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

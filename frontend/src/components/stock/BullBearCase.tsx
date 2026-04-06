"use client";

interface BullBearProps {
  bullCase: { thesis: string; target_upside: string } | null;
  bearCase: { thesis: string; target_downside: string } | null;
  investmentThesis?: string;
}

export default function BullBearCase({ bullCase, bearCase, investmentThesis }: BullBearProps) {
  return (
    <div className="space-y-3">
      {investmentThesis && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-1 text-xs font-semibold text-muted uppercase tracking-wider">Investment Thesis</h3>
          <p className="text-sm text-foreground leading-relaxed">{investmentThesis}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Bull Case */}
        {bullCase && (
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-accent text-lg">📈</span>
              <h3 className="text-sm font-semibold text-accent">Bull Case</h3>
              {bullCase.target_upside && (
                <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                  {bullCase.target_upside}
                </span>
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed">{bullCase.thesis}</p>
          </div>
        )}

        {/* Bear Case */}
        {bearCase && (
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-danger text-lg">📉</span>
              <h3 className="text-sm font-semibold text-danger">Bear Case</h3>
              {bearCase.target_downside && (
                <span className="ml-auto rounded-full bg-danger/15 px-2 py-0.5 text-xs font-bold text-danger">
                  {bearCase.target_downside}
                </span>
              )}
            </div>
            <p className="text-xs text-muted leading-relaxed">{bearCase.thesis}</p>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

interface QualityGateProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function QualityGate({ checked, onChange }: QualityGateProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-hover p-3">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-border accent-primary mt-1 flex-shrink-0"
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">
            ✨ Quality Gate
          </span>
          <span className="text-xs text-muted leading-relaxed">
            Show only fundamentally strong companies
          </span>
          <div className="text-xs text-muted/70 mt-1 flex flex-col gap-1">
            <span>• ROE &gt; 15%</span>
            <span>• ROCE &gt; 15%</span>
            <span>• D/E &lt; 2.0</span>
          </div>
        </div>
      </label>
    </div>
  );
}

"use client";

interface SemanticSelectorProps {
  label: string;
  description: string;
  buckets: {
    cheap: { min: number; max: number };
    fair: { min: number; max: number };
    expensive: { min: number; max: number };
  };
  value: "any" | "cheap" | "fair" | "expensive";
  onChange: (value: "any" | "cheap" | "fair" | "expensive") => void;
}

export default function SemanticSelector({
  label,
  description,
  buckets,
  value,
  onChange,
}: SemanticSelectorProps) {
  const bucketLabels = {
    cheap: `≤${buckets.cheap.max}`,
    fair: `${buckets.fair.min}-${buckets.fair.max}`,
    expensive: `>${buckets.expensive.min}`,
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-xs font-semibold text-foreground">{label}</h3>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onChange("any")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            value === "any"
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted hover:border-muted"
          }`}
        >
          Any
        </button>
        <button
          type="button"
          onClick={() => onChange("cheap")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            value === "cheap"
              ? "bg-secondary text-secondary-foreground"
              : "border border-border text-muted hover:border-muted"
          }`}
        >
          💚 Cheap {bucketLabels.cheap}
        </button>
        <button
          type="button"
          onClick={() => onChange("fair")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            value === "fair"
              ? "bg-blue-500/30 text-blue-400 border border-blue-500/50"
              : "border border-border text-muted hover:border-muted"
          }`}
        >
          😐 Fair {bucketLabels.fair}
        </button>
        <button
          type="button"
          onClick={() => onChange("expensive")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            value === "expensive"
              ? "bg-warning text-warning-foreground"
              : "border border-border text-muted hover:border-muted"
          }`}
        >
          🔴 Expensive {bucketLabels.expensive}
        </button>
      </div>
    </div>
  );
}

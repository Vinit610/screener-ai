"use client";

interface ComparisonMessageProps {
  symbolA: string;
  symbolB: string;
}

export default function ComparisonMessage({
  symbolA,
  symbolB,
}: ComparisonMessageProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-muted">
        Comparing{" "}
        <a
          href={`/stock/${symbolA}`}
          className="font-medium text-primary hover:underline"
        >
          {symbolA}
        </a>{" "}
        vs{" "}
        <a
          href={`/stock/${symbolB}`}
          className="font-medium text-primary hover:underline"
        >
          {symbolB}
        </a>
      </p>
      <a
        href={`/compare?mode=stocks&a=${symbolA}&b=${symbolB}`}
        className="mt-2 inline-block text-xs text-primary hover:underline"
      >
        View full comparison →
      </a>
    </div>
  );
}

"use client";

import { clsx } from "clsx";

interface MetricProps {
  label: string;
  value: string | number;
  color?: "default" | "green" | "red";
}

export default function Metric({ label, value, color = "default" }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span
        className={clsx(
          "text-sm font-semibold",
          color === "green" && "text-accent",
          color === "red" && "text-danger",
          color === "default" && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

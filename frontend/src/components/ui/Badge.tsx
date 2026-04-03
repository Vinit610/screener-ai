"use client";

import { clsx } from "clsx";

interface BadgeProps {
  label: string;
  variant: "sector" | "positive" | "negative" | "neutral";
}

const variantClasses: Record<BadgeProps["variant"], string> = {
  sector: "bg-primary/15 text-primary",
  positive: "bg-accent/15 text-accent",
  negative: "bg-danger/15 text-danger",
  neutral: "bg-muted/15 text-muted",
};

export default function Badge({ label, variant }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant]
      )}
    >
      {label}
    </span>
  );
}

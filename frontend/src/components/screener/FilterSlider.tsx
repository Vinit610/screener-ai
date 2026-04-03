"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FilterSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}

export default function FilterSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: FilterSliderProps) {
  const [localValue, setLocalValue] = useState<[number, number]>(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const debouncedOnChange = useCallback(
    (v: [number, number]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onChange(v), 300);
    },
    [onChange]
  );

  const handleMinChange = (raw: string) => {
    const n = Number(raw);
    if (isNaN(n)) return;
    const clamped = Math.min(Math.max(n, min), localValue[1]);
    const next: [number, number] = [clamped, localValue[1]];
    setLocalValue(next);
    debouncedOnChange(next);
  };

  const handleMaxChange = (raw: string) => {
    const n = Number(raw);
    if (isNaN(n)) return;
    const clamped = Math.max(Math.min(n, max), localValue[0]);
    const next: [number, number] = [localValue[0], clamped];
    setLocalValue(next);
    debouncedOnChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="text-xs text-muted tabular-nums">
          {localValue[0]} – {localValue[1]}
        </span>
      </div>

      {/* Min slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue[0]}
        onChange={(e) => handleMinChange(e.target.value)}
        className="w-full"
      />

      {/* Max slider */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue[1]}
        onChange={(e) => handleMaxChange(e.target.value)}
        className="w-full"
      />

      {/* Typed number inputs */}
      <div className="flex gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={localValue[0]}
          onChange={(e) => handleMinChange(e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={localValue[1]}
          onChange={(e) => handleMaxChange(e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
        />
      </div>
    </div>
  );
}

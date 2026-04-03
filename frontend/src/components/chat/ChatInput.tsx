"use client";

import { useState, useRef, useCallback } from "react";

interface ChatInputProps {
  onSend: (query: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

const MAX_CHARS = 500;

export default function ChatInput({ onSend, disabled, isLoading }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isLoading) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, isLoading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (newValue.length <= MAX_CHARS) {
      setValue(newValue);
    }
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <div className="border-t border-border bg-surface px-3 py-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about Indian stocks..."
          disabled={disabled || isLoading}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-white placeholder:text-muted focus:border-primary focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled || isLoading}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </span>
          ) : (
            "Send"
          )}
        </button>
      </div>
      {value.length > 0 && (
        <p className="mt-1 text-right text-[10px] text-muted">
          {value.length}/{MAX_CHARS}
        </p>
      )}
    </div>
  );
}

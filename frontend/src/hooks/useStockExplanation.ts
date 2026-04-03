"use client";

import { useState, useEffect, useRef } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export function useStockExplanation(symbol: string, enabled: boolean) {
  const [explanation, setExplanation] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !symbol) {
      setExplanation("");
      setIsStreaming(false);
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    let cancelled = false;

    async function fetchExplanation() {
      setIsStreaming(true);
      setExplanation("");
      setError(null);

      try {
        const response = await fetch(`${BACKEND_URL}/api/ai/explain-stock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.token) {
                  setExplanation((prev) => prev + data.token);
                }
              } catch {
                // skip malformed JSON chunks
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch explanation");
        }
      } finally {
        if (!cancelled) {
          setIsStreaming(false);
        }
      }
    }

    fetchExplanation();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [symbol, enabled]);

  return { explanation, isStreaming, error };
}

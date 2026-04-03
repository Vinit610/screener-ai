"use client";

import { useEffect, useState } from "react";
import SentimentBadge from "@/components/ui/SentimentBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { News } from "@/types";
import { BACKEND_URL } from "@/lib/api";

interface NewsFeedProps {
  symbol: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function NewsFeed({ symbol }: NewsFeedProps) {
  const [news, setNews] = useState<News[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchNews() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/stocks/${encodeURIComponent(symbol)}/news`
        );
        if (!res.ok) throw new Error(`Failed to fetch news: ${res.status}`);
        const data = await res.json();
        setNews(data.data ?? []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load news"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchNews();
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <Skeleton className="mb-2 h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-danger">
        {error}
      </div>
    );
  }

  if (news.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No recent news found for {symbol}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {news.map((article) => (
        <a
          key={article.id}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-border bg-surface p-4 transition hover:border-muted/50"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-white line-clamp-2">
                {article.headline}
              </h4>
              {article.summary && (
                <p className="mt-1 text-xs text-muted line-clamp-2">
                  {article.summary}
                </p>
              )}
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                {article.source && <span>{article.source}</span>}
                {article.published_at && (
                  <span>{formatDate(article.published_at)}</span>
                )}
              </div>
            </div>
            <SentimentBadge
              sentiment={article.sentiment}
              score={article.sentiment_score}
            />
          </div>
        </a>
      ))}
    </div>
  );
}

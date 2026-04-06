"use client";

import { clsx } from "clsx";

interface Peer {
  symbol: string;
  name: string;
  overall_score: number;
  vs_this: string;
}

interface PeerComparisonProps {
  peers: Peer[];
  currentSymbol: string;
  currentScore: number;
}

export default function PeerComparison({ peers, currentSymbol, currentScore }: PeerComparisonProps) {
  if (!peers?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-xs font-semibold text-muted uppercase tracking-wider">
        Peer Comparison
      </h3>
      <div className="space-y-2">
        {/* Current stock */}
        <div className="flex items-center gap-3 rounded-lg bg-primary/10 p-2.5">
          <span className="text-xs font-bold text-primary min-w-[60px]">{currentSymbol}</span>
          <div className="flex-1">
            <div className="h-1.5 rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${currentScore}%` }}
              />
            </div>
          </div>
          <span className="text-xs font-bold text-primary">{currentScore}</span>
        </div>

        {/* Peers */}
        {peers.map((peer) => {
          const delta = peer.overall_score - currentScore;
          const deltaColor = delta > 0 ? "text-danger" : delta < 0 ? "text-accent" : "text-muted";

          return (
            <div key={peer.symbol} className="flex items-center gap-3 rounded-lg bg-background p-2.5">
              <span className="text-xs font-medium text-foreground min-w-[60px]">{peer.symbol}</span>
              <div className="flex-1">
                <div className="h-1.5 rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-muted"
                    style={{ width: `${peer.overall_score}%` }}
                  />
                </div>
              </div>
              <span className="text-xs font-medium text-foreground">{peer.overall_score}</span>
              <span className={clsx("text-[10px] font-medium min-w-[40px] text-right", deltaColor)}>
                {delta > 0 ? "+" : ""}{delta}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

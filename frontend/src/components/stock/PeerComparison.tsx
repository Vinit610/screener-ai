"use client";

interface PeerItem {
  symbol: string;
  name: string;
  comparison?: string;
  metrics?: Record<string, string>;
  // Legacy
  overall_score?: number;
}

interface PeerComparisonProps {
  narrative?: string;
  peers: PeerItem[];
  currentSymbol: string;
  currentScore: number;
}

export default function PeerComparison({ narrative, peers, currentSymbol, currentScore }: PeerComparisonProps) {
  if (!peers?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
        Peer Comparison
      </h3>

      {/* Narrative */}
      {narrative && (
        <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{narrative}</p>
      )}

      {/* Peer Cards */}
      <div className="space-y-2">
        {peers.map((peer) => (
          <div key={peer.symbol} className="rounded-lg bg-background p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-primary">{peer.symbol}</span>
              <span className="text-[11px] text-muted">{peer.name}</span>
              {peer.overall_score != null && (
                <span className="ml-auto text-xs font-medium text-foreground">{peer.overall_score}</span>
              )}
            </div>
            {peer.comparison && (
              <p className="text-[11px] text-foreground leading-relaxed">{peer.comparison}</p>
            )}
            {peer.metrics && Object.keys(peer.metrics).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(peer.metrics).map(([key, val]) => (
                  val && val !== "N/A" ? (
                    <span key={key} className="text-[10px] text-muted bg-surface rounded px-1.5 py-0.5">
                      {key.replace(/_/g, " ").toUpperCase()}: <span className="text-foreground">{val}</span>
                    </span>
                  ) : null
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

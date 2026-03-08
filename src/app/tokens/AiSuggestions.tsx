"use client";

import { RefreshCw, Lightbulb, Sparkles, Plus } from "lucide-react";
import { RiskLevelBadge } from "@/components/shared/StatusBadge";
import type { TokenSuggestion } from "./types";
import { MARKET_CAP_LABELS } from "./types";

interface AiSuggestionsProps {
  aiEnabled: boolean | null;
  suggestions: TokenSuggestion[];
  suggestLoading: boolean;
  onSuggestTokens: () => void;
  onAdoptSuggestion: (s: TokenSuggestion) => void;
}

export function AiSuggestions({ aiEnabled, suggestions, suggestLoading, onSuggestTokens, onAdoptSuggestion }: AiSuggestionsProps) {
  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Lightbulb size={16} className="text-amber-400" />
              AI Token Discovery
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              AI analyses institutional demand, competitor coverage, and market trends to suggest tokens worth evaluating.
            </p>
          </div>
          {aiEnabled && (
            <button
              onClick={onSuggestTokens}
              disabled={suggestLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50"
            >
              {suggestLoading ? (
                <><RefreshCw size={14} className="animate-spin" /> Analysing market...</>
              ) : (
                <><Sparkles size={14} /> {suggestions.length > 0 ? "Re-run Discovery" : "Run AI Discovery"}</>
              )}
            </button>
          )}
          {aiEnabled === false && (
            <span className="text-xs text-muted-foreground">AI not configured</span>
          )}
        </div>

        {suggestions.length === 0 && !suggestLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <Lightbulb size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Click &quot;Run AI Discovery&quot; to find popular token/chain combos worth adding to your custody registry.</p>
            <p className="text-xs mt-1">The AI considers your current registry, client demand signals, and institutional market trends.</p>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={`${s.symbol}-${s.network}-${i}`} className="border border-border rounded-lg p-4 hover:bg-accent/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-foreground">{s.symbol}</span>
                      <span className="text-sm text-muted-foreground">{s.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-muted/50 rounded text-muted-foreground">{s.network}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        s.urgency === "high" ? "bg-red-500/10 text-red-400" :
                        s.urgency === "medium" ? "bg-amber-500/10 text-amber-400" :
                        "bg-blue-500/10 text-blue-400"
                      }`}>
                        {s.urgency} urgency
                      </span>
                      {s.marketCapTier && s.marketCapTier !== "unknown" && (
                        <span className="text-xs text-muted-foreground">{MARKET_CAP_LABELS[s.marketCapTier] || s.marketCapTier}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{s.rationale}</p>
                    {s.chains && s.chains.length > 1 && (
                      <div className="flex items-center gap-1 mt-2">
                        <span className="text-[10px] text-muted-foreground">Multi-chain:</span>
                        {s.chains.map((c) => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <RiskLevelBadge level={s.suggestedRiskLevel} />
                    <button
                      onClick={() => onAdoptSuggestion(s)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                      <Plus size={12} /> Add to Pipeline
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

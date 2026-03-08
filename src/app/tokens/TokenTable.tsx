"use client";

import { ChevronDown, ChevronRight, TrendingUp, Sparkles } from "lucide-react";
import { TokenStatusBadge, RiskLevelBadge } from "@/components/shared/StatusBadge";
import type { TokenEntry, Tab } from "./types";
import { MARKET_CAP_LABELS } from "./types";
import { TokenDetailPanel } from "./TokenDetailPanel";

interface TokenTableProps {
  tokens: TokenEntry[];
  tab: Tab;
  filter: string;
  expandedId: string | null;
  showSignalForm: string | null;
  researchResults: Record<string, Record<string, unknown>>;
  researchLoading: string | null;
  aiEnabled: boolean | null;
  showRegulatory: string | null;
  onSetExpandedId: (id: string | null) => void;
  onSetFilter: (filter: string) => void;
  onStatusChange: (tokenId: string, newStatus: string) => void;
  onToggleCheck: (tokenId: string, field: "sanctionsCheck" | "amlRiskAssessed", currentValue: boolean) => void;
  onUpdateVendor: (tokenId: string, vendor: string, status: string) => void;
  onAddSignal: (e: React.FormEvent<HTMLFormElement>, tokenId: string) => void;
  onSetShowSignalForm: (id: string | null) => void;
  onResearch: (token: TokenEntry) => void;
  onApplyResearch: (tokenId: string) => void;
  onSetShowRegulatory: (id: string | null) => void;
}

export function TokenTable({
  tokens,
  tab,
  filter,
  expandedId,
  showSignalForm,
  researchResults,
  researchLoading,
  aiEnabled,
  showRegulatory,
  onSetExpandedId,
  onSetFilter,
  onStatusChange,
  onToggleCheck,
  onUpdateVendor,
  onAddSignal,
  onSetShowSignalForm,
  onResearch,
  onApplyResearch,
  onSetShowRegulatory,
}: TokenTableProps) {
  const filteredTokens = tokens.filter((t) => {
    if (tab === "live") return t.status === "live";
    if (tab === "demand") return true;
    if (tab === "discover") return false;
    if (filter === "all") return t.status !== "live" && t.status !== "rejected";
    return t.status === filter;
  });

  if (tab === "demand") {
    filteredTokens.sort((a, b) => b.demandScore - a.demandScore);
  }

  return (
    <>
      {/* Pipeline filter pills */}
      {tab === "pipeline" && (
        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "All" },
            { key: "proposed", label: "Proposed" },
            { key: "under_review", label: "Under Review" },
            { key: "compliance_review", label: "Compliance" },
            { key: "approved", label: "Approved" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => onSetFilter(f.key)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Token list */}
      {tab !== "discover" && (
        <div className="space-y-2">
          {filteredTokens.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {tab === "live" ? "No tokens live yet." : tab === "demand" ? "No tokens tracked." : "No tokens in this pipeline stage."}
            </div>
          ) : (
            filteredTokens.map((token) => {
              const expanded = expandedId === token.id;
              const hasPersistedResearch = !!token.aiResearchResult && Object.keys(token.aiResearchResult).length > 0;
              return (
                <div key={token.id} className="bg-card rounded-xl border border-border overflow-hidden">
                  {/* Row header */}
                  <button
                    onClick={() => onSetExpandedId(expanded ? null : token.id)}
                    className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors"
                  >
                    {expanded ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
                    <div className="w-16 text-center">
                      <span className="text-sm font-bold text-foreground">{token.symbol}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{token.name}</p>
                      <p className="text-xs text-muted-foreground">{token.network || token.tokenType} {token.contractAddress ? `\u00B7 ${token.contractAddress.substring(0, 10)}...` : ""}</p>
                    </div>
                    {tab === "demand" && (
                      <div className="flex items-center gap-2 shrink-0">
                        <TrendingUp size={14} className={token.demandScore >= 50 ? "text-emerald-400" : "text-muted-foreground"} />
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${token.demandScore >= 70 ? "bg-emerald-500" : token.demandScore >= 40 ? "bg-amber-500" : "bg-muted-foreground"}`} style={{ width: `${Math.min(token.demandScore, 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-6">{token.demandScore}</span>
                      </div>
                    )}
                    {/* Vendor support mini-badges */}
                    <div className="hidden lg:flex items-center gap-1 shrink-0">
                      {(["fireblocksSupport", "ledgerSupport", "chainalysisSupport", "notabeneSupport"] as const).map((v) => {
                        const val = token[v];
                        const label = v.replace("Support", "").charAt(0).toUpperCase();
                        const color = val === "supported" ? "bg-emerald-500" : val === "partial" ? "bg-amber-500" : val === "not_supported" ? "bg-red-500" : "bg-muted-foreground/30";
                        return <div key={v} title={`${v.replace("Support", "")}: ${val}`} className={`w-2 h-2 rounded-full ${color}`}><span className="sr-only">{label}</span></div>;
                      })}
                    </div>
                    {hasPersistedResearch && (
                      <span title={`AI researched ${token.aiResearchedAt ? new Date(token.aiResearchedAt).toLocaleDateString() : ""}`} className="shrink-0">
                        <Sparkles size={14} className="text-primary" />
                      </span>
                    )}
                    <div className="flex items-center gap-2 shrink-0">
                      <TokenStatusBadge status={token.status} />
                      <RiskLevelBadge level={token.riskLevel} />
                    </div>
                    {token.marketCapTier !== "unknown" && (
                      <span className="text-xs text-muted-foreground shrink-0">{MARKET_CAP_LABELS[token.marketCapTier]}</span>
                    )}
                  </button>

                  {/* Expanded detail */}
                  {expanded && (
                    <TokenDetailPanel
                      token={token}
                      showSignalForm={showSignalForm}
                      researchResults={researchResults}
                      researchLoading={researchLoading}
                      aiEnabled={aiEnabled}
                      showRegulatory={showRegulatory}
                      onStatusChange={onStatusChange}
                      onToggleCheck={onToggleCheck}
                      onUpdateVendor={onUpdateVendor}
                      onAddSignal={onAddSignal}
                      onSetShowSignalForm={onSetShowSignalForm}
                      onResearch={onResearch}
                      onApplyResearch={onApplyResearch}
                      onSetShowRegulatory={onSetShowRegulatory}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

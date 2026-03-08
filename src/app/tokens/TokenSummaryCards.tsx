"use client";

import type { TokenSummary } from "./types";

interface TokenSummaryCardsProps {
  summary: TokenSummary;
}

export function TokenSummaryCards({ summary }: TokenSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">In Pipeline</p>
        <p className="text-2xl font-bold text-foreground">{summary.proposed + summary.underReview + summary.complianceReview}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {summary.proposed > 0 && <span className="text-blue-400">{summary.proposed} proposed</span>}
          {summary.underReview > 0 && <span className="text-indigo-400 ml-2">{summary.underReview} reviewing</span>}
        </p>
      </div>
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">Compliance Review</p>
        <p className={`text-2xl font-bold ${summary.complianceReview > 0 ? "text-amber-400" : "text-foreground"}`}>{summary.complianceReview}</p>
        <p className="text-xs text-muted-foreground mt-1">awaiting compliance sign-off</p>
      </div>
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">Live Tokens</p>
        <p className="text-2xl font-bold text-purple-400">{summary.live}</p>
        <p className="text-xs text-muted-foreground mt-1">supported in custody</p>
      </div>
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-xs text-muted-foreground">High Risk</p>
        <p className={`text-2xl font-bold ${summary.highRisk > 0 ? "text-red-400" : "text-foreground"}`}>{summary.highRisk}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {summary.rejected > 0 && <span className="text-red-400">{summary.rejected} rejected</span>}
        </p>
      </div>
    </div>
  );
}

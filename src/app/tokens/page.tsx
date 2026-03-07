"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Coins, Plus, X, ChevronDown, ChevronRight, TrendingUp, Shield, ArrowRight } from "lucide-react";
import { TokenStatusBadge, RiskLevelBadge } from "@/components/shared/StatusBadge";

interface DemandSignal {
  id: string;
  signalType: string;
  source: string;
  description: string;
  weight: number;
  createdAt: string;
}

interface TokenEntry {
  id: string;
  symbol: string;
  name: string;
  network: string;
  contractAddress: string;
  tokenType: string;
  status: string;
  proposedById: string | null;
  proposedAt: string;
  reviewedAt: string | null;
  complianceAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  liveAt: string | null;
  rejectionReason: string;
  riskLevel: string;
  riskNotes: string;
  regulatoryNotes: string;
  sanctionsCheck: boolean;
  amlRiskAssessed: boolean;
  custodianSupport: string[];
  stakingAvailable: boolean;
  demandScore: number;
  demandSignals: DemandSignal[];
  marketCapTier: string;
  notes: string;
  createdAt: string;
}

interface TokenData {
  tokens: TokenEntry[];
  summary: {
    total: number;
    proposed: number;
    underReview: number;
    complianceReview: number;
    approved: number;
    rejected: number;
    live: number;
    highRisk: number;
  };
}

type Tab = "pipeline" | "live" | "demand";

const STATUS_FLOW = ["proposed", "under_review", "compliance_review", "approved", "live"];

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  client_request: "Client Request",
  market_trend: "Market Trend",
  competitor_listed: "Competitor Listed",
  internal_proposal: "Internal Proposal",
};

const MARKET_CAP_LABELS: Record<string, string> = {
  mega: "Mega Cap",
  large: "Large Cap",
  mid: "Mid Cap",
  small: "Small Cap",
  micro: "Micro Cap",
  unknown: "Unknown",
};

export default function TokenReviewPage() {
  const [data, setData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [showForm, setShowForm] = useState(false);
  const [showSignalForm, setShowSignalForm] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/tokens");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* */ } finally { setLoading(false); }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        symbol: form.get("symbol"),
        name: form.get("name"),
        network: form.get("network"),
        tokenType: form.get("tokenType"),
        riskLevel: form.get("riskLevel"),
        marketCapTier: form.get("marketCapTier"),
        notes: form.get("notes"),
      }),
    });
    setShowForm(false);
    fetchData();
  }

  async function handleStatusChange(tokenId: string, newStatus: string) {
    let reason = "";
    if (newStatus === "rejected") {
      reason = prompt("Rejection reason:") || "";
      if (!reason) return;
    }
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_status", tokenId, newStatus, reason }),
    });
    fetchData();
  }

  async function handleAddSignal(e: React.FormEvent<HTMLFormElement>, tokenId: string) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_signal",
        tokenId,
        signalType: form.get("signalType"),
        source: form.get("source"),
        description: form.get("description"),
        weight: parseInt(form.get("weight") as string) || 1,
      }),
    });
    setShowSignalForm(null);
    fetchData();
  }

  async function handleToggleCheck(tokenId: string, field: "sanctionsCheck" | "amlRiskAssessed", currentValue: boolean) {
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", tokenId, [field]: !currentValue }),
    });
    fetchData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw size={24} className="animate-spin mr-3" />
        Loading token registry...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <AlertTriangle size={24} className="mx-auto mb-3 text-red-400" />
        <p className="text-muted-foreground">Failed to load token data.</p>
        <button onClick={fetchData} className="mt-3 text-sm text-primary hover:underline">Retry</button>
      </div>
    );
  }

  const filteredTokens = data.tokens.filter((t) => {
    if (tab === "live") return t.status === "live";
    if (tab === "demand") return true; // show all, sorted by demand
    // pipeline tab
    if (filter === "all") return t.status !== "live" && t.status !== "rejected";
    return t.status === filter;
  });

  if (tab === "demand") {
    filteredTokens.sort((a, b) => b.demandScore - a.demandScore);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "pipeline", label: "Review Pipeline" },
    { key: "live", label: `Live (${data.summary.live})` },
    { key: "demand", label: "Demand Tracker" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Coins size={24} className="text-primary" />
            Token Review
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Custody token onboarding pipeline & institutional demand tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            <Plus size={16} /> Propose Token
          </button>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">In Pipeline</p>
          <p className="text-2xl font-bold text-foreground">{data.summary.proposed + data.summary.underReview + data.summary.complianceReview}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.summary.proposed > 0 && <span className="text-blue-400">{data.summary.proposed} proposed</span>}
            {data.summary.underReview > 0 && <span className="text-indigo-400 ml-2">{data.summary.underReview} reviewing</span>}
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Compliance Review</p>
          <p className={`text-2xl font-bold ${data.summary.complianceReview > 0 ? "text-amber-400" : "text-foreground"}`}>{data.summary.complianceReview}</p>
          <p className="text-xs text-muted-foreground mt-1">awaiting compliance sign-off</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Live Tokens</p>
          <p className="text-2xl font-bold text-purple-400">{data.summary.live}</p>
          <p className="text-xs text-muted-foreground mt-1">supported in custody</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">High Risk</p>
          <p className={`text-2xl font-bold ${data.summary.highRisk > 0 ? "text-red-400" : "text-foreground"}`}>{data.summary.highRisk}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.summary.rejected > 0 && <span className="text-red-400">{data.summary.rejected} rejected</span>}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Token list */}
      <div className="space-y-2">
        {filteredTokens.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {tab === "live" ? "No tokens live yet." : tab === "demand" ? "No tokens tracked." : "No tokens in this pipeline stage."}
          </div>
        ) : (
          filteredTokens.map((token) => {
            const expanded = expandedId === token.id;
            return (
              <div key={token.id} className="bg-card rounded-xl border border-border overflow-hidden">
                {/* Row header */}
                <button
                  onClick={() => setExpandedId(expanded ? null : token.id)}
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-accent/30 transition-colors"
                >
                  {expanded ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
                  <div className="w-16 text-center">
                    <span className="text-sm font-bold text-foreground">{token.symbol}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{token.name}</p>
                    <p className="text-xs text-muted-foreground">{token.network || token.tokenType} {token.contractAddress ? `· ${token.contractAddress.substring(0, 10)}...` : ""}</p>
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
                  <div className="border-t border-border p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left: Details & Compliance */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Token Details</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{token.tokenType}</span></div>
                          <div><span className="text-muted-foreground">Market Cap:</span> <span className="text-foreground">{MARKET_CAP_LABELS[token.marketCapTier]}</span></div>
                          <div><span className="text-muted-foreground">Staking:</span> <span className={token.stakingAvailable ? "text-emerald-400" : "text-muted-foreground"}>{token.stakingAvailable ? "Available" : "N/A"}</span></div>
                          <div><span className="text-muted-foreground">Custodians:</span> <span className="text-foreground">{token.custodianSupport.length > 0 ? token.custodianSupport.join(", ") : "None"}</span></div>
                        </div>

                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Shield size={12} /> Compliance</h4>
                        <div className="flex items-center gap-4 text-xs">
                          <button
                            onClick={() => handleToggleCheck(token.id, "sanctionsCheck", token.sanctionsCheck)}
                            className={`flex items-center gap-1 px-2 py-1 rounded ${token.sanctionsCheck ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}
                          >
                            {token.sanctionsCheck ? "Sanctions OK" : "Sanctions Pending"}
                          </button>
                          <button
                            onClick={() => handleToggleCheck(token.id, "amlRiskAssessed", token.amlRiskAssessed)}
                            className={`flex items-center gap-1 px-2 py-1 rounded ${token.amlRiskAssessed ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}
                          >
                            {token.amlRiskAssessed ? "AML Assessed" : "AML Pending"}
                          </button>
                        </div>
                        {token.riskNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Risk notes:</span> {token.riskNotes}</p>}
                        {token.regulatoryNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Regulatory:</span> {token.regulatoryNotes}</p>}
                        {token.notes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Notes:</span> {token.notes}</p>}
                        {token.rejectionReason && <p className="text-xs text-red-400"><span className="font-medium">Rejected:</span> {token.rejectionReason}</p>}
                      </div>

                      {/* Right: Pipeline + Demand */}
                      <div className="space-y-3">
                        {/* Pipeline progress */}
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pipeline Progress</h4>
                        <div className="flex items-center gap-1">
                          {STATUS_FLOW.map((s, i) => {
                            const idx = STATUS_FLOW.indexOf(token.status);
                            const reached = token.status === "rejected" ? false : i <= idx;
                            return (
                              <div key={s} className="flex items-center gap-1 flex-1">
                                <div className={`h-1.5 flex-1 rounded-full ${reached ? "bg-primary" : "bg-muted"}`} />
                                {i < STATUS_FLOW.length - 1 && <ArrowRight size={10} className="text-muted-foreground shrink-0" />}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          {STATUS_FLOW.map((s) => (
                            <span key={s} className="flex-1 text-center">{s.replace(/_/g, " ")}</span>
                          ))}
                        </div>

                        {/* Actions */}
                        {token.status !== "live" && token.status !== "rejected" && (
                          <div className="flex flex-wrap gap-2">
                            {token.status === "proposed" && (
                              <button onClick={() => handleStatusChange(token.id, "under_review")} className="px-3 py-1 text-xs bg-indigo-500/10 text-indigo-400 rounded hover:bg-indigo-500/20">Start Review</button>
                            )}
                            {token.status === "under_review" && (
                              <button onClick={() => handleStatusChange(token.id, "compliance_review")} className="px-3 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Send to Compliance</button>
                            )}
                            {token.status === "compliance_review" && (
                              <button onClick={() => handleStatusChange(token.id, "approved")} className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">Approve</button>
                            )}
                            {token.status === "approved" && (
                              <button onClick={() => handleStatusChange(token.id, "live")} className="px-3 py-1 text-xs bg-purple-500/10 text-purple-400 rounded hover:bg-purple-500/20">Mark Live</button>
                            )}
                            <button onClick={() => handleStatusChange(token.id, "rejected")} className="px-3 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20">Reject</button>
                          </div>
                        )}

                        {/* Demand signals */}
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                          <TrendingUp size={12} /> Demand Signals ({token.demandSignals.length})
                        </h4>
                        {token.demandSignals.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No demand signals recorded.</p>
                        ) : (
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {token.demandSignals.map((s) => (
                              <div key={s.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted/30 rounded">
                                <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">{SIGNAL_TYPE_LABELS[s.signalType] || s.signalType}</span>
                                <span className="flex-1 text-foreground truncate">{s.source}{s.description ? `: ${s.description}` : ""}</span>
                                <span className="text-muted-foreground">w:{s.weight}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => setShowSignalForm(showSignalForm === token.id ? null : token.id)}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <Plus size={12} /> Add Signal
                        </button>

                        {/* Add signal inline form */}
                        {showSignalForm === token.id && (
                          <form onSubmit={(e) => handleAddSignal(e, token.id)} className="space-y-2 p-2 bg-muted/30 rounded">
                            <select name="signalType" required className="w-full p-1.5 text-xs bg-background border border-border rounded">
                              <option value="client_request">Client Request</option>
                              <option value="market_trend">Market Trend</option>
                              <option value="competitor_listed">Competitor Listed</option>
                              <option value="internal_proposal">Internal Proposal</option>
                            </select>
                            <input name="source" placeholder="Source (e.g. client name)" className="w-full p-1.5 text-xs bg-background border border-border rounded" />
                            <input name="description" placeholder="Description" className="w-full p-1.5 text-xs bg-background border border-border rounded" />
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-muted-foreground">Weight (1-5):</label>
                              <input name="weight" type="number" min="1" max="5" defaultValue="1" className="w-16 p-1.5 text-xs bg-background border border-border rounded" />
                            </div>
                            <div className="flex gap-2">
                              <button type="submit" className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">Add</button>
                              <button type="button" onClick={() => setShowSignalForm(null)} className="px-3 py-1 text-xs text-muted-foreground">Cancel</button>
                            </div>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Propose token modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Propose New Token</h3>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Symbol *</label>
                  <input name="symbol" required placeholder="e.g. SOL" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Name *</label>
                  <input name="name" required placeholder="e.g. Solana" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Network</label>
                  <input name="network" placeholder="e.g. Solana, Ethereum" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Token Type</label>
                  <select name="tokenType" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                    <option value="native">Native</option>
                    <option value="erc20">ERC-20</option>
                    <option value="spl">SPL</option>
                    <option value="substrate">Substrate</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Risk Level</label>
                  <select name="riskLevel" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Market Cap Tier</label>
                  <select name="marketCapTier" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                    <option value="mega">Mega Cap</option>
                    <option value="large">Large Cap</option>
                    <option value="mid">Mid Cap</option>
                    <option value="small">Small Cap</option>
                    <option value="micro">Micro Cap</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Notes</label>
                <textarea name="notes" rows={2} placeholder="Why should we support this token?" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Propose Token</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Coins, Plus, X, ChevronDown, ChevronRight, TrendingUp, Shield, ArrowRight, Sparkles, CheckCircle2, XCircle, AlertCircle, HelpCircle, Lightbulb, Clock, Globe, ExternalLink } from "lucide-react";
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
  chainalysisSupport: string;
  notabeneSupport: string;
  fireblocksSupport: string;
  ledgerSupport: string;
  vendorNotes: Record<string, string>;
  aiResearchResult: Record<string, unknown> | null;
  aiResearchedAt: string | null;
  aiRecommendation: string;
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

interface TokenSuggestion {
  symbol: string;
  name: string;
  network: string;
  tokenType: string;
  marketCapTier: string;
  rationale: string;
  urgency: string;
  suggestedRiskLevel: string;
  chains: string[];
}

type Tab = "pipeline" | "live" | "demand" | "discover";

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

const VENDOR_STATUS_COLORS: Record<string, string> = {
  supported: "text-emerald-400 bg-emerald-500/10",
  partial: "text-amber-400 bg-amber-500/10",
  not_supported: "text-red-400 bg-red-500/10",
  unknown: "text-muted-foreground bg-muted/30",
};

const VENDOR_STATUS_LABELS: Record<string, string> = {
  supported: "Supported",
  partial: "Partial",
  not_supported: "Not Supported",
  unknown: "Unknown",
};

const JURISDICTION_LABELS: Record<string, string> = {
  US: "US (SEC/CFTC)",
  EU: "EU (MiCA)",
  UK: "UK (FCA)",
  Switzerland: "Switzerland (FINMA)",
  Singapore: "Singapore (MAS)",
  Japan: "Japan (JFSA)",
  UAE: "UAE (VARA/ADGM)",
  Hong_Kong: "Hong Kong (SFC)",
};

export default function TokenReviewPage() {
  const [data, setData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [showForm, setShowForm] = useState(false);
  const [showSignalForm, setShowSignalForm] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [researchResults, setResearchResults] = useState<Record<string, Record<string, unknown>>>({});
  const [researchLoading, setResearchLoading] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<TokenSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showRegulatory, setShowRegulatory] = useState<string | null>(null);

  useEffect(() => { fetchData(); checkAi(); }, []);

  // Load persisted research into local state when data loads
  useEffect(() => {
    if (!data) return;
    const persisted: Record<string, Record<string, unknown>> = {};
    for (const t of data.tokens) {
      if (t.aiResearchResult && Object.keys(t.aiResearchResult).length > 0) {
        persisted[t.id] = t.aiResearchResult;
      }
    }
    setResearchResults((prev) => ({ ...persisted, ...prev }));
  }, [data]);

  async function checkAi() {
    try {
      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const json = await res.json();
      if (json.success) setAiEnabled(json.data.enabled);
    } catch { /* */ }
  }

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || `Request failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — check your connection");
    } finally { setLoading(false); }
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

  async function handleResearch(token: TokenEntry) {
    setResearchLoading(token.id);
    try {
      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "research_token",
          data: {
            symbol: token.symbol,
            name: token.name,
            network: token.network,
            tokenType: token.tokenType,
            contractAddress: token.contractAddress,
            marketCapTier: token.marketCapTier,
            existingNotes: token.notes,
            demandSignals: token.demandSignals.map((s) => ({
              signalType: s.signalType,
              source: s.source,
              description: s.description,
            })),
          },
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.suggestion) {
        const result = json.data.suggestion as Record<string, unknown>;
        setResearchResults((prev) => ({ ...prev, [token.id]: result }));

        // Persist research to DB
        const recKey = typeof result.recommendation === "string"
          ? result.recommendation.toLowerCase().replace(/\s+/g, "_")
          : "";
        await fetch("/api/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_research",
            tokenId: token.id,
            researchResult: result,
            recommendation: recKey,
          }),
        });
        fetchData();
      }
    } catch { /* */ } finally {
      setResearchLoading(null);
    }
  }

  async function handleApplyResearch(tokenId: string) {
    const research = researchResults[tokenId];
    if (!research) return;

    const updateData: Record<string, unknown> = { action: "update", tokenId };

    if (research.riskAssessment && typeof research.riskAssessment === "object") {
      const ra = research.riskAssessment as Record<string, unknown>;
      if (typeof ra === "string") {
        updateData.riskLevel = ra;
      }
    }
    if (typeof research.riskAssessment === "string") {
      const level = research.riskAssessment.toLowerCase();
      if (["low", "medium", "high", "critical"].includes(level)) {
        updateData.riskLevel = level;
      }
    }

    const noteParts: string[] = [];
    if (research.summary) noteParts.push(`AI Summary: ${research.summary}`);
    if (research.custodyFeasibility) noteParts.push(`Custody: ${research.custodyFeasibility}`);
    if (research.stakingInfo && research.stakingInfo !== "Not applicable") noteParts.push(`Staking: ${research.stakingInfo}`);
    if (noteParts.length > 0) updateData.notes = noteParts.join("\n\n");

    if (research.riskAssessment && typeof research.riskAssessment === "object") {
      const ra = research.riskAssessment as Record<string, unknown>;
      if (ra.reasoning || ra.details) updateData.riskNotes = String(ra.reasoning || ra.details || "");
    }
    if (research.regulatoryConsiderations) {
      const rc = research.regulatoryConsiderations;
      if (typeof rc === "object" && rc !== null) {
        const rcObj = rc as Record<string, unknown>;
        updateData.regulatoryNotes = rcObj.overall ? String(rcObj.overall) : JSON.stringify(rc);
      } else {
        updateData.regulatoryNotes = String(rc);
      }
    }

    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updateData),
    });
    fetchData();
  }

  async function handleUpdateVendor(tokenId: string, vendor: string, status: string) {
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", tokenId, [vendor]: status }),
    });
    fetchData();
  }

  async function handleSuggestTokens() {
    if (!data) return;
    setSuggestLoading(true);
    try {
      const existingTokens = data.tokens.map((t) => ({
        symbol: t.symbol,
        network: t.network,
        status: t.status,
      }));
      const clientDemandSignals = data.tokens
        .flatMap((t) => t.demandSignals.filter((s) => s.signalType === "client_request"))
        .map((s) => ({ source: s.source, description: s.description }));

      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest_tokens",
          data: { existingTokens, clientDemandSignals },
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.suggestion) {
        setSuggestions(json.data.suggestion as TokenSuggestion[]);
      }
    } catch { /* */ } finally {
      setSuggestLoading(false);
    }
  }

  async function handleAdoptSuggestion(s: TokenSuggestion) {
    await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        symbol: s.symbol,
        name: s.name,
        network: s.network,
        tokenType: s.tokenType,
        riskLevel: s.suggestedRiskLevel || "medium",
        marketCapTier: s.marketCapTier || "unknown",
        notes: `AI Suggested: ${s.rationale}`,
      }),
    });
    setSuggestions((prev) => prev.filter((x) => x.symbol !== s.symbol || x.network !== s.network));
    fetchData();
  }

  function renderVendorBadge(status: string) {
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${VENDOR_STATUS_COLORS[status] || VENDOR_STATUS_COLORS.unknown}`}>
        {VENDOR_STATUS_LABELS[status] || status}
      </span>
    );
  }

  function renderRegulatoryBreakdown(regulatoryConsiderations: unknown) {
    if (!regulatoryConsiderations || typeof regulatoryConsiderations !== "object") {
      return <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(regulatoryConsiderations)}</p>;
    }
    const rc = regulatoryConsiderations as Record<string, unknown>;
    const jurisdictions = rc.jurisdictions as Record<string, string> | undefined;

    return (
      <div className="space-y-2">
        {!!rc.overall && <p className="text-xs text-foreground font-medium">{String(rc.overall)}</p>}
        {jurisdictions && (
          <div className="grid grid-cols-1 gap-1.5">
            {Object.entries(jurisdictions).map(([key, analysis]) => (
              <div key={key} className="flex gap-2 text-xs p-1.5 bg-background/50 rounded">
                <span className="text-primary font-medium shrink-0 w-28 flex items-center gap-1">
                  <Globe size={10} />
                  {JURISDICTION_LABELS[key] || key}
                </span>
                <span className="text-muted-foreground">{String(analysis)}</span>
              </div>
            ))}
          </div>
        )}
        {!!rc.sanctionsExposure && (
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Sanctions:</span> {String(rc.sanctionsExposure)}</p>
        )}
        {Array.isArray(rc.keyRisks) && rc.keyRisks.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {rc.keyRisks.map((r: string, i: number) => (
              <span key={i} className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-400 rounded">{r}</span>
            ))}
          </div>
        )}
      </div>
    );
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
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        <button onClick={fetchData} className="mt-3 text-sm text-primary hover:underline">Retry</button>
      </div>
    );
  }

  const filteredTokens = data.tokens.filter((t) => {
    if (tab === "live") return t.status === "live";
    if (tab === "demand") return true;
    if (tab === "discover") return false; // discover tab has its own content
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
    { key: "discover", label: "Discover" },
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
            {t.key === "discover" && <Lightbulb size={14} className="inline mr-1.5 -mt-0.5" />}
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ Discover Tab ═══ */}
      {tab === "discover" && (
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
                  onClick={handleSuggestTokens}
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
                          onClick={() => handleAdoptSuggestion(s)}
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
      )}

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
                    onClick={() => setExpandedId(expanded ? null : token.id)}
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

                          {/* Third-Party Vendor Support */}
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <ExternalLink size={12} /> Third-Party Support
                          </h4>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {([
                              { key: "fireblocksSupport" as const, label: "Fireblocks" },
                              { key: "ledgerSupport" as const, label: "Ledger" },
                              { key: "chainalysisSupport" as const, label: "Chainalysis" },
                              { key: "notabeneSupport" as const, label: "Notabene" },
                            ]).map(({ key, label }) => (
                              <div key={key} className="flex items-center justify-between p-1.5 bg-muted/20 rounded">
                                <span className="text-muted-foreground">{label}</span>
                                <select
                                  value={token[key]}
                                  onChange={(e) => handleUpdateVendor(token.id, key, e.target.value)}
                                  className="text-[10px] bg-transparent border-none outline-none cursor-pointer"
                                >
                                  <option value="supported">Supported</option>
                                  <option value="partial">Partial</option>
                                  <option value="not_supported">Not Supported</option>
                                  <option value="unknown">Unknown</option>
                                </select>
                                {renderVendorBadge(token[key])}
                              </div>
                            ))}
                          </div>
                          {token.vendorNotes && Object.keys(token.vendorNotes).length > 0 && (
                            <div className="text-xs text-muted-foreground space-y-0.5">
                              {Object.entries(token.vendorNotes).map(([vendor, note]) => (
                                <p key={vendor}><span className="font-medium text-foreground">{vendor}:</span> {note}</p>
                              ))}
                            </div>
                          )}

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

                      {/* AI Research Panel */}
                      <div className="border-t border-border pt-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                            <Sparkles size={12} className="text-primary" /> AI Due Diligence
                            {token.aiResearchedAt && (
                              <span className="text-[10px] text-muted-foreground font-normal flex items-center gap-1 ml-2">
                                <Clock size={10} /> Last run: {new Date(token.aiResearchedAt).toLocaleDateString()}
                              </span>
                            )}
                          </h4>
                          {aiEnabled && (
                            <button
                              onClick={() => handleResearch(token)}
                              disabled={researchLoading === token.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50"
                            >
                              {researchLoading === token.id ? (
                                <><RefreshCw size={12} className="animate-spin" /> Researching...</>
                              ) : researchResults[token.id] ? (
                                <><RefreshCw size={12} /> Re-run Research</>
                              ) : (
                                <><Sparkles size={12} /> Run AI Research</>
                              )}
                            </button>
                          )}
                          {aiEnabled === false && (
                            <span className="text-xs text-muted-foreground">AI not configured</span>
                          )}
                        </div>

                        {researchResults[token.id] != null && (() => {
                          const r = researchResults[token.id] as Record<string, string | Record<string, unknown> | null>;
                          const recMap: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
                            approve: { icon: CheckCircle2, color: "text-emerald-400", label: "Approve" },
                            approve_with_conditions: { icon: AlertCircle, color: "text-amber-400", label: "Approve with Conditions" },
                            further_review: { icon: HelpCircle, color: "text-blue-400", label: "Further Review Needed" },
                            reject: { icon: XCircle, color: "text-red-400", label: "Reject" },
                          };
                          const recKey = typeof r.recommendation === "string" ? r.recommendation.toLowerCase().replace(/\s+/g, "_") : "";
                          const recInfo = recMap[recKey] || recMap["further_review"];
                          const RecIcon = recInfo?.icon || HelpCircle;

                          return (
                            <div className="space-y-3">
                              {!!r.recommendation && (
                                <div className={`flex items-center gap-2 p-3 rounded-lg border ${
                                  recKey === "approve" ? "bg-emerald-500/5 border-emerald-500/20" :
                                  recKey === "reject" ? "bg-red-500/5 border-red-500/20" :
                                  recKey === "approve_with_conditions" ? "bg-amber-500/5 border-amber-500/20" :
                                  "bg-blue-500/5 border-blue-500/20"
                                }`}>
                                  <RecIcon size={16} className={recInfo?.color || "text-muted-foreground"} />
                                  <div className="flex-1">
                                    <p className={`text-sm font-semibold ${recInfo?.color || "text-foreground"}`}>
                                      AI Recommendation: {recInfo?.label || String(r.recommendation)}
                                    </p>
                                    {typeof r.recommendation === "object" && !!(r.recommendation as Record<string, unknown>)?.rationale && (
                                      <p className="text-xs text-muted-foreground mt-0.5">{String((r.recommendation as Record<string, unknown>).rationale)}</p>
                                    )}
                                  </div>
                                  <div className="flex gap-2 shrink-0">
                                    <button
                                      onClick={() => handleApplyResearch(token.id)}
                                      className="px-3 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20"
                                    >
                                      Apply Findings
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Research sections */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {!!r.summary && (
                                  <div className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-xs font-semibold text-foreground mb-1">Summary</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.summary)}</p>
                                  </div>
                                )}
                                {!!r.riskAssessment && (
                                  <div className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-xs font-semibold text-foreground mb-1">Risk Assessment</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                      {typeof r.riskAssessment === "object" ? JSON.stringify(r.riskAssessment, null, 2) : String(r.riskAssessment)}
                                    </p>
                                  </div>
                                )}
                                {/* Regulatory — with per-jurisdiction breakdown */}
                                {!!r.regulatoryConsiderations && (
                                  <div className="p-3 bg-muted/20 rounded-lg md:col-span-2">
                                    <div className="flex items-center justify-between mb-2">
                                      <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                                        <Globe size={12} /> Regulatory Considerations
                                      </p>
                                      {typeof r.regulatoryConsiderations === "object" && !!(r.regulatoryConsiderations as Record<string, unknown>)?.jurisdictions && (
                                        <button
                                          onClick={() => setShowRegulatory(showRegulatory === token.id ? null : token.id)}
                                          className="text-[10px] text-primary hover:underline"
                                        >
                                          {showRegulatory === token.id ? "Collapse" : "Show per-jurisdiction"}
                                        </button>
                                      )}
                                    </div>
                                    {showRegulatory === token.id ? (
                                      renderRegulatoryBreakdown(r.regulatoryConsiderations)
                                    ) : (
                                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                                        {typeof r.regulatoryConsiderations === "object" && (r.regulatoryConsiderations as Record<string, unknown>)?.overall
                                          ? String((r.regulatoryConsiderations as Record<string, unknown>).overall)
                                          : typeof r.regulatoryConsiderations === "string"
                                            ? r.regulatoryConsiderations
                                            : JSON.stringify(r.regulatoryConsiderations, null, 2)}
                                      </p>
                                    )}
                                  </div>
                                )}
                                {!!r.custodyFeasibility && (
                                  <div className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-xs font-semibold text-foreground mb-1">Custody Feasibility</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.custodyFeasibility)}</p>
                                  </div>
                                )}
                                {!!r.institutionalDemand && (
                                  <div className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-xs font-semibold text-foreground mb-1">Institutional Demand</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.institutionalDemand)}</p>
                                  </div>
                                )}
                                {!!r.stakingInfo && r.stakingInfo !== "Not applicable" && (
                                  <div className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-xs font-semibold text-foreground mb-1">Staking Info</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.stakingInfo)}</p>
                                  </div>
                                )}
                                {!!r.chainAnalysis && (
                                  <div className="p-3 bg-muted/20 rounded-lg">
                                    <p className="text-xs font-semibold text-foreground mb-1">Chain Analysis</p>
                                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.chainAnalysis)}</p>
                                  </div>
                                )}
                              </div>

                              {/* Security History — full width */}
                              {!!r.securityHistory && typeof r.securityHistory === "object" && (() => {
                                const sh = r.securityHistory as Record<string, unknown>;
                                const incidents = Array.isArray(sh.incidents) ? sh.incidents as Array<Record<string, string>> : [];
                                const ratingColors: Record<string, string> = {
                                  strong: "text-emerald-400 bg-emerald-500/10",
                                  adequate: "text-blue-400 bg-blue-500/10",
                                  concerning: "text-amber-400 bg-amber-500/10",
                                  poor: "text-red-400 bg-red-500/10",
                                };
                                const rating = typeof sh.overallSecurityRating === "string" ? sh.overallSecurityRating : "unknown";

                                return (
                                  <div className="p-3 bg-muted/20 rounded-lg border border-border/50">
                                    <div className="flex items-center justify-between mb-2">
                                      <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                                        <Shield size={12} /> Security History & Hack Analysis
                                      </p>
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${ratingColors[rating] || "text-muted-foreground bg-muted/30"}`}>
                                        {rating.charAt(0).toUpperCase() + rating.slice(1)}
                                      </span>
                                    </div>

                                    {incidents.length > 0 ? (
                                      <div className="space-y-2 mb-3">
                                        <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider">Known Incidents ({incidents.length})</p>
                                        {incidents.map((inc, idx) => (
                                          <div key={idx} className="p-2 bg-red-500/5 border border-red-500/10 rounded text-xs space-y-1">
                                            <div className="flex items-center gap-2">
                                              <span className="text-red-400 font-medium">{inc.date || "Unknown date"}</span>
                                              <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-[10px]">{(inc.type || "incident").replace(/_/g, " ")}</span>
                                              {inc.fundsLost && inc.fundsLost !== "N/A" && (
                                                <span className="text-red-400 font-medium">{inc.fundsLost} lost</span>
                                              )}
                                              {inc.recovered && (
                                                <span className={`text-[10px] ${inc.recovered.toLowerCase().includes("not") ? "text-red-400" : "text-emerald-400"}`}>
                                                  {inc.recovered}
                                                </span>
                                              )}
                                            </div>
                                            <p className="text-muted-foreground">{inc.description}</p>
                                            {inc.rootCause && <p className="text-muted-foreground"><span className="text-foreground font-medium">Root cause:</span> {inc.rootCause}</p>}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-emerald-400 mb-2">No known security incidents.</p>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                      {!!sh.auditHistory && (
                                        <div>
                                          <p className="text-foreground font-medium mb-0.5">Audit History</p>
                                          <p className="text-muted-foreground">{String(sh.auditHistory)}</p>
                                        </div>
                                      )}
                                      {!!sh.bugBountyProgram && (
                                        <div>
                                          <p className="text-foreground font-medium mb-0.5">Bug Bounty</p>
                                          <p className="text-muted-foreground">{String(sh.bugBountyProgram)}</p>
                                        </div>
                                      )}
                                    </div>
                                    {!!sh.operationalRisks && (
                                      <p className="text-xs text-muted-foreground mt-2"><span className="font-medium text-foreground">Operational Risks:</span> {String(sh.operationalRisks)}</p>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Operator action buttons */}
                              {token.status !== "live" && token.status !== "rejected" && (
                                <div className="flex items-center gap-2 pt-2">
                                  <span className="text-xs text-muted-foreground">Based on AI research:</span>
                                  {(recKey === "approve" || recKey === "approve_with_conditions") && token.status === "proposed" && (
                                    <button onClick={() => handleStatusChange(token.id, "under_review")} className="px-3 py-1 text-xs bg-indigo-500/10 text-indigo-400 rounded hover:bg-indigo-500/20">Start Review</button>
                                  )}
                                  {(recKey === "approve" || recKey === "approve_with_conditions") && token.status === "under_review" && (
                                    <button onClick={() => handleStatusChange(token.id, "compliance_review")} className="px-3 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Send to Compliance</button>
                                  )}
                                  {recKey === "approve" && token.status === "compliance_review" && (
                                    <button onClick={() => handleStatusChange(token.id, "approved")} className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">Approve</button>
                                  )}
                                  {recKey === "reject" && (
                                    <button onClick={() => handleStatusChange(token.id, "rejected")} className="px-3 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20">Reject</button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {!researchResults[token.id] && aiEnabled && !researchLoading && (
                          <p className="text-xs text-muted-foreground">
                            Click &quot;Run AI Research&quot; to get an automated due diligence report covering risk, regulatory (per-jurisdiction), custody feasibility, and institutional demand analysis.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

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

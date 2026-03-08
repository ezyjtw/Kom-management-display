"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Coins, Plus, Lightbulb } from "lucide-react";
import type { TokenData, TokenEntry, TokenSuggestion, Tab } from "./types";
import { TokenSummaryCards } from "./TokenSummaryCards";
import { TokenTable } from "./TokenTable";
import { NewTokenForm } from "./NewTokenForm";
import { AiSuggestions } from "./AiSuggestions";

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
  useEffect(() => {
    if (!data) return;
    const persisted: Record<string, Record<string, unknown>> = {};
    for (const t of data.tokens) if (t.aiResearchResult && Object.keys(t.aiResearchResult).length > 0) persisted[t.id] = t.aiResearchResult;
    setResearchResults((prev) => ({ ...persisted, ...prev }));
  }, [data]);

  const post = (url: string, body: Record<string, unknown>) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function checkAi() { try { const r = await post("/api/ai/assist", { action: "status" }); const j = await r.json(); if (j.success) setAiEnabled(j.data.enabled); } catch { /* */ } }
  async function fetchData() {
    setLoading(true); setError(null);
    try { const r = await fetch("/api/tokens"); const j = await r.json(); if (j.success) setData(j.data); else setError(j.error || `Request failed (${r.status})`); }
    catch (err) { setError(err instanceof Error ? err.message : "Network error — check your connection"); }
    finally { setLoading(false); }
  }
  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await post("/api/tokens", { action: "create", symbol: f.get("symbol"), name: f.get("name"), network: f.get("network"), tokenType: f.get("tokenType"), riskLevel: f.get("riskLevel"), marketCapTier: f.get("marketCapTier"), notes: f.get("notes") });
    setShowForm(false); fetchData();
  }
  async function handleStatusChange(tokenId: string, newStatus: string) {
    let reason = ""; if (newStatus === "rejected") { reason = prompt("Rejection reason:") || ""; if (!reason) return; }
    await post("/api/tokens", { action: "update_status", tokenId, newStatus, reason }); fetchData();
  }
  async function handleAddSignal(e: React.FormEvent<HTMLFormElement>, tokenId: string) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await post("/api/tokens", { action: "add_signal", tokenId, signalType: f.get("signalType"), source: f.get("source"), description: f.get("description"), weight: parseInt(f.get("weight") as string) || 1 });
    setShowSignalForm(null); fetchData();
  }
  async function handleToggleCheck(tokenId: string, field: "sanctionsCheck" | "amlRiskAssessed", currentValue: boolean) {
    await post("/api/tokens", { action: "update", tokenId, [field]: !currentValue }); fetchData();
  }

  async function handleResearch(token: TokenEntry) {
    setResearchLoading(token.id);
    try {
      const r = await post("/api/ai/assist", { action: "research_token", data: { symbol: token.symbol, name: token.name, network: token.network, tokenType: token.tokenType, contractAddress: token.contractAddress, marketCapTier: token.marketCapTier, existingNotes: token.notes, demandSignals: token.demandSignals.map((s) => ({ signalType: s.signalType, source: s.source, description: s.description })) } });
      const j = await r.json();
      if (j.success && j.data?.suggestion) {
        const result = j.data.suggestion as Record<string, unknown>;
        setResearchResults((prev) => ({ ...prev, [token.id]: result }));
        const recKey = typeof result.recommendation === "string" ? result.recommendation.toLowerCase().replace(/\s+/g, "_") : "";
        await post("/api/tokens", { action: "save_research", tokenId: token.id, researchResult: result, recommendation: recKey });
        fetchData();
      }
    } catch { /* */ } finally { setResearchLoading(null); }
  }
  async function handleApplyResearch(tokenId: string) {
    const research = researchResults[tokenId]; if (!research) return;
    const ud: Record<string, unknown> = { action: "update", tokenId };
    if (research.riskAssessment && typeof research.riskAssessment === "object") { const ra = research.riskAssessment as Record<string, unknown>; if (typeof ra === "string") ud.riskLevel = ra; }
    if (typeof research.riskAssessment === "string") { const lv = research.riskAssessment.toLowerCase(); if (["low", "medium", "high", "critical"].includes(lv)) ud.riskLevel = lv; }
    const np: string[] = [];
    if (research.summary) np.push(`AI Summary: ${research.summary}`);
    if (research.custodyFeasibility) np.push(`Custody: ${research.custodyFeasibility}`);
    if (research.stakingInfo && research.stakingInfo !== "Not applicable") np.push(`Staking: ${research.stakingInfo}`);
    if (np.length > 0) ud.notes = np.join("\n\n");
    if (research.riskAssessment && typeof research.riskAssessment === "object") { const ra = research.riskAssessment as Record<string, unknown>; if (ra.reasoning || ra.details) ud.riskNotes = String(ra.reasoning || ra.details || ""); }
    if (research.regulatoryConsiderations) { const rc = research.regulatoryConsiderations; if (typeof rc === "object" && rc !== null) { const rcObj = rc as Record<string, unknown>; ud.regulatoryNotes = rcObj.overall ? String(rcObj.overall) : JSON.stringify(rc); } else { ud.regulatoryNotes = String(rc); } }
    await post("/api/tokens", ud); fetchData();
  }
  async function handleUpdateVendor(tokenId: string, vendor: string, status: string) {
    await post("/api/tokens", { action: "update", tokenId, [vendor]: status }); fetchData();
  }
  async function handleSuggestTokens() {
    if (!data) return; setSuggestLoading(true);
    try {
      const et = data.tokens.map((t) => ({ symbol: t.symbol, network: t.network, status: t.status }));
      const cs = data.tokens.flatMap((t) => t.demandSignals.filter((s) => s.signalType === "client_request")).map((s) => ({ source: s.source, description: s.description }));
      const r = await post("/api/ai/assist", { action: "suggest_tokens", data: { existingTokens: et, clientDemandSignals: cs } });
      const j = await r.json(); if (j.success && j.data?.suggestion) setSuggestions(j.data.suggestion as TokenSuggestion[]);
    } catch { /* */ } finally { setSuggestLoading(false); }
  }
  async function handleAdoptSuggestion(s: TokenSuggestion) {
    await post("/api/tokens", { action: "create", symbol: s.symbol, name: s.name, network: s.network, tokenType: s.tokenType, riskLevel: s.suggestedRiskLevel || "medium", marketCapTier: s.marketCapTier || "unknown", notes: `AI Suggested: ${s.rationale}` });
    setSuggestions((prev) => prev.filter((x) => x.symbol !== s.symbol || x.network !== s.network)); fetchData();
  }
  if (loading) return (<div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading token registry...</div>);
  if (!data) return (<div className="text-center py-12"><AlertTriangle size={24} className="mx-auto mb-3 text-red-400" /><p className="text-muted-foreground">Failed to load token data.</p>{error && <p className="text-xs text-red-400 mt-1">{error}</p>}<button onClick={fetchData} className="mt-3 text-sm text-primary hover:underline">Retry</button></div>);

  const tabs: { key: Tab; label: string }[] = [{ key: "pipeline", label: "Review Pipeline" }, { key: "live", label: `Live (${data.summary.live})` }, { key: "demand", label: "Demand Tracker" }, { key: "discover", label: "Discover" }];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Coins size={24} className="text-primary" />Token Review</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Custody token onboarding pipeline & institutional demand tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"><Plus size={16} /> Propose Token</button>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
        </div>
      </div>
      <TokenSummaryCards summary={data.summary} />
      <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-1.5 text-sm rounded-md transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.key === "discover" && <Lightbulb size={14} className="inline mr-1.5 -mt-0.5" />}{t.label}
          </button>
        ))}
      </div>
      {tab === "discover" && <AiSuggestions aiEnabled={aiEnabled} suggestions={suggestions} suggestLoading={suggestLoading} onSuggestTokens={handleSuggestTokens} onAdoptSuggestion={handleAdoptSuggestion} />}
      <TokenTable
        tokens={data.tokens} tab={tab} filter={filter} expandedId={expandedId}
        showSignalForm={showSignalForm} researchResults={researchResults} researchLoading={researchLoading}
        aiEnabled={aiEnabled} showRegulatory={showRegulatory}
        onSetExpandedId={setExpandedId} onSetFilter={setFilter} onStatusChange={handleStatusChange}
        onToggleCheck={handleToggleCheck} onUpdateVendor={handleUpdateVendor} onAddSignal={handleAddSignal}
        onSetShowSignalForm={setShowSignalForm} onResearch={handleResearch} onApplyResearch={handleApplyResearch}
        onSetShowRegulatory={setShowRegulatory}
      />
      {showForm && <NewTokenForm onSubmit={handleCreate} onClose={() => setShowForm(false)} />}
    </div>
  );
}

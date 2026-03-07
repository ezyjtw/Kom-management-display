"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowDownUp,
  RefreshCw,
  Plus,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Link2,
  AlertCircle,
  Flag,
  ExternalLink,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Settlement {
  id: string;
  settlementRef: string;
  venue: string;
  clientName: string;
  clientAccount: string;
  asset: string;
  amount: number;
  direction: string;
  settlementCycle: string;
  exchangeInstructionId: string;
  onChainTxHash: string;
  collateralWallet: string;
  custodyWallet: string;
  matchStatus: string;
  matchNote: string;
  delegationStatus: string;
  delegatedAmount: number;
  status: string;
  makerById: string | null;
  makerByName: string | null;
  makerAt: string | null;
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  escalationNote: string;
  fireblockssTxId: string;
  oesSignerGroup: string;
  createdAt: string;
}

interface Summary {
  total: number;
  pending: number;
  confirmed: number;
  completed: number;
  escalated: number;
  failed: number;
  matched: number;
  mismatched: number;
  missingTx: number;
  flagged: number;
  byVenue: { okx: number; fireblocks: number };
}

// ─── Styling ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  confirmed: "bg-blue-500/10 text-blue-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  escalated: "bg-red-500/10 text-red-400",
  failed: "bg-red-500/10 text-red-400",
};

const MATCH_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  matched: "bg-emerald-500/10 text-emerald-400",
  mismatch: "bg-red-500/10 text-red-400",
  missing_tx: "bg-amber-500/10 text-amber-400",
  flagged: "bg-red-500/10 text-red-400",
};

const DELEGATION_COLORS: Record<string, string> = {
  "n/a": "text-muted-foreground",
  delegated: "text-emerald-400",
  undelegated: "text-amber-400",
  pending_delegation: "text-blue-400",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const [venueFilter, setVenueFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (venueFilter !== "all") params.set("venue", venueFilter);
      const res = await fetch(`/api/settlements?${params}`);
      const json = await res.json();
      if (json.success) {
        setSettlements(json.data.settlements);
        setSummary(json.data.summary);
      } else {
        setError(json.error || "Failed to load settlements");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [venueFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function patchSettlement(id: string, body: Record<string, unknown>) {
    try {
      const res = await fetch("/api/settlements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const json = await res.json();
      if (json.success) fetchData();
    } catch { /* ignore */ }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const res = await fetch("/api/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) { setShowForm(false); fetchData(); }
    } catch { /* ignore */ }
  }

  // Filter
  const filtered = settlements
    .filter((s) => {
      if (activeTab === "active") return s.status !== "completed";
      if (activeTab === "needs_action") return ["mismatch", "missing_tx", "flagged"].includes(s.matchStatus);
      if (activeTab === "escalated") return s.status === "escalated";
      if (activeTab === "completed") return s.status === "completed";
      return true;
    })
    .filter((s) =>
      !search ||
      s.clientName.toLowerCase().includes(search.toLowerCase()) ||
      s.settlementRef.toLowerCase().includes(search.toLowerCase()) ||
      s.asset.toLowerCase().includes(search.toLowerCase()) ||
      s.onChainTxHash.toLowerCase().includes(search.toLowerCase())
    );

  const tabs = [
    { key: "all", label: "All" },
    { key: "active", label: `Active${summary ? ` (${summary.pending + summary.confirmed + summary.escalated})` : ""}` },
    { key: "needs_action", label: `Needs Action${summary ? ` (${summary.mismatched + summary.missingTx + summary.flagged})` : ""}` },
    { key: "escalated", label: `Escalated${summary ? ` (${summary.escalated})` : ""}` },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <ArrowDownUp size={24} className="text-primary" />
            OES Settlements
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Settlement cycle monitoring — OKX OES and Fireblocks OES instruction matching
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            <Plus size={14} /> New Settlement
          </button>
          <button onClick={fetchData} className="p-2 border border-border rounded-lg hover:bg-accent/50 text-muted-foreground">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: "Total", value: summary.total, color: "text-foreground" },
            { label: "Pending", value: summary.pending, color: "text-amber-400" },
            { label: "Confirmed", value: summary.confirmed, color: "text-blue-400" },
            { label: "Completed", value: summary.completed, color: "text-emerald-400" },
            { label: "Matched", value: summary.matched, color: "text-emerald-400" },
            { label: "Mismatch", value: summary.mismatched, color: "text-red-400" },
            { label: "Missing TX", value: summary.missingTx, color: "text-amber-400" },
            { label: "Escalated", value: summary.escalated, color: "text-red-400" },
          ].map((stat) => (
            <div key={stat.label} className="bg-card rounded-xl border border-border p-2.5 text-center">
              <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Venue breakdown */}
      {summary && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Venues:</span>
          <span className="text-foreground">OKX: {summary.byVenue.okx}</span>
          <span className="text-foreground">Fireblocks: {summary.byVenue.fireblocks}</span>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Add Settlement Instruction</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input name="settlementRef" required placeholder="Settlement Ref / Cycle ID" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="venue" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="okx">OKX OES</option>
              <option value="fireblocks">Fireblocks OES</option>
            </select>
            <input name="clientName" required placeholder="Client Name" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="clientAccount" placeholder="Client Account" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="asset" required placeholder="Asset (BTC, ETH, USDC, SOL)" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="amount" required type="number" step="any" placeholder="Amount" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="direction" required className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="custody_to_exchange">Custody → Exchange</option>
              <option value="exchange_to_custody">Exchange → Custody</option>
            </select>
            <input name="settlementCycle" placeholder="Settlement Cycle (e.g. 2026-03-07T09:00Z)" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="exchangeInstructionId" placeholder="Exchange Instruction ID" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="collateralWallet" placeholder="Collateral Wallet" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="custodyWallet" placeholder="Custody Wallet" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent/50 text-muted-foreground">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 bg-muted/30 rounded-lg p-1">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTab === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
            {[{ key: "all", label: "All" }, { key: "okx", label: "OKX" }, { key: "fireblocks", label: "Fireblocks" }].map((v) => (
              <button key={v.key} onClick={() => setVenueFilter(v.key)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${venueFilter === v.key ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, ref, asset, tx..."
              className="pl-9 pr-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground w-56" />
          </div>
        </div>
      </div>

      {/* Error / Loading */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={fetchData} className="ml-auto text-xs border border-border rounded px-2 py-1 hover:bg-accent/50">Retry</button>
        </div>
      )}
      {loading && (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading settlement instructions...</p>
        </div>
      )}

      {/* Settlement table */}
      {!loading && !error && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Ref</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Venue</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Client</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Dir</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Asset</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground text-right">Amount</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Cycle</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Match</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">M/C</th>
                  <th className="px-3 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                      No settlement instructions found
                    </td>
                  </tr>
                )}
                {filtered.map((s) => {
                  const isExpanded = expandedId === s.id;
                  const isActive = s.status !== "completed";

                  return (
                    <Fragment key={s.id}>
                      <tr className={`hover:bg-accent/30 transition-colors ${s.matchStatus === "mismatch" || s.matchStatus === "flagged" ? "bg-red-500/5" : ""}`}>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-foreground">{s.settlementRef.slice(0, 14)}</span>
                            {s.onChainTxHash && (
                              <span title={`TX: ${s.onChainTxHash}`}><Link2 size={12} className="text-emerald-400" /></span>
                            )}
                          </div>
                          {s.exchangeInstructionId && (
                            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{s.exchangeInstructionId.slice(0, 12)}</p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${s.venue === "okx" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"}`}>
                            {s.venue === "okx" ? "OKX" : "Fireblocks"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-foreground text-xs">{s.clientName}</p>
                          {s.clientAccount && <p className="text-xs text-muted-foreground">{s.clientAccount}</p>}
                        </td>
                        <td className="px-3 py-3">
                          {s.direction === "custody_to_exchange" ? (
                            <span className="inline-flex items-center gap-1 text-blue-400 text-xs">
                              <ArrowUpRight size={12} /> C→E
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                              <ArrowDownRight size={12} /> E→C
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-foreground">{s.asset}</td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-foreground">
                          {s.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        </td>
                        <td className="px-3 py-3">
                          {s.settlementCycle ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock size={12} />
                              {s.settlementCycle.includes("T")
                                ? new Date(s.settlementCycle).toLocaleDateString() + " " + new Date(s.settlementCycle).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                : s.settlementCycle}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${MATCH_COLORS[s.matchStatus] || "bg-muted text-muted-foreground"}`}>
                            {s.matchStatus.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[s.status] || "bg-muted text-muted-foreground"}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            {s.makerById ? (
                              <span title={`Maker: ${s.makerByName}`}>
                                <ShieldCheck size={14} className="text-emerald-400" />
                              </span>
                            ) : (
                              <span title="No maker yet">
                                <Shield size={14} className="text-muted-foreground" />
                              </span>
                            )}
                            {s.checkerById ? (
                              <span title={`Checker: ${s.checkerByName}`}>
                                <ShieldCheck size={14} className="text-emerald-400" />
                              </span>
                            ) : (
                              <span title="No checker yet">
                                <Shield size={14} className="text-muted-foreground" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            {isActive && (
                              <>
                                {s.matchStatus === "pending" && (
                                  <button
                                    onClick={() => {
                                      const txHash = prompt("Enter on-chain TX hash:");
                                      if (txHash) patchSettlement(s.id, { action: "match_tx", onChainTxHash: txHash });
                                    }}
                                    className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400"
                                    title="Match on-chain TX"
                                  >
                                    <Link2 size={14} />
                                  </button>
                                )}
                                {!s.makerById && (
                                  <button onClick={() => patchSettlement(s.id, { action: "maker_confirm" })}
                                    className="p-1 rounded hover:bg-blue-500/10 text-blue-400" title="Maker confirm">
                                    <CheckCircle2 size={14} />
                                  </button>
                                )}
                                {s.makerById && !s.checkerById && (
                                  <button onClick={() => patchSettlement(s.id, { action: "checker_approve" })}
                                    className="p-1 rounded hover:bg-purple-500/10 text-purple-400" title="Checker approve">
                                    <ShieldCheck size={14} />
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    const note = prompt("Escalation note for exchange:");
                                    if (note !== null) patchSettlement(s.id, { action: "escalate", escalationNote: note });
                                  }}
                                  className="p-1 rounded hover:bg-red-500/10 text-red-400" title="Flag / Escalate">
                                  <Flag size={14} />
                                </button>
                              </>
                            )}
                            <button onClick={() => setExpandedId(isExpanded ? null : s.id)}
                              className="p-1 rounded hover:bg-accent/50 text-muted-foreground">
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="bg-muted/10 px-4 py-3 border-b border-border">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                              {/* Wallets */}
                              <div>
                                <p className="font-semibold text-foreground mb-1">Wallets</p>
                                <div className="space-y-1 text-muted-foreground">
                                  {s.collateralWallet && <p>Collateral: <span className="font-mono text-foreground">{s.collateralWallet}</span></p>}
                                  {s.custodyWallet && <p>Custody: <span className="font-mono text-foreground">{s.custodyWallet}</span></p>}
                                  {s.onChainTxHash && (
                                    <p className="flex items-center gap-1">
                                      TX: <span className="font-mono text-emerald-400">{s.onChainTxHash}</span>
                                      <ExternalLink size={10} className="text-muted-foreground" />
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Delegation (OKX) */}
                              {s.venue === "okx" && (
                                <div>
                                  <p className="font-semibold text-foreground mb-1">Delegation</p>
                                  <div className="space-y-1">
                                    <p className={`${DELEGATION_COLORS[s.delegationStatus] || "text-muted-foreground"}`}>
                                      Status: {s.delegationStatus}
                                    </p>
                                    {s.delegatedAmount > 0 && (
                                      <p className="text-muted-foreground">Delegated: {s.delegatedAmount.toLocaleString()} {s.asset}</p>
                                    )}
                                    {isActive && (
                                      <div className="flex gap-1 mt-1">
                                        <button onClick={() => patchSettlement(s.id, { action: "update_delegation", delegationStatus: "delegated" })}
                                          className="px-2 py-0.5 rounded border border-border text-emerald-400 hover:bg-emerald-500/10">Delegate</button>
                                        <button onClick={() => patchSettlement(s.id, { action: "update_delegation", delegationStatus: "undelegated" })}
                                          className="px-2 py-0.5 rounded border border-border text-amber-400 hover:bg-amber-500/10">Undelegate</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Fireblocks specific */}
                              {s.venue === "fireblocks" && (
                                <div>
                                  <p className="font-semibold text-foreground mb-1">Fireblocks</p>
                                  <div className="space-y-1 text-muted-foreground">
                                    {s.fireblockssTxId && <p>FB TX: <span className="font-mono text-foreground">{s.fireblockssTxId}</span></p>}
                                    {s.oesSignerGroup && <p>Signer Group: <span className="text-foreground">{s.oesSignerGroup}</span></p>}
                                    {!s.fireblockssTxId && <p className="text-amber-400">No Fireblocks TX recorded</p>}
                                  </div>
                                </div>
                              )}

                              {/* Audit trail */}
                              <div>
                                <p className="font-semibold text-foreground mb-1">Audit Trail</p>
                                <div className="space-y-1 text-muted-foreground">
                                  <p>Created: {new Date(s.createdAt).toLocaleString()}</p>
                                  {s.makerById && <p>Maker: {s.makerByName} @ {s.makerAt ? new Date(s.makerAt).toLocaleString() : "—"}</p>}
                                  {s.checkerById && <p>Checker: {s.checkerByName} @ {s.checkerAt ? new Date(s.checkerAt).toLocaleString() : "—"}</p>}
                                </div>
                              </div>

                              {/* Notes / Escalation */}
                              <div>
                                <p className="font-semibold text-foreground mb-1">Notes</p>
                                {s.matchNote && <p className="text-muted-foreground">{s.matchNote}</p>}
                                {s.escalationNote && (
                                  <p className="text-red-400 flex items-center gap-1">
                                    <AlertCircle size={12} /> {s.escalationNote}
                                  </p>
                                )}
                                {!s.matchNote && !s.escalationNote && (
                                  <p className="text-muted-foreground italic">No notes</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Need Fragment for JSX
import { Fragment } from "react";

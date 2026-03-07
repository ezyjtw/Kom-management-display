"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DollarSign,
  RefreshCw,
  Plus,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  User,
  ExternalLink,
  Shield,
  ShieldCheck,
  Wallet,
  ChevronDown,
  ChevronUp,
  FileCheck,
  AlertCircle,
} from "lucide-react";

// ─── Workflow definitions ────────────────────────────────────────────────────

const ONRAMP_STAGES = [
  { key: "instruction_received", label: "Instruction Received", short: "Received" },
  { key: "usd_received", label: "USD Received — Pending Conversion", short: "USD Recv" },
  { key: "usd_receipt_confirmed", label: "USD Receipt Confirmed", short: "Confirmed" },
  { key: "usd_sent_to_issuer", label: "USD Sent to Issuer", short: "Sent" },
  { key: "usdc_minted", label: "USDC Minted to Holding Wallet", short: "Minted" },
  { key: "usdc_delivered", label: "USDC Delivered to Client Wallet", short: "Delivered" },
  { key: "completed", label: "Completed", short: "Done" },
];

const OFFRAMP_STAGES = [
  { key: "instruction_received", label: "Instruction Received", short: "Received" },
  { key: "instruction_accepted", label: "Instruction Accepted", short: "Accepted" },
  { key: "usdc_received", label: "USDC Received at Issuer", short: "USDC Recv" },
  { key: "usd_conversion_pending", label: "USD Conversion Pending", short: "Converting" },
  { key: "usd_sent", label: "USD Sent to Client Bank", short: "USD Sent" },
  { key: "completed", label: "Completed", short: "Done" },
];

function getStages(direction: string) {
  return direction === "onramp" ? ONRAMP_STAGES : OFFRAMP_STAGES;
}

function getStageIndex(direction: string, status: string): number {
  const stages = getStages(direction);
  const idx = stages.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

function getNextStatus(direction: string, currentStatus: string): string | null {
  const stages = getStages(direction);
  const idx = stages.findIndex((s) => s.key === currentStatus);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return stages[idx + 1].key;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface RampTicket {
  id: string;
  ticketRef: string;
  clientName: string;
  clientAccount: string;
  direction: string;
  amount: number;
  fiatCurrency: string;
  fiatAmount: number | null;
  status: string;
  bankReference: string;
  instructionRef: string;
  ssiVerified: boolean;
  ssiDetails: string;
  custodyWalletId: string;
  holdingWalletId: string;
  onChainTxHash: string;
  gasWalletOk: boolean;
  issuerConfirmation: string;
  expressEnabled: boolean;
  feesFromBuffer: boolean;
  feeBufferLow: boolean;
  makerById: string | null;
  makerByName: string | null;
  makerAt: string | null;
  makerNote: string;
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  checkerNote: string;
  kycAmlOk: boolean;
  walletWhitelisted: boolean;
  evidence: string;
  notes: string;
  rejectionReason: string;
  requestedAt: string;
  completedAt: string | null;
  clientNotifiedAt: string | null;
  priority: string;
  createdAt: string;
}

interface Summary {
  total: number;
  active: number;
  awaitingCheckerApproval: number;
  completed: number;
  feeBufferLow: boolean;
  totalOnrampVolume: number;
  totalOfframpVolume: number;
}

// ─── Styling ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-amber-400",
  urgent: "text-red-400 font-semibold",
};

function formatUsd(val: number) {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function UsdcRampPage() {
  const [tickets, setTickets] = useState<RampTicket[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("active");
  const [dirFilter, setDirFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dirFilter !== "all") params.set("direction", dirFilter);
      const res = await fetch(`/api/usdc-ramp?${params}`);
      const json = await res.json();
      if (json.success) {
        setTickets(json.data.tickets);
        setSummary(json.data.summary);
      } else {
        setError(json.error || "Failed to load ramp tickets");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [dirFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function patchTicket(id: string, body: Record<string, unknown>) {
    try {
      const res = await fetch("/api/usdc-ramp", {
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
      const res = await fetch("/api/usdc-ramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) { setShowForm(false); fetchData(); }
    } catch { /* ignore */ }
  }

  // Filter tickets by tab
  const filtered = tickets
    .filter((t) => {
      if (activeTab === "active") return t.status !== "completed" && t.status !== "rejected";
      if (activeTab === "completed") return t.status === "completed";
      if (activeTab === "awaiting_checker") return t.makerById && !t.checkerById && t.status !== "completed";
      return true;
    })
    .filter((t) =>
      !search ||
      t.clientName.toLowerCase().includes(search.toLowerCase()) ||
      t.ticketRef.toLowerCase().includes(search.toLowerCase()) ||
      t.bankReference.toLowerCase().includes(search.toLowerCase())
    );

  const tabs = [
    { key: "all", label: "All" },
    { key: "active", label: `Active${summary ? ` (${summary.active})` : ""}` },
    { key: "awaiting_checker", label: `Awaiting Checker${summary ? ` (${summary.awaitingCheckerApproval})` : ""}` },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign size={24} className="text-primary" />
            USDC On/Off Ramp
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Client USDC minting (fiat → USDC) and redemption (USDC → fiat) tickets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            <Plus size={14} /> New Ticket
          </button>
          <button onClick={fetchData} className="p-2 border border-border rounded-lg hover:bg-accent/50 text-muted-foreground">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-card rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={14} className="text-amber-400" />
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <p className="text-lg font-bold text-foreground">{summary.active}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-purple-400" />
              <span className="text-xs text-muted-foreground">Awaiting Checker</span>
            </div>
            <p className="text-lg font-bold text-purple-400">{summary.awaitingCheckerApproval}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
            <p className="text-lg font-bold text-emerald-400">{summary.completed}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownRight size={14} className="text-emerald-400" />
              <span className="text-xs text-muted-foreground">Onramp Vol.</span>
            </div>
            <p className="text-sm font-bold text-foreground">${formatUsd(summary.totalOnrampVolume)}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight size={14} className="text-blue-400" />
              <span className="text-xs text-muted-foreground">Offramp Vol.</span>
            </div>
            <p className="text-sm font-bold text-foreground">${formatUsd(summary.totalOfframpVolume)}</p>
          </div>
        </div>
      )}

      {/* Fee buffer warning */}
      {summary?.feeBufferLow && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-400">Fee buffer is running low — proprietary buffer needs top-up to cover bank/issuer fees.</p>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">New Ramp Instruction</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input name="clientName" required placeholder="Client Legal Name" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="clientAccount" placeholder="Service Account" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="direction" required className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="onramp">Onramp (USD → USDC)</option>
              <option value="offramp">Offramp (USDC → USD)</option>
            </select>
            <input name="amount" required type="number" step="0.01" placeholder="USDC Amount" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="fiatCurrency" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CHF">CHF</option>
            </select>
            <input name="fiatAmount" type="number" step="0.01" placeholder="Fiat Amount (optional)" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="bankReference" placeholder="SWIFT / Payment Reference" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="instructionRef" placeholder="Client Instruction Ref" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="custodyWalletId" placeholder="Segregated USDC Wallet ID" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="ssiDetails" placeholder="SSI / Bank Details" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="priority" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <textarea name="notes" placeholder="Notes" rows={2} className="sm:col-span-2 lg:col-span-2 px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent/50 text-muted-foreground">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create Ticket</button>
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
            {[{ key: "all", label: "All" }, { key: "onramp", label: "Onramp" }, { key: "offramp", label: "Offramp" }].map((d) => (
              <button key={d.key} onClick={() => setDirFilter(d.key)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${dirFilter === d.key ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, ticket, ref..."
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
          <p className="text-sm text-muted-foreground">Loading ramp tickets...</p>
        </div>
      )}

      {/* Tickets */}
      {!loading && !error && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <DollarSign size={24} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No ramp tickets found</p>
            </div>
          )}
          {filtered.map((t) => {
            const stages = getStages(t.direction);
            const stageIdx = getStageIndex(t.direction, t.status);
            const isExpanded = expandedId === t.id;
            const nextStatus = getNextStatus(t.direction, t.status);
            const isActive = t.status !== "completed" && t.status !== "rejected";

            return (
              <div key={t.id} className={`bg-card rounded-xl border transition-colors ${t.feeBufferLow ? "border-amber-500/40" : "border-border"} ${isActive ? "hover:border-primary/30" : ""}`}>
                {/* Main row */}
                <div className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {t.direction === "onramp" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400">
                            <ArrowDownRight size={12} /> Onramp
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400">
                            <ArrowUpRight size={12} /> Offramp
                          </span>
                        )}
                        <span className="text-xs font-mono text-muted-foreground">{t.ticketRef.slice(0, 12)}</span>
                        {t.priority !== "normal" && (
                          <span className={`text-xs ${PRIORITY_COLORS[t.priority]}`}>{t.priority.toUpperCase()}</span>
                        )}
                        {t.status === "rejected" && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-400">Rejected</span>
                        )}
                      </div>

                      {/* Client & amount */}
                      <h3 className="text-sm font-semibold text-foreground mt-1.5">{t.clientName}</h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="font-mono text-foreground text-sm font-semibold">{formatUsd(t.amount)} USDC</span>
                        {t.fiatAmount && <span>≈ {t.fiatCurrency} {formatUsd(t.fiatAmount)}</span>}
                        {t.bankReference && <span>SWIFT: {t.bankReference}</span>}
                        {t.instructionRef && <span>Instr: {t.instructionRef}</span>}
                      </div>

                      {/* Progress bar (workflow stages) */}
                      {isActive && (
                        <div className="mt-3 flex items-center gap-1">
                          {stages.map((stage, i) => (
                            <div key={stage.key} className="flex items-center gap-1 flex-1">
                              <div className={`h-1.5 flex-1 rounded-full ${i <= stageIdx ? "bg-primary" : "bg-muted/50"}`} />
                              {i < stages.length - 1 && <div className="w-0.5" />}
                            </div>
                          ))}
                        </div>
                      )}
                      {isActive && (
                        <p className="text-xs text-primary mt-1">
                          {stages[stageIdx]?.label || t.status}
                        </p>
                      )}
                    </div>

                    {/* Right side: meta & actions */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={12} />
                        {new Date(t.requestedAt).toLocaleDateString()}
                      </div>

                      {/* Maker/Checker status */}
                      <div className="flex items-center gap-2">
                        {t.makerById ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                            <ShieldCheck size={12} /> Maker: {t.makerByName || "Done"}
                          </span>
                        ) : isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Shield size={12} /> No maker
                          </span>
                        ) : null}
                        {t.checkerById ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                            <ShieldCheck size={12} /> Checker: {t.checkerByName || "Done"}
                          </span>
                        ) : t.makerById && isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                            <Shield size={12} /> Awaiting checker
                          </span>
                        ) : null}
                      </div>

                      {t.completedAt && <p className="text-xs text-emerald-400">Done {new Date(t.completedAt).toLocaleDateString()}</p>}
                      {t.onChainTxHash && (
                        <p className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                          <ExternalLink size={10} /> {t.onChainTxHash.slice(0, 16)}...
                        </p>
                      )}

                      {/* Actions */}
                      {isActive && (
                        <div className="flex items-center gap-1 mt-1">
                          {!t.makerById && (
                            <button onClick={() => patchTicket(t.id, { action: "maker_confirm", status: nextStatus })}
                              className="px-2 py-1 text-xs border border-border rounded hover:bg-emerald-500/10 text-emerald-400">
                              Maker Confirm
                            </button>
                          )}
                          {t.makerById && !t.checkerById && (
                            <button onClick={() => patchTicket(t.id, { action: "checker_approve", status: nextStatus })}
                              className="px-2 py-1 text-xs border border-border rounded hover:bg-purple-500/10 text-purple-400">
                              Checker Approve
                            </button>
                          )}
                          {nextStatus && t.checkerById && (
                            <button onClick={() => patchTicket(t.id, { action: "advance_status", status: nextStatus })}
                              className="px-2 py-1 text-xs border border-border rounded hover:bg-blue-500/10 text-blue-400">
                              Advance →
                            </button>
                          )}
                          <button onClick={() => patchTicket(t.id, { action: "reject", rejectionReason: "Manual rejection" })}
                            className="p-1 rounded hover:bg-red-500/10 text-red-400">
                            <XCircle size={14} />
                          </button>
                        </div>
                      )}

                      {/* Expand/collapse */}
                      <button onClick={() => setExpandedId(isExpanded ? null : t.id)}
                        className="p-1 rounded hover:bg-accent/50 text-muted-foreground mt-1">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 bg-muted/10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                      {/* Checks */}
                      <div>
                        <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1">
                          <FileCheck size={12} /> Pre-flight Checks
                        </p>
                        <div className="space-y-1">
                          {[
                            { label: "KYC/AML OK", ok: t.kycAmlOk, field: "kycAmlOk" },
                            { label: "SSI Verified", ok: t.ssiVerified, field: "ssiVerified" },
                            { label: "Wallet Whitelisted", ok: t.walletWhitelisted, field: "walletWhitelisted" },
                            { label: "Gas Wallet OK", ok: t.gasWalletOk, field: "gasWalletOk" },
                            { label: "Express Enabled", ok: t.expressEnabled, field: "expressEnabled" },
                          ].map((check) => (
                            <button key={check.field}
                              onClick={() => patchTicket(t.id, { action: "update_checks", [check.field]: !check.ok })}
                              className="flex items-center gap-2 w-full text-left hover:bg-accent/30 rounded px-1 py-0.5">
                              {check.ok ? (
                                <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                              ) : (
                                <XCircle size={12} className="text-red-400 shrink-0" />
                              )}
                              <span className={check.ok ? "text-foreground" : "text-muted-foreground"}>{check.label}</span>
                            </button>
                          ))}
                        </div>
                        {t.feeBufferLow && (
                          <div className="flex items-center gap-1 mt-2 text-amber-400">
                            <AlertCircle size={12} />
                            <span>Fee buffer low — needs top-up</span>
                          </div>
                        )}
                        {!t.feeBufferLow && isActive && (
                          <button onClick={() => patchTicket(t.id, { action: "flag_buffer" })}
                            className="mt-2 text-muted-foreground hover:text-amber-400">
                            Flag fee buffer low
                          </button>
                        )}
                      </div>

                      {/* Wallets & On-chain */}
                      <div>
                        <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1">
                          <Wallet size={12} /> Wallets & Chain
                        </p>
                        <div className="space-y-1 text-muted-foreground">
                          {t.custodyWalletId && <p>Custody Wallet: <span className="font-mono text-foreground">{t.custodyWalletId}</span></p>}
                          {t.holdingWalletId && <p>Holding Wallet: <span className="font-mono text-foreground">{t.holdingWalletId}</span></p>}
                          {t.onChainTxHash && <p>TX Hash: <span className="font-mono text-foreground">{t.onChainTxHash}</span></p>}
                          {t.issuerConfirmation && <p>Issuer Conf: <span className="text-foreground">{t.issuerConfirmation}</span></p>}
                          {t.ssiDetails && <p>SSI: <span className="text-foreground">{t.ssiDetails}</span></p>}
                        </div>
                      </div>

                      {/* Timeline & evidence */}
                      <div>
                        <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1">
                          <User size={12} /> Audit Trail
                        </p>
                        <div className="space-y-1 text-muted-foreground">
                          <p>Requested: {new Date(t.requestedAt).toLocaleString()}</p>
                          {t.makerById && <p>Maker: {t.makerByName} @ {t.makerAt ? new Date(t.makerAt).toLocaleString() : "—"}</p>}
                          {t.makerNote && <p className="italic">&quot;{t.makerNote}&quot;</p>}
                          {t.checkerById && <p>Checker: {t.checkerByName} @ {t.checkerAt ? new Date(t.checkerAt).toLocaleString() : "—"}</p>}
                          {t.checkerNote && <p className="italic">&quot;{t.checkerNote}&quot;</p>}
                          {t.clientNotifiedAt && <p>Client Notified: {new Date(t.clientNotifiedAt).toLocaleString()}</p>}
                          {t.completedAt && <p className="text-emerald-400">Completed: {new Date(t.completedAt).toLocaleString()}</p>}
                        </div>
                        {t.notes && <p className="mt-1 italic text-muted-foreground">{t.notes}</p>}
                        {t.rejectionReason && <p className="mt-1 text-red-400">Rejected: {t.rejectionReason}</p>}

                        {/* Notify client button */}
                        {isActive && !t.clientNotifiedAt && t.status === "completed" && (
                          <button onClick={() => patchTicket(t.id, { action: "notify_client" })}
                            className="mt-2 px-2 py-1 text-xs border border-border rounded hover:bg-emerald-500/10 text-emerald-400">
                            Mark Client Notified
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

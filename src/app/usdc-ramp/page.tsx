"use client";

import { useState, useEffect, useCallback } from "react";
import { DollarSign, RefreshCw, Plus, Search, AlertTriangle } from "lucide-react";
import { RampSummaryCards } from "./RampSummaryCards";
import { TicketRow } from "./TicketRow";
import { NewTicketForm } from "./NewTicketForm";

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
      if (json.success) { setTickets(json.data.tickets); setSummary(json.data.summary); }
      else setError(json.error || "Failed to load ramp tickets");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }, [dirFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function patchTicket(id: string, body: Record<string, unknown>) {
    try {
      const res = await fetch("/api/usdc-ramp", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      const json = await res.json();
      if (json.success) fetchData();
    } catch { /* ignore */ }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const res = await fetch("/api/usdc-ramp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.success) { setShowForm(false); fetchData(); }
    } catch { /* ignore */ }
  }

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
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Client USDC minting (fiat → USDC) and redemption (USDC → fiat) tickets</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"><Plus size={14} /> New Ticket</button>
          <button onClick={fetchData} className="p-2 border border-border rounded-lg hover:bg-accent/50 text-muted-foreground"><RefreshCw size={16} /></button>
        </div>
      </div>

      {summary && <RampSummaryCards summary={summary} />}
      {showForm && <NewTicketForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />}

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

      {!loading && !error && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <DollarSign size={24} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No ramp tickets found</p>
            </div>
          )}
          {filtered.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              isExpanded={expandedId === t.id}
              onToggleExpand={() => setExpandedId(expandedId === t.id ? null : t.id)}
              onPatch={patchTicket}
            />
          ))}
        </div>
      )}
    </div>
  );
}

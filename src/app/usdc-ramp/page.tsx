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
} from "lucide-react";

interface RampRequest {
  id: string;
  clientName: string;
  clientAccount: string;
  direction: string;
  amount: number;
  fiatCurrency: string;
  fiatAmount: number | null;
  bankReference: string;
  walletAddress: string;
  status: string;
  priority: string;
  requestedAt: string;
  completedAt: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string;
  rejectionReason: string;
  txHash: string;
  createdAt: string;
}

interface Summary {
  total: number;
  pending: number;
  awaitingFunds: number;
  processing: number;
  completed: number;
  rejected: number;
  totalOnrampVolume: number;
  totalOfframpVolume: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  awaiting_funds: "bg-blue-500/10 text-blue-400",
  processing: "bg-purple-500/10 text-purple-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  rejected: "bg-red-500/10 text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-amber-400",
  urgent: "text-red-400",
};

export default function UsdcRampPage() {
  const [requests, setRequests] = useState<RampRequest[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [dirFilter, setDirFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("status", activeTab);
      if (dirFilter !== "all") params.set("direction", dirFilter);
      const res = await fetch(`/api/usdc-ramp?${params}`);
      const json = await res.json();
      if (json.success) {
        setRequests(json.data.requests);
        setSummary(json.data.summary);
      } else {
        setError(json.error || "Failed to load ramp requests");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [activeTab, dirFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleStatusChange(id: string, status: string) {
    try {
      const res = await fetch("/api/usdc-ramp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
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
      if (json.success) {
        setShowForm(false);
        fetchData();
      }
    } catch { /* ignore */ }
  }

  const filtered = requests.filter((r) =>
    !search ||
    r.clientName.toLowerCase().includes(search.toLowerCase()) ||
    r.bankReference.toLowerCase().includes(search.toLowerCase()) ||
    r.walletAddress.toLowerCase().includes(search.toLowerCase())
  );

  const tabs = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "awaiting_funds", label: "Awaiting Funds" },
    { key: "processing", label: "Processing" },
    { key: "completed", label: "Completed" },
    { key: "rejected", label: "Rejected" },
  ];

  function formatUsd(val: number) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

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
            Client USDC minting (onramp) and redemption (offramp) requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus size={14} />
            New Request
          </button>
          <button
            onClick={fetchData}
            className="p-2 border border-border rounded-lg hover:bg-accent/50 text-muted-foreground"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-amber-500/10 rounded-lg">
                <Clock size={16} className="text-amber-400" />
              </div>
              <span className="text-xs text-muted-foreground">Active</span>
            </div>
            <p className="text-xl font-bold text-foreground">
              {summary.pending + summary.awaitingFunds + summary.processing}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {summary.pending} pending · {summary.awaitingFunds} awaiting · {summary.processing} processing
            </p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                <CheckCircle2 size={16} className="text-emerald-400" />
              </div>
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
            <p className="text-xl font-bold text-emerald-400">{summary.completed}</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                <ArrowDownRight size={16} className="text-emerald-400" />
              </div>
              <span className="text-xs text-muted-foreground">Onramp Volume</span>
            </div>
            <p className="text-lg font-bold text-foreground">${formatUsd(summary.totalOnrampVolume)}</p>
            <p className="text-xs text-muted-foreground">USDC minted</p>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-blue-500/10 rounded-lg">
                <ArrowUpRight size={16} className="text-blue-400" />
              </div>
              <span className="text-xs text-muted-foreground">Offramp Volume</span>
            </div>
            <p className="text-lg font-bold text-foreground">${formatUsd(summary.totalOfframpVolume)}</p>
            <p className="text-xs text-muted-foreground">USDC redeemed</p>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">New Ramp Request</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input name="clientName" required placeholder="Client Name" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="clientAccount" placeholder="Client Account" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="direction" required className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="onramp">Onramp (Fiat → USDC)</option>
              <option value="offramp">Offramp (USDC → Fiat)</option>
            </select>
            <input name="amount" required type="number" step="0.01" placeholder="USDC Amount" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="fiatCurrency" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CHF">CHF</option>
              <option value="JPY">JPY</option>
            </select>
            <input name="fiatAmount" type="number" step="0.01" placeholder="Fiat Amount (optional)" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="bankReference" placeholder="Bank Wire Reference" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="walletAddress" placeholder="USDC Wallet Address" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="priority" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="normal">Normal</option>
              <option value="low">Low</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <div className="sm:col-span-2 lg:col-span-3">
              <textarea name="notes" placeholder="Notes (optional)" rows={2} className="w-full px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            </div>
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
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
            {[
              { key: "all", label: "All" },
              { key: "onramp", label: "Onramp" },
              { key: "offramp", label: "Offramp" },
            ].map((d) => (
              <button
                key={d.key}
                onClick={() => setDirFilter(d.key)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  dirFilter === d.key
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client, ref..."
              className="pl-9 pr-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground w-56"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={fetchData} className="ml-auto text-xs border border-border rounded px-2 py-1 hover:bg-accent/50 text-muted-foreground">Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading ramp requests...</p>
        </div>
      )}

      {/* Request cards */}
      {!loading && !error && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <DollarSign size={24} className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No ramp requests found</p>
            </div>
          )}
          {filtered.map((r) => (
            <div key={r.id} className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                {/* Left: Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {r.direction === "onramp" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-500/10 text-emerald-400">
                        <ArrowDownRight size={12} /> Onramp
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400">
                        <ArrowUpRight size={12} /> Offramp
                      </span>
                    )}
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status] || "bg-muted text-muted-foreground"}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                    <span className={`text-xs font-medium ${PRIORITY_COLORS[r.priority] || "text-foreground"}`}>
                      {r.priority !== "normal" && r.priority.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mt-1.5">{r.clientName}</h3>
                  {r.clientAccount && <p className="text-xs text-muted-foreground">{r.clientAccount}</p>}

                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono text-foreground text-sm font-semibold">
                      {formatUsd(r.amount)} USDC
                    </span>
                    {r.fiatAmount && (
                      <span>≈ {r.fiatCurrency} {formatUsd(r.fiatAmount)}</span>
                    )}
                    {r.bankReference && <span>Bank: {r.bankReference}</span>}
                  </div>

                  {r.walletAddress && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-md">
                      Wallet: {r.walletAddress}
                    </p>
                  )}

                  {r.txHash && (
                    <p className="text-xs text-emerald-400 mt-1 font-mono flex items-center gap-1">
                      <ExternalLink size={10} /> {r.txHash}
                    </p>
                  )}

                  {r.notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{r.notes}</p>
                  )}

                  {r.rejectionReason && (
                    <p className="text-xs text-red-400 mt-1">Rejected: {r.rejectionReason}</p>
                  )}
                </div>

                {/* Right: Meta + actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={12} />
                    {new Date(r.requestedAt).toLocaleDateString()}
                  </div>
                  {r.assignedToName && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User size={12} />
                      {r.assignedToName}
                    </div>
                  )}
                  {r.completedAt && (
                    <p className="text-xs text-emerald-400">
                      Done {new Date(r.completedAt).toLocaleDateString()}
                    </p>
                  )}

                  {/* Status actions */}
                  {(r.status === "pending" || r.status === "awaiting_funds" || r.status === "processing") && (
                    <div className="flex items-center gap-1 mt-1">
                      {r.status === "pending" && (
                        <button
                          onClick={() => handleStatusChange(r.id, "awaiting_funds")}
                          className="px-2 py-1 text-xs border border-border rounded hover:bg-blue-500/10 text-blue-400"
                        >
                          Awaiting Funds
                        </button>
                      )}
                      {(r.status === "pending" || r.status === "awaiting_funds") && (
                        <button
                          onClick={() => handleStatusChange(r.id, "processing")}
                          className="px-2 py-1 text-xs border border-border rounded hover:bg-purple-500/10 text-purple-400"
                        >
                          Process
                        </button>
                      )}
                      <button
                        onClick={() => handleStatusChange(r.id, "completed")}
                        title="Complete"
                        className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400"
                      >
                        <CheckCircle2 size={14} />
                      </button>
                      <button
                        onClick={() => handleStatusChange(r.id, "rejected")}
                        title="Reject"
                        className="p-1 rounded hover:bg-red-500/10 text-red-400"
                      >
                        <XCircle size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

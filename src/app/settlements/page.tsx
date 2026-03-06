"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Plus,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Link2,
} from "lucide-react";

interface Settlement {
  id: string;
  settlementRef: string;
  clientName: string;
  clientAccount: string;
  asset: string;
  amount: number;
  direction: string;
  counterparty: string;
  expectedSettleAt: string;
  actualSettleAt: string | null;
  mappingStatus: string;
  mappingNote: string;
  komainuTxId: string;
  oesTradeId: string;
  status: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

interface Summary {
  total: number;
  pending: number;
  completed: number;
  failed: number;
  mismatched: number;
  unmapped: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  failed: "bg-red-500/10 text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

const MAPPING_COLORS: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-400",
  mapped: "bg-emerald-500/10 text-emerald-400",
  mismatch: "bg-red-500/10 text-red-400",
  failed: "bg-red-500/10 text-red-400",
};

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") {
        if (["pending", "completed", "failed"].includes(activeTab)) {
          params.set("status", activeTab);
        } else {
          params.set("mappingStatus", activeTab);
        }
      }
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
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleStatusChange(id: string, status: string, mappingStatus?: string) {
    try {
      const body: Record<string, string> = { id, status };
      if (mappingStatus) body.mappingStatus = mappingStatus;
      const res = await fetch("/api/settlements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      if (json.success) {
        setShowForm(false);
        fetchData();
      }
    } catch { /* ignore */ }
  }

  const filtered = settlements.filter((s) =>
    !search ||
    s.clientName.toLowerCase().includes(search.toLowerCase()) ||
    s.settlementRef.toLowerCase().includes(search.toLowerCase()) ||
    s.asset.toLowerCase().includes(search.toLowerCase())
  );

  const tabs = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "mismatch", label: "Mismatches" },
    { key: "failed", label: "Failed" },
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
            Settlement mapping and completion tracking from Komainu UI
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            <Plus size={14} />
            New Settlement
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Total", value: summary.total, color: "text-foreground" },
            { label: "Pending", value: summary.pending, color: "text-amber-400" },
            { label: "Completed", value: summary.completed, color: "text-emerald-400" },
            { label: "Failed", value: summary.failed, color: "text-red-400" },
            { label: "Mismatched", value: summary.mismatched, color: "text-red-400" },
            { label: "Unmapped", value: summary.unmapped, color: "text-amber-400" },
          ].map((stat) => (
            <div key={stat.label} className="bg-card rounded-xl border border-border p-3 text-center">
              <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Add Settlement</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <input name="settlementRef" required placeholder="Settlement Ref" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="clientName" required placeholder="Client Name" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="clientAccount" placeholder="Client Account" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="asset" required placeholder="Asset (e.g. BTC)" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="amount" required type="number" step="any" placeholder="Amount" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <select name="direction" required className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
              <option value="IN">Inbound</option>
              <option value="OUT">Outbound</option>
            </select>
            <input name="counterparty" placeholder="Counterparty / OES Venue" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <input name="expectedSettleAt" required type="datetime-local" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground" />
            <input name="oesTradeId" placeholder="OES Trade ID" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent/50 text-muted-foreground">Cancel</button>
              <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
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
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, ref, asset..."
            className="pl-9 pr-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground w-64"
          />
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
          <p className="text-sm text-muted-foreground">Loading settlements...</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Ref</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Client</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Dir</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Asset</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground text-right">Amount</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Counterparty</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Expected</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Mapping</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                      No settlements found
                    </td>
                  </tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-foreground">{s.settlementRef}</span>
                        {s.komainuTxId && (
                          <span title={`Komainu TX: ${s.komainuTxId}`}><Link2 size={12} className="text-primary" /></span>
                        )}
                      </div>
                      {s.oesTradeId && (
                        <p className="text-xs text-muted-foreground mt-0.5">OES: {s.oesTradeId}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-foreground">{s.clientName}</p>
                      {s.clientAccount && <p className="text-xs text-muted-foreground">{s.clientAccount}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {s.direction === "IN" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                          <ArrowDownRight size={12} /> IN
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-blue-400 text-xs">
                          <ArrowUpRight size={12} /> OUT
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{s.asset}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-foreground">
                      {s.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{s.counterparty || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={12} />
                        {new Date(s.expectedSettleAt).toLocaleDateString()}
                      </div>
                      {s.actualSettleAt && (
                        <p className="text-xs text-emerald-400 mt-0.5">
                          Settled {new Date(s.actualSettleAt).toLocaleDateString()}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${MAPPING_COLORS[s.mappingStatus] || "bg-muted text-muted-foreground"}`}>
                        {s.mappingStatus}
                      </span>
                      {s.mappingNote && (
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-[150px] truncate" title={s.mappingNote}>
                          {s.mappingNote}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[s.status] || "bg-muted text-muted-foreground"}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {s.status === "pending" && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStatusChange(s.id, "completed", "mapped")}
                            title="Confirm mapped & complete"
                            className="p-1 rounded hover:bg-emerald-500/10 text-emerald-400"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                          <button
                            onClick={() => handleStatusChange(s.id, "pending", "mismatch")}
                            title="Flag mismatch"
                            className="p-1 rounded hover:bg-red-500/10 text-red-400"
                          >
                            <XCircle size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

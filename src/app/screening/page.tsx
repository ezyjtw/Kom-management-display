"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, ScanSearch, Plus, X } from "lucide-react";
import { ClassificationBadge } from "@/components/shared/StatusBadge";
import type { ScreeningEntryData } from "@/types";

interface ScreeningData {
  entries: ScreeningEntryData[];
  summary: {
    total: number;
    submitted: number;
    processing: number;
    notSubmitted: number;
    dust: number;
    scam: number;
    openAlerts: number;
  };
}

type Tab = "health" | "classifications" | "alerts";

export default function ScreeningPage() {
  const [data, setData] = useState<ScreeningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("health");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screening");
      const json = await res.json();
      if (json.success) { setData(json.data); } else { setError(json.error || `Request failed (${res.status})`); }
    } catch (err) { setError(err instanceof Error ? err.message : "Network error"); } finally { setLoading(false); }
  }

  async function handleReclassify(id: string) {
    const classification = prompt("New classification (legitimate, dust, scam):");
    if (!classification || !["legitimate", "dust", "scam"].includes(classification)) return;
    await fetch("/api/screening", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, classification }),
    });
    fetchData();
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await fetch("/api/screening", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: form.get("transactionId"),
        asset: form.get("asset"),
        amount: parseFloat(form.get("amount") as string) || 0,
        direction: form.get("direction"),
        screeningStatus: form.get("screeningStatus"),
      }),
    });
    setShowForm(false);
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading...</div>;
  }

  if (!data) {
    return <div className="text-center py-12"><AlertTriangle size={24} className="mx-auto mb-3 text-red-400" /><p className="text-muted-foreground">Failed to load screening data.</p>{error && <p className="text-xs text-red-400 mt-1">{error}</p>}<button onClick={fetchData} className="mt-3 text-sm text-primary hover:underline">Retry</button></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <ScanSearch size={24} className="text-primary" /> Screening & Scam/Dust
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Transaction screening, classification, and chain analytics alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"><Plus size={16} /> Add Entry</button>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: "Total", value: data.summary.total },
          { label: "Submitted", value: data.summary.submitted },
          { label: "Processing", value: data.summary.processing },
          { label: "Not Submitted", value: data.summary.notSubmitted, color: data.summary.notSubmitted > 0 ? "text-amber-400" : "" },
          { label: "Dust", value: data.summary.dust },
          { label: "Scam", value: data.summary.scam, color: data.summary.scam > 0 ? "text-red-400" : "" },
        ].map((c) => (
          <div key={c.label} className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-xl font-bold ${c.color || "text-foreground"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(["health", "classifications", "alerts"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs rounded-lg border ${tab === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent/50"}`}>
            {t === "health" ? "Screening Health" : t === "classifications" ? "Classifications" : "Analytics Alerts"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3">Transaction ID</th>
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Direction</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Classification</th>
              {tab === "alerts" && <th className="px-4 py-3">Analytics</th>}
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.entries
              .filter((e) => {
                if (tab === "health") return true;
                if (tab === "classifications") return e.classification !== "unclassified" || e.classification === "unclassified";
                if (tab === "alerts") return e.analyticsStatus !== "none";
                return true;
              })
              .map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-accent/20">
                  <td className="px-4 py-3 font-mono text-xs">{e.transactionId}</td>
                  <td className="px-4 py-3">{e.asset}</td>
                  <td className="px-4 py-3">{e.amount}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.direction}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${e.screeningStatus === "completed" ? "bg-emerald-500/10 text-emerald-400" : e.screeningStatus === "not_submitted" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>
                      {e.screeningStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3"><ClassificationBadge classification={e.classification} /></td>
                  {tab === "alerts" && (
                    <td className="px-4 py-3">
                      <span className={`text-xs ${e.analyticsStatus === "open" ? "text-red-400" : e.analyticsStatus === "under_review" ? "text-amber-400" : "text-muted-foreground"}`}>
                        {e.analyticsStatus}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <button onClick={() => handleReclassify(e.id)} className="text-xs text-primary hover:underline">Reclassify</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Add Screening Entry</h3>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <input name="transactionId" placeholder="Transaction ID" required className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg" />
              <div className="grid grid-cols-2 gap-3">
                <input name="asset" placeholder="Asset" required className="px-3 py-2 text-sm bg-background border border-border rounded-lg" />
                <input name="amount" type="number" step="any" placeholder="Amount" className="px-3 py-2 text-sm bg-background border border-border rounded-lg" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select name="direction" className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground">
                  <option value="IN">IN</option>
                  <option value="OUT">OUT</option>
                </select>
                <select name="screeningStatus" className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground">
                  <option value="not_submitted">Not Submitted</option>
                  <option value="submitted">Submitted</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <button type="submit" className="w-full px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create Entry</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

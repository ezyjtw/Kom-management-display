"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, FileSearch, Clock, CheckCircle2, XCircle } from "lucide-react";
import { RcaStatusBadge } from "@/components/shared/StatusBadge";
import type { RcaIncidentEntry } from "@/types";

interface RcaData {
  incidents: RcaIncidentEntry[];
  summary: {
    total: number;
    awaiting: number;
    overdue: number;
    followUp: number;
    closed: number;
  };
}

export default function RcaPage() {
  const [data, setData] = useState<RcaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/rca");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* */ } finally { setLoading(false); }
  }

  async function updateRcaStatus(incidentId: string, rcaStatus: string) {
    await fetch("/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: incidentId, rcaStatus }),
    });
    fetchData();
  }

  async function raiseRca(incidentId: string) {
    const deadline = prompt("SLA deadline (YYYY-MM-DD):");
    await fetch("/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: incidentId,
        rcaStatus: "awaiting_rca",
        rcaRaisedAt: new Date().toISOString(),
        rcaSlaDeadline: deadline ? new Date(deadline).toISOString() : null,
      }),
    });
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading...</div>;
  }

  if (!data) {
    return <div className="text-center py-12"><AlertTriangle size={24} className="mx-auto mb-3 text-red-400" /><p className="text-muted-foreground">Failed to load RCA data.</p></div>;
  }

  const filtered = data.incidents.filter((i) => {
    if (filter === "all") return true;
    if (filter === "overdue") return i.slaOverdue && i.rcaStatus === "awaiting_rca";
    return i.rcaStatus === filter;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSearch size={24} className="text-primary" /> RCA Tracker
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Track root cause analyses across provider incidents</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Total RCAs", value: data.summary.total },
          { label: "Awaiting", value: data.summary.awaiting, color: data.summary.awaiting > 0 ? "text-amber-400" : "" },
          { label: "SLA Overdue", value: data.summary.overdue, color: data.summary.overdue > 0 ? "text-red-400" : "" },
          { label: "Follow-up Pending", value: data.summary.followUp, color: data.summary.followUp > 0 ? "text-orange-400" : "" },
          { label: "Closed", value: data.summary.closed },
        ].map((c) => (
          <div key={c.label} className="bg-card rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-xl font-bold ${c.color || "text-foreground"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {["all", "awaiting_rca", "overdue", "follow_up_pending", "rca_received", "closed"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs rounded-lg border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent/50"}`}>
            {f === "all" ? "All" : f === "overdue" ? "SLA Overdue" : f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {/* RCA items */}
      {filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-400" />
          <p className="text-muted-foreground">No RCA items match the current filter</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((inc) => (
            <div key={inc.id} className={`bg-card rounded-xl border p-4 ${inc.slaOverdue ? "border-red-500/30" : "border-border"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{inc.title}</span>
                    <RcaStatusBadge status={inc.rcaStatus} />
                    {inc.slaOverdue && <span className="text-xs text-red-400 font-medium">SLA OVERDUE</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{inc.provider}</span>
                    <span>&middot; {inc.severity}</span>
                    <span className="flex items-center gap-1"><Clock size={10} /> {inc.ageDays}d age</span>
                    {inc.rcaResponsibleName && <span>&middot; Owner: {inc.rcaResponsibleName}</span>}
                  </div>

                  {/* Follow-up items */}
                  {inc.rcaFollowUpItems.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {inc.rcaFollowUpItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          {item.status === "done" ? (
                            <CheckCircle2 size={12} className="text-emerald-400" />
                          ) : (
                            <XCircle size={12} className="text-muted-foreground" />
                          )}
                          <span className={item.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}>{item.title}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {inc.rcaDocumentRef && (
                    <p className="text-xs text-primary mt-1 truncate">Doc: {inc.rcaDocumentRef}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {inc.rcaStatus === "none" && (
                    <button onClick={() => raiseRca(inc.id)} className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20">Raise RCA</button>
                  )}
                  {inc.rcaStatus === "raised" && (
                    <button onClick={() => updateRcaStatus(inc.id, "awaiting_rca")} className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Mark Awaiting</button>
                  )}
                  {inc.rcaStatus === "awaiting_rca" && (
                    <button onClick={() => updateRcaStatus(inc.id, "rca_received")} className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">RCA Received</button>
                  )}
                  {inc.rcaStatus === "rca_received" && (
                    <button onClick={() => updateRcaStatus(inc.id, "follow_up_pending")} className="px-2 py-1 text-xs bg-orange-500/10 text-orange-400 rounded hover:bg-orange-500/20">Follow-up</button>
                  )}
                  {(inc.rcaStatus === "rca_received" || inc.rcaStatus === "follow_up_pending") && (
                    <button onClick={() => updateRcaStatus(inc.id, "closed")} className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded hover:bg-accent/50">Close</button>
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

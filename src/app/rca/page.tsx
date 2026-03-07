"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, FileSearch, Clock, CheckCircle2, XCircle, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { RcaStatusBadge } from "@/components/shared/StatusBadge";
import { formatDistanceToNow } from "date-fns";

interface RcaFollowUpItem {
  title: string;
  status: "pending" | "done";
  assigneeId?: string;
}

interface RcaIncident {
  id: string;
  title: string;
  provider: string;
  severity: string;
  status: string;
  description: string;
  impact: string;
  rcaStatus: string;
  rcaDocumentRef: string;
  rcaResponsibleId: string | null;
  rcaResponsibleName: string | null;
  rcaSlaDeadline: string | null;
  rcaReceivedAt: string | null;
  rcaRaisedAt: string | null;
  rcaFollowUpItems: RcaFollowUpItem[];
  ageDays: number;
  slaOverdue: boolean;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  reportedByName: string | null;
  updatesCount: number;
}

interface RcaData {
  incidents: RcaIncident[];
  summary: {
    total: number;
    awaiting: number;
    overdue: number;
    followUp: number;
    closed: number;
  };
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400",
  high: "bg-orange-500/10 text-orange-400",
  medium: "bg-amber-500/10 text-amber-400",
  low: "bg-muted text-muted-foreground",
};

const INCIDENT_STATUS_COLORS: Record<string, string> = {
  active: "bg-red-500/10 text-red-400",
  monitoring: "bg-amber-500/10 text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-400",
};

export default function RcaPage() {
  const [data, setData] = useState<RcaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/rca");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* */ } finally { setLoading(false); }
  }

  async function updateRcaStatus(incidentId: string, rcaStatus: string, extra?: Record<string, unknown>) {
    await fetch("/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: incidentId, rcaStatus, ...extra }),
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

  async function setDocumentRef(incidentId: string) {
    const ref = prompt("RCA document URL or reference:");
    if (!ref) return;
    await fetch("/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: incidentId, rcaDocumentRef: ref }),
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
          { label: "Total RCAs", value: data.summary.total, filterKey: "all" },
          { label: "Awaiting RCA", value: data.summary.awaiting, color: data.summary.awaiting > 0 ? "text-amber-400" : "", filterKey: "awaiting_rca" },
          { label: "SLA Overdue", value: data.summary.overdue, color: data.summary.overdue > 0 ? "text-red-400" : "", filterKey: "overdue" },
          { label: "Follow-up Pending", value: data.summary.followUp, color: data.summary.followUp > 0 ? "text-orange-400" : "", filterKey: "follow_up_pending" },
          { label: "Closed", value: data.summary.closed, filterKey: "closed" },
        ].map((c) => (
          <button key={c.label} onClick={() => setFilter(c.filterKey)} className={`bg-card rounded-xl border p-3 text-left transition-colors hover:bg-accent/30 ${filter === c.filterKey ? "border-primary" : "border-border"}`}>
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-xl font-bold ${c.color || "text-foreground"}`}>{c.value}</p>
          </button>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        {["all", "raised", "awaiting_rca", "overdue", "rca_received", "follow_up_pending", "closed"].map((f) => (
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
          {filtered.map((inc) => {
            const isExpanded = expandedId === inc.id;
            const followUpDone = inc.rcaFollowUpItems.filter((i) => i.status === "done").length;
            const followUpTotal = inc.rcaFollowUpItems.length;

            return (
              <div key={inc.id} className={`bg-card rounded-xl border p-4 ${inc.slaOverdue ? "border-red-500/30" : "border-border"}`}>
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setExpandedId(isExpanded ? null : inc.id)} className="text-sm font-medium text-foreground hover:text-primary flex items-center gap-1">
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {inc.title}
                      </button>
                      <RcaStatusBadge status={inc.rcaStatus} />
                      <span className={`text-xs px-2 py-0.5 rounded-full ${SEVERITY_COLORS[inc.severity] || "bg-muted text-muted-foreground"}`}>
                        {inc.severity}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${INCIDENT_STATUS_COLORS[inc.status] || "bg-muted text-muted-foreground"}`}>
                        {inc.status}
                      </span>
                      {inc.slaOverdue && <span className="text-xs text-red-400 font-semibold animate-pulse">SLA OVERDUE</span>}
                    </div>

                    {/* Provider + metadata row */}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span className="font-medium text-foreground/70">{inc.provider}</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> RCA age: {inc.ageDays}d</span>
                      {inc.rcaResponsibleName && <span>Owner: <span className="text-foreground/80">{inc.rcaResponsibleName}</span></span>}
                      {inc.rcaSlaDeadline && (
                        <span className={inc.slaOverdue ? "text-red-400" : ""}>
                          SLA: {formatDistanceToNow(new Date(inc.rcaSlaDeadline), { addSuffix: true })}
                        </span>
                      )}
                      {inc.reportedByName && <span>Reported by: {inc.reportedByName}</span>}
                      <span>Incident started: {formatDistanceToNow(new Date(inc.startedAt), { addSuffix: true })}</span>
                    </div>

                    {/* Follow-up items inline summary */}
                    {followUpTotal > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${followUpDone === followUpTotal ? "bg-emerald-500" : "bg-amber-500"}`}
                            style={{ width: `${(followUpDone / followUpTotal) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{followUpDone}/{followUpTotal} follow-ups done</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {inc.rcaStatus === "raised" && (
                      <button onClick={() => updateRcaStatus(inc.id, "awaiting_rca")} className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Mark Awaiting</button>
                    )}
                    {inc.rcaStatus === "awaiting_rca" && (
                      <button onClick={() => updateRcaStatus(inc.id, "rca_received", { rcaReceivedAt: new Date().toISOString() })} className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">RCA Received</button>
                    )}
                    {inc.rcaStatus === "rca_received" && (
                      <button onClick={() => updateRcaStatus(inc.id, "follow_up_pending")} className="px-2 py-1 text-xs bg-orange-500/10 text-orange-400 rounded hover:bg-orange-500/20">Add Follow-ups</button>
                    )}
                    {(inc.rcaStatus === "rca_received" || inc.rcaStatus === "follow_up_pending") && (
                      <button onClick={() => updateRcaStatus(inc.id, "closed")} className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded hover:bg-accent/50">Close RCA</button>
                    )}
                    {!inc.rcaDocumentRef && inc.rcaStatus !== "raised" && inc.rcaStatus !== "closed" && (
                      <button onClick={() => setDocumentRef(inc.id)} className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20">Link Doc</button>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-border/50 space-y-3">
                    {/* Incident context */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {inc.description && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Incident Description</p>
                          <p className="text-xs text-foreground/80">{inc.description}</p>
                        </div>
                      )}
                      {inc.impact && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Operational Impact</p>
                          <p className="text-xs text-foreground/80">{inc.impact}</p>
                        </div>
                      )}
                    </div>

                    {/* RCA document link */}
                    {inc.rcaDocumentRef && (
                      <div className="flex items-center gap-2">
                        <ExternalLink size={12} className="text-primary" />
                        <span className="text-xs text-muted-foreground">RCA Document:</span>
                        <span className="text-xs text-primary font-medium truncate">{inc.rcaDocumentRef}</span>
                      </div>
                    )}

                    {/* RCA timeline */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">RCA Timeline</p>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs">
                          <div className="w-2 h-2 rounded-full bg-blue-400" />
                          <span className="text-muted-foreground w-28 shrink-0">Incident started</span>
                          <span className="text-foreground/80">{new Date(inc.startedAt).toLocaleString()}</span>
                        </div>
                        {inc.resolvedAt && (
                          <div className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            <span className="text-muted-foreground w-28 shrink-0">Incident resolved</span>
                            <span className="text-foreground/80">{new Date(inc.resolvedAt).toLocaleString()}</span>
                          </div>
                        )}
                        {inc.rcaRaisedAt && (
                          <div className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-amber-400" />
                            <span className="text-muted-foreground w-28 shrink-0">RCA raised</span>
                            <span className="text-foreground/80">{new Date(inc.rcaRaisedAt).toLocaleString()}</span>
                          </div>
                        )}
                        {inc.rcaReceivedAt && (
                          <div className="flex items-center gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            <span className="text-muted-foreground w-28 shrink-0">RCA received</span>
                            <span className="text-foreground/80">{new Date(inc.rcaReceivedAt).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Follow-up checklist */}
                    {followUpTotal > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Follow-up Actions</p>
                        <div className="space-y-1.5">
                          {inc.rcaFollowUpItems.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2 text-xs">
                              {item.status === "done" ? (
                                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                              ) : (
                                <XCircle size={14} className="text-muted-foreground shrink-0" />
                              )}
                              <span className={item.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}>
                                {item.title}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Link to incident detail */}
                    <div className="pt-1">
                      <a href={`/incidents`} className="text-xs text-primary hover:underline flex items-center gap-1">
                        View full incident details <ExternalLink size={10} />
                      </a>
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

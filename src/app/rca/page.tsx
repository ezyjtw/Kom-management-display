"use client";

import { useState, useEffect } from "react";
import {
  RefreshCw, AlertTriangle, FileSearch, Clock, CheckCircle2, XCircle,
  ExternalLink, ChevronDown, ChevronUp, Link2, MessageSquareWarning,
  RotateCcw, Ticket,
} from "lucide-react";
import { RcaStatusBadge } from "@/components/shared/StatusBadge";
import { formatDistanceToNow } from "date-fns";

interface RcaFollowUpItem {
  title: string;
  status: "pending" | "done";
  assigneeId?: string;
}

interface TicketEvent {
  id: string;
  event: string;
  fromStatus: string;
  toStatus: string;
  performedBy: string;
  reason: string;
  createdAt: string;
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
  externalTicketRef: string;
  externalTicketUrl: string;
  externalTicketStatus: string;
  externalTicketLastSyncAt: string | null;
  externalTicketDisputed: boolean;
  externalTicketDisputeReason: string;
  ticketEvents: TicketEvent[];
  prematureClosures: number;
  disputeCount: number;
}

interface RcaData {
  incidents: RcaIncident[];
  summary: {
    total: number;
    awaiting: number;
    overdue: number;
    followUp: number;
    closed: number;
    disputed: number;
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

const EVENT_LABELS: Record<string, string> = {
  status_changed: "Status changed",
  provider_closed: "Provider closed ticket",
  disputed: "Closure disputed",
  reopen_requested: "Reopen requested",
  reopen_confirmed: "Dispute resolved",
  comment_added: "Comment added",
};

const EVENT_COLORS: Record<string, string> = {
  status_changed: "text-blue-400",
  provider_closed: "text-red-400",
  disputed: "text-orange-400",
  reopen_requested: "text-amber-400",
  reopen_confirmed: "text-emerald-400",
};

export default function RcaPage() {
  const [data, setData] = useState<RcaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/rca");
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch { /* */ } finally { setLoading(false); }
  }

  async function syncTickets() {
    setSyncing(true);
    try {
      await fetch("/api/rca/tickets");
      await fetchData();
    } catch { /* */ } finally { setSyncing(false); }
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

  async function linkTicket(incidentId: string) {
    const ticketRef = prompt("External ticket reference (e.g. FB-1234):");
    if (!ticketRef) return;
    await fetch("/api/rca/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId, action: "link", ticketRef }),
    });
    fetchData();
  }

  async function disputeClosure(incidentId: string) {
    const reason = prompt("Why should this ticket not be closed?");
    if (!reason) return;
    const jiraComment = prompt("Comment to post on the Jira ticket (leave blank to skip):");
    await fetch("/api/rca/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId, action: "dispute", reason, jiraComment: jiraComment || "" }),
    });
    fetchData();
  }

  async function requestReopen(incidentId: string) {
    const jiraComment = prompt("Message to provider requesting reopen:");
    if (!jiraComment) return;
    await fetch("/api/rca/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId, action: "reopen_request", reason: jiraComment, jiraComment }),
    });
    fetchData();
  }

  async function resolveDispute(incidentId: string) {
    await fetch("/api/rca/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentId, action: "resolve_dispute", reason: "Ticket reopened by provider" }),
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
    if (filter === "disputed") return i.externalTicketDisputed;
    return i.rcaStatus === filter;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSearch size={24} className="text-primary" /> RCA Tracker
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Track root cause analyses and external provider tickets</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncTickets} disabled={syncing} className="flex items-center gap-2 px-3 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent/50 text-muted-foreground disabled:opacity-50" title="Sync ticket statuses from Jira">
            <Ticket size={16} className={syncing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{syncing ? "Syncing..." : "Sync Tickets"}</span>
          </button>
          <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: "Total RCAs", value: data.summary.total, filterKey: "all" },
          { label: "Awaiting RCA", value: data.summary.awaiting, color: data.summary.awaiting > 0 ? "text-amber-400" : "", filterKey: "awaiting_rca" },
          { label: "SLA Overdue", value: data.summary.overdue, color: data.summary.overdue > 0 ? "text-red-400" : "", filterKey: "overdue" },
          { label: "Follow-up Pending", value: data.summary.followUp, color: data.summary.followUp > 0 ? "text-orange-400" : "", filterKey: "follow_up_pending" },
          { label: "Disputed Closures", value: data.summary.disputed, color: data.summary.disputed > 0 ? "text-red-400" : "", filterKey: "disputed" },
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
        {["all", "raised", "awaiting_rca", "overdue", "disputed", "rca_received", "follow_up_pending", "closed"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-xs rounded-lg border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent/50"}`}>
            {f === "all" ? "All" : f === "overdue" ? "SLA Overdue" : f === "disputed" ? "Disputed" : f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
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
              <div key={inc.id} className={`bg-card rounded-xl border p-4 ${inc.externalTicketDisputed ? "border-red-500/40 bg-red-500/5" : inc.slaOverdue ? "border-red-500/30" : "border-border"}`}>
                {/* Dispute banner */}
                {inc.externalTicketDisputed && (
                  <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <MessageSquareWarning size={16} className="text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-red-400">
                        Provider closed {inc.externalTicketRef} prematurely
                        {inc.prematureClosures > 1 && ` (${inc.prematureClosures} times)`}
                      </p>
                      <p className="text-xs text-red-400/70">{inc.externalTicketDisputeReason}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => requestReopen(inc.id)} className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20 flex items-center gap-1">
                        <RotateCcw size={10} /> Request Reopen
                      </button>
                      <button onClick={() => resolveDispute(inc.id)} className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">
                        Resolved
                      </button>
                    </div>
                  </div>
                )}

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
                      {inc.slaOverdue && !inc.externalTicketDisputed && <span className="text-xs text-red-400 font-semibold animate-pulse">SLA OVERDUE</span>}
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

                      {/* External ticket badge */}
                      {inc.externalTicketRef ? (
                        <span className="flex items-center gap-1">
                          <Ticket size={10} />
                          {inc.externalTicketUrl ? (
                            <a href={inc.externalTicketUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{inc.externalTicketRef}</a>
                          ) : (
                            <span>{inc.externalTicketRef}</span>
                          )}
                          {inc.externalTicketStatus && (
                            <span className={`px-1.5 py-0.5 rounded text-xs ${
                              ["Done", "Closed", "Resolved"].includes(inc.externalTicketStatus) ? "bg-red-500/10 text-red-400" : "bg-blue-500/10 text-blue-400"
                            }`}>
                              {inc.externalTicketStatus}
                            </span>
                          )}
                        </span>
                      ) : (
                        <button onClick={() => linkTicket(inc.id)} className="flex items-center gap-1 text-primary hover:underline">
                          <Link2 size={10} /> Link ticket
                        </button>
                      )}
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
                    {/* Dispute button — show when ticket is closed but RCA isn't done */}
                    {inc.externalTicketRef && !inc.externalTicketDisputed &&
                      ["Done", "Closed", "Resolved"].includes(inc.externalTicketStatus) &&
                      inc.rcaStatus !== "closed" && (
                        <button onClick={() => disputeClosure(inc.id)} className="px-2 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 flex items-center gap-1">
                          <MessageSquareWarning size={10} /> Dispute
                        </button>
                      )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="mt-4 pt-3 border-t border-border/50 space-y-4">
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

                    {/* External ticket history */}
                    {inc.ticketEvents.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                          <Ticket size={12} />
                          External Ticket History — {inc.externalTicketRef}
                          {inc.prematureClosures > 0 && (
                            <span className="text-red-400 ml-2">({inc.prematureClosures} premature closure{inc.prematureClosures !== 1 ? "s" : ""})</span>
                          )}
                        </p>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {inc.ticketEvents.map((evt) => (
                            <div key={evt.id} className="flex items-start gap-2 text-xs">
                              <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                                evt.event === "provider_closed" ? "bg-red-400" :
                                evt.event === "disputed" ? "bg-orange-400" :
                                evt.event === "reopen_confirmed" ? "bg-emerald-400" :
                                "bg-blue-400"
                              }`} />
                              <div className="flex-1 min-w-0">
                                <span className={EVENT_COLORS[evt.event] || "text-muted-foreground"}>
                                  {EVENT_LABELS[evt.event] || evt.event}
                                </span>
                                {evt.fromStatus && evt.toStatus && (
                                  <span className="text-muted-foreground"> ({evt.fromStatus} → {evt.toStatus})</span>
                                )}
                                {evt.reason && <span className="text-muted-foreground"> — {evt.reason}</span>}
                                <p className="text-muted-foreground/60">
                                  {formatDistanceToNow(new Date(evt.createdAt), { addSuffix: true })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
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
                      <a href="/incidents" className="text-xs text-primary hover:underline flex items-center gap-1">
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

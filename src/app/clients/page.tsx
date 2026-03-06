"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  Mail,
  Hash,
  Clock,
  ShieldAlert,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  LogOut,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ClientData {
  name: string;
  threadCount: number;
  messageCount: number;
  externalMessageCount: number;
  openThreads: number;
  highPriorityThreads: number;
  slaBreaches: number;
  sources: string[];
  latestActivity: string;
  severity: number;
  recentThreads: Array<{
    id: string;
    subject: string;
    status: string;
    priority: string;
    source: string;
    messageCount: number;
    createdAt: string;
  }>;
}

interface TravelRuleSummary {
  total: number;
  open: number;
  overdue: number;
  byAsset: Array<{ asset: string; total: number; open: number; overdue: number }>;
}

interface ClientsResponse {
  clients: ClientData[];
  travelRule: TravelRuleSummary;
  period: { days: number; since: string };
}

// Severity thresholds: red (>20), amber (>8), green (<=8)
function severityColor(score: number) {
  if (score >= 20) return "text-red-400";
  if (score >= 8) return "text-amber-400";
  return "text-emerald-400";
}

function severityBg(score: number) {
  if (score >= 20) return "bg-red-500/10 border-red-500/20";
  if (score >= 8) return "bg-amber-500/10 border-amber-500/20";
  return "bg-card border-border";
}

const SOURCE_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  slack: Hash,
  jira: ExternalLink,
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-500/10 text-red-400",
  P1: "bg-orange-500/10 text-orange-400",
  P2: "bg-amber-500/10 text-amber-400",
  P3: "bg-muted text-muted-foreground",
};

const STATUS_COLORS: Record<string, string> = {
  Unassigned: "text-red-400",
  Assigned: "text-blue-400",
  InProgress: "text-blue-400",
  WaitingExternal: "text-amber-400",
  WaitingInternal: "text-amber-400",
  Done: "text-emerald-400",
  Closed: "text-muted-foreground",
};

/**
 * Client Issues Monitor.
 *
 * Aggregates per-client data from comms threads and travel rule cases
 * to identify problem clients: frequent contacts, SLA breaches,
 * high-priority escalations, and recurring transaction issues.
 *
 * Clients are ranked by severity score (weighted sum of issue indicators).
 */
export default function ClientsPage() {
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [days]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients?days=${days}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Failed to load client data");
      }
    } catch {
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Users size={24} className="text-primary" />
            Client Issues Monitor
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Track client communication patterns, SLA breaches, and transaction issues
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="text-sm border border-border rounded-lg px-3 py-2 bg-card text-foreground"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Error state with sign-out option */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
          <AlertTriangle size={24} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-red-400 font-medium mb-1">{error}</p>
          <p className="text-xs text-muted-foreground mb-4">
            If this persists, try signing out and back in.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent/50 text-foreground"
            >
              <RefreshCw size={14} />
              Retry
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 text-red-400"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Analysing client data...
        </div>
      ) : data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Tracked Clients</p>
              <p className="text-2xl font-bold text-foreground">{data.clients.length}</p>
              <p className="text-xs text-muted-foreground mt-1">past {data.period.days} days</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Total Threads</p>
              <p className="text-2xl font-bold text-foreground">
                {data.clients.reduce((s, c) => s + c.threadCount, 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.clients.reduce((s, c) => s + c.openThreads, 0)} open
              </p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">SLA Breaches</p>
              <p className={`text-2xl font-bold ${data.clients.reduce((s, c) => s + c.slaBreaches, 0) > 0 ? "text-red-400" : "text-foreground"}`}>
                {data.clients.reduce((s, c) => s + c.slaBreaches, 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">across all clients</p>
            </div>
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-1">Travel Rule Cases</p>
              <p className="text-2xl font-bold text-foreground">{data.travelRule.total}</p>
              {data.travelRule.overdue > 0 && (
                <p className="text-xs text-red-400 font-medium mt-1">{data.travelRule.overdue} overdue</p>
              )}
              {data.travelRule.overdue === 0 && (
                <p className="text-xs text-muted-foreground mt-1">{data.travelRule.open} open</p>
              )}
            </div>
          </div>

          {/* Transaction issues by asset */}
          {data.travelRule.byAsset.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <ShieldAlert size={16} className="text-primary" />
                Transaction Issues by Asset
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {data.travelRule.byAsset.map((a) => (
                  <div
                    key={a.asset}
                    className={`rounded-lg border p-3 ${a.overdue > 0 ? "bg-red-500/5 border-red-500/20" : a.open > 0 ? "bg-amber-500/5 border-amber-500/20" : "border-border"}`}
                  >
                    <p className="text-sm font-semibold text-foreground">{a.asset}</p>
                    <p className="text-xs text-muted-foreground">{a.total} cases</p>
                    {a.overdue > 0 && <p className="text-xs text-red-400 font-medium">{a.overdue} overdue</p>}
                    {a.overdue === 0 && a.open > 0 && <p className="text-xs text-amber-400">{a.open} open</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Client list */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp size={16} className="text-primary" />
              Clients by Severity
            </h3>

            {data.clients.length === 0 ? (
              <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground text-sm">
                No client activity in the past {data.period.days} days.
              </div>
            ) : (
              data.clients.map((client) => {
                const isExpanded = expandedClient === client.name;
                return (
                  <div
                    key={client.name}
                    className={`rounded-xl border transition-colors ${severityBg(client.severity)}`}
                  >
                    {/* Client header row */}
                    <button
                      onClick={() => setExpandedClient(isExpanded ? null : client.name)}
                      className="w-full flex items-center gap-4 p-4 text-left"
                    >
                      <div className="shrink-0">
                        {isExpanded ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
                      </div>

                      {/* Client name & sources */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground truncate">{client.name}</p>
                          <div className="flex items-center gap-1">
                            {client.sources.map((src) => {
                              const Icon = SOURCE_ICONS[src] || MessageSquare;
                              return <Icon key={src} size={12} className="text-muted-foreground" />;
                            })}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Last activity {formatDistanceToNow(new Date(client.latestActivity), { addSuffix: true })}
                        </p>
                      </div>

                      {/* Stats */}
                      <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs">
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{client.threadCount}</p>
                          <p className="text-muted-foreground">threads</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{client.externalMessageCount}</p>
                          <p className="text-muted-foreground">messages</p>
                        </div>
                        <div className="text-center">
                          <p className={`font-semibold ${client.openThreads > 0 ? "text-amber-400" : "text-foreground"}`}>
                            {client.openThreads}
                          </p>
                          <p className="text-muted-foreground">open</p>
                        </div>
                        {client.slaBreaches > 0 && (
                          <div className="text-center">
                            <p className="font-semibold text-red-400">{client.slaBreaches}</p>
                            <p className="text-red-400">SLA breach</p>
                          </div>
                        )}
                        {client.highPriorityThreads > 0 && (
                          <div className="text-center">
                            <p className="font-semibold text-orange-400">{client.highPriorityThreads}</p>
                            <p className="text-orange-400">P0/P1</p>
                          </div>
                        )}
                      </div>

                      {/* Severity badge */}
                      <div className="shrink-0 text-right">
                        <p className={`text-lg font-bold ${severityColor(client.severity)}`}>
                          {client.severity}
                        </p>
                        <p className="text-xs text-muted-foreground">severity</p>
                      </div>
                    </button>

                    {/* Expanded: recent threads */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-0">
                        {/* Mobile stats */}
                        <div className="flex flex-wrap gap-3 mb-3 sm:hidden text-xs">
                          <span className="text-muted-foreground">{client.threadCount} threads</span>
                          <span className="text-muted-foreground">{client.externalMessageCount} msgs</span>
                          <span className={client.openThreads > 0 ? "text-amber-400" : "text-muted-foreground"}>{client.openThreads} open</span>
                          {client.slaBreaches > 0 && <span className="text-red-400">{client.slaBreaches} SLA breaches</span>}
                        </div>

                        <p className="text-xs font-medium text-muted-foreground mb-2">Recent threads</p>
                        <div className="space-y-1.5">
                          {client.recentThreads.map((t) => (
                            <Link
                              key={t.id}
                              href={`/comms/thread/${t.id}`}
                              className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors bg-background/50"
                            >
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[t.priority] || "bg-muted text-muted-foreground"}`}>
                                {t.priority}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-foreground truncate">{t.subject}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                                  {" · "}{t.messageCount} msg{t.messageCount !== 1 ? "s" : ""}
                                </p>
                              </div>
                              <span className={`text-xs ${STATUS_COLORS[t.status] || "text-muted-foreground"}`}>
                                {t.status.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                            </Link>
                          ))}
                        </div>
                        {client.threadCount > 5 && (
                          <Link
                            href={`/comms?client=${encodeURIComponent(client.name)}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                          >
                            View all {client.threadCount} threads <ExternalLink size={10} />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  Zap,
  ShieldAlert,
  MessageSquare,
  Bell,
  Activity,
  RefreshCw,
  ArrowRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  FolderKanban,
  Eye,
  LogOut,
  Layers,
  ClipboardCheck,
  ScanSearch,
  FileSearch,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface CommandCenterData {
  travelRule: {
    openCount: number;
    redCount: number;
    amberCount: number;
    topUrgent: Array<{
      id: string;
      transactionId: string;
      asset: string;
      direction: string;
      matchStatus: string;
      status: string;
      createdAt: string;
      ageHours: number;
      agingStatus: "green" | "amber" | "red";
    }>;
  };
  comms: {
    totalActive: number;
    breachedCount: number;
    unassignedCount: number;
    topBreached: Array<{
      id: string;
      subject: string;
      priority: string;
      ownerName: string | null;
      slaStatus: {
        isTtoBreached: boolean;
        isTtfaBreached: boolean;
        isTslaBreached: boolean;
      };
    }>;
  };
  alerts: {
    activeCount: number;
    items: Array<{
      id: string;
      type: string;
      priority: string;
      message: string;
      createdAt: string;
    }>;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    userName: string;
    details: string;
    createdAt: string;
  }>;
  dailyTasks: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    urgent: number;
  };
  coverage: {
    total: number;
    active: number;
    onQueues: number;
    onBreak: number;
  };
  projects: {
    activeCount: number;
    onHoldCount: number;
    overdueCount: number;
    items: Array<{
      id: string;
      name: string;
      status: string;
      priority: string;
      progress: number;
      targetDate: string | null;
      team: string;
    }>;
  };
  incidents: {
    activeCount: number;
    monitoringCount: number;
    criticalCount: number;
    items: Array<{
      id: string;
      title: string;
      provider: string;
      severity: string;
      status: string;
      startedAt: string;
    }>;
  };
  staking: {
    total: number;
    overdue: number;
    approaching: number;
    onTime: number;
  };
  dailyChecks: {
    exists: boolean;
    total: number;
    passed: number;
    issues: number;
    pending: number;
  };
  screening: {
    notSubmitted: number;
    dust: number;
    scam: number;
    openAlerts: number;
  };
  rca: {
    total: number;
    awaiting: number;
    overdue: number;
    followUp: number;
  };
}

// Travel rule case aging thresholds: green (<24h), amber (24-48h), red (>48h SLA breach)
const AGING_COLORS = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

// Comms thread priority badges — P0 is critical (outage-level), P3 is routine
const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-500/10 text-red-400",
  P1: "bg-orange-500/10 text-orange-400",
  P2: "bg-amber-500/10 text-amber-400",
  P3: "bg-muted text-muted-foreground",
};

// Human-readable labels for audit log action types
const ACTION_LABELS: Record<string, string> = {
  travel_rule_case_created: "Opened travel rule case",
  travel_rule_case_updated: "Updated travel rule case",
  travel_rule_email_sent: "Sent travel rule email",
  travel_rule_bulk_action: "Bulk action on cases",
  case_note_added: "Added case note",
  ownership_change: "Changed thread ownership",
  status_change: "Changed status",
  config_change: "Updated config",
  manual_score: "Entered score",
  alert_acknowledge: "Acknowledged alert",
  alert_resolve: "Resolved alert",
  on_call_assigned: "Assigned on-call",
  pto_created: "Added PTO record",
  daily_task_created: "Created daily task",
  project_created: "Created project",
  project_update_added: "Updated project",
  incident_created: "Raised incident",
  incident_updated: "Updated incident",
  incident_resolved: "Resolved incident",
};

export default function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/command-center");
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || "Unknown error");
      }
    } catch (err) {
      console.error("Failed to fetch command center data:", err);
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw size={24} className="animate-spin mr-3" />
        Loading command center...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <AlertTriangle size={24} className="mx-auto mb-3 text-red-400" />
        <p className="text-muted-foreground mb-1">
          {error || "Failed to load data."}
        </p>
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
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap size={24} className="text-primary" />
            KOMmand Centre
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Operational overview across all modules
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
        >
          <RefreshCw size={16} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Active incidents banner */}
      {data.incidents.activeCount > 0 && (
        <Link href="/incidents" className={`flex items-center gap-3 p-4 rounded-xl border ${data.incidents.criticalCount > 0 ? "bg-red-500/10 border-red-500/20 animate-pulse" : "bg-amber-500/10 border-amber-500/20"}`}>
          <AlertTriangle size={20} className={data.incidents.criticalCount > 0 ? "text-red-400" : "text-amber-400"} />
          <div className="flex-1">
            <p className={`text-sm font-semibold ${data.incidents.criticalCount > 0 ? "text-red-400" : "text-amber-400"}`}>
              {data.incidents.activeCount} Active Incident{data.incidents.activeCount !== 1 ? "s" : ""}
              {data.incidents.criticalCount > 0 && ` (${data.incidents.criticalCount} critical)`}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.incidents.items.slice(0, 2).map((i) => `${i.provider}: ${i.title}`).join(" · ")}
            </p>
          </div>
          <ArrowRight size={16} className="text-muted-foreground" />
        </Link>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/travel-rule" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ShieldAlert size={14} />
            Travel Rule Cases
          </div>
          <p className="text-2xl font-bold text-foreground">{data.travelRule.openCount}</p>
          {data.travelRule.redCount > 0 && (
            <p className="text-xs text-red-400 font-medium mt-1">
              {data.travelRule.redCount} overdue (&gt;48h)
            </p>
          )}
          {data.travelRule.amberCount > 0 && (
            <p className="text-xs text-amber-400 mt-0.5">
              {data.travelRule.amberCount} aging (24-48h)
            </p>
          )}
        </Link>

        <Link href="/comms?view=overdue" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <AlertTriangle size={14} />
            SLA Breaches
          </div>
          <p className={`text-2xl font-bold ${data.comms.breachedCount > 0 ? "text-red-400" : "text-foreground"}`}>
            {data.comms.breachedCount}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.comms.totalActive} active threads
          </p>
        </Link>

        <Link href="/admin/alerts" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Bell size={14} />
            Active Alerts
          </div>
          <p className={`text-2xl font-bold ${data.alerts.activeCount > 0 ? "text-amber-400" : "text-foreground"}`}>
            {data.alerts.activeCount}
          </p>
          <p className="text-xs text-muted-foreground mt-1">unacknowledged</p>
        </Link>

        <Link href="/schedule" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <CalendarClock size={14} />
            Today&apos;s Tasks
          </div>
          <p className="text-2xl font-bold text-foreground">
            {data.dailyTasks.completed}/{data.dailyTasks.total}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.dailyTasks.inProgress > 0 && <span className="text-blue-400">{data.dailyTasks.inProgress} in progress</span>}
            {data.dailyTasks.urgent > 0 && <span className="text-red-400 ml-2">{data.dailyTasks.urgent} urgent</span>}
            {data.dailyTasks.total === 0 && "no tasks allocated"}
          </p>
        </Link>

        <Link href="/projects" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <FolderKanban size={14} />
            Active Projects
          </div>
          <p className="text-2xl font-bold text-foreground">{data.projects.activeCount}</p>
          {data.projects.overdueCount > 0 && (
            <p className="text-xs text-red-400 font-medium mt-1">
              {data.projects.overdueCount} overdue
            </p>
          )}
          {data.projects.onHoldCount > 0 && (
            <p className="text-xs text-amber-400 mt-0.5">
              {data.projects.onHoldCount} on hold
            </p>
          )}
        </Link>

        <Link href="/activity" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Eye size={14} />
            Team Coverage
          </div>
          <p className="text-2xl font-bold text-foreground">{data.coverage.active}/{data.coverage.total}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.coverage.onQueues > 0 && <span className="text-purple-400">{data.coverage.onQueues} on queues</span>}
            {data.coverage.onBreak > 0 && <span className="text-amber-400 ml-2">{data.coverage.onBreak} on break</span>}
            {data.coverage.total === 0 && "no data"}
          </p>
        </Link>

        <Link href="/staking" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Layers size={14} />
            Staking Ops
          </div>
          <p className="text-2xl font-bold text-foreground">{data.staking.total}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.staking.overdue > 0 && <span className="text-red-400">{data.staking.overdue} overdue</span>}
            {data.staking.approaching > 0 && <span className="text-amber-400 ml-2">{data.staking.approaching} approaching</span>}
            {data.staking.overdue === 0 && data.staking.approaching === 0 && "all on time"}
          </p>
        </Link>

        <Link href="/daily-checks" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ClipboardCheck size={14} />
            Daily Checks
          </div>
          {data.dailyChecks.exists ? (
            <>
              <p className="text-2xl font-bold text-foreground">{data.dailyChecks.passed}/{data.dailyChecks.total}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.dailyChecks.issues > 0 && <span className="text-red-400">{data.dailyChecks.issues} issues</span>}
                {data.dailyChecks.pending > 0 && <span className="text-amber-400 ml-2">{data.dailyChecks.pending} pending</span>}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-amber-400 mt-1">not started today</p>
            </>
          )}
        </Link>

        <Link href="/screening" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ScanSearch size={14} />
            Screening
          </div>
          <p className={`text-2xl font-bold ${data.screening.notSubmitted > 0 ? "text-amber-400" : "text-foreground"}`}>
            {data.screening.notSubmitted}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            not submitted
            {data.screening.scam > 0 && <span className="text-red-400 ml-2">{data.screening.scam} scam</span>}
            {data.screening.openAlerts > 0 && <span className="text-amber-400 ml-2">{data.screening.openAlerts} alerts</span>}
          </p>
        </Link>

        <Link href="/rca" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <FileSearch size={14} />
            RCA Tracker
          </div>
          <p className={`text-2xl font-bold ${data.rca.overdue > 0 ? "text-red-400" : "text-foreground"}`}>
            {data.rca.total}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data.rca.awaiting > 0 && <span className="text-amber-400">{data.rca.awaiting} awaiting</span>}
            {data.rca.overdue > 0 && <span className="text-red-400 ml-2">{data.rca.overdue} overdue</span>}
            {data.rca.followUp > 0 && <span className="text-orange-400 ml-2">{data.rca.followUp} follow-up</span>}
            {data.rca.total === 0 && "no active RCAs"}
          </p>
        </Link>
      </div>

      {/* Two-column detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Urgent Travel Rule Cases */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <ShieldAlert size={16} className="text-primary" />
            Urgent Travel Rule Cases
          </h3>
          {data.travelRule.topUrgent.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open cases.</p>
          ) : (
            <div className="space-y-2">
              {data.travelRule.topUrgent.map((c) => (
                <Link
                  key={c.id}
                  href={`/travel-rule/case/${c.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {c.asset} {c.direction} — {c.transactionId}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.matchStatus.replace(/_/g, " ")}</p>
                  </div>
                  <span className={`text-xs font-semibold ${AGING_COLORS[c.agingStatus]}`}>
                    {c.ageHours < 1 ? `${Math.round(c.ageHours * 60)}m` : c.ageHours < 24 ? `${Math.round(c.ageHours)}h` : `${Math.round(c.ageHours / 24)}d`}
                  </span>
                </Link>
              ))}
            </div>
          )}
          <Link href="/travel-rule" className="flex items-center gap-1 text-xs text-primary hover:underline mt-3">
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {/* SLA-Breached Threads */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Clock size={16} className="text-red-400" />
            SLA-Breached Threads
          </h3>
          {data.comms.topBreached.length === 0 ? (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> All threads within SLA
            </p>
          ) : (
            <div className="space-y-2">
              {data.comms.topBreached.map((t) => (
                <Link
                  key={t.id}
                  href={`/comms/thread/${t.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors"
                >
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[t.priority] || "bg-muted text-muted-foreground"}`}>
                    {t.priority}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{t.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.ownerName || "Unassigned"}
                      {t.slaStatus.isTtoBreached && " — TTO breach"}
                      {t.slaStatus.isTtfaBreached && " — TTFA breach"}
                      {t.slaStatus.isTslaBreached && " — TSLA breach"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <Link href="/comms?view=overdue" className="flex items-center gap-1 text-xs text-primary hover:underline mt-3">
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {/* Active Alerts */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Bell size={16} className="text-amber-400" />
            Active Alerts ({data.alerts.activeCount})
          </h3>
          {data.alerts.items.length === 0 ? (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> No active alerts
            </p>
          ) : (
            <div className="space-y-2">
              {data.alerts.items.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/30"
                >
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${PRIORITY_COLORS[a.priority] || "bg-muted text-muted-foreground"}`}>
                    {a.priority}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground">{a.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link href="/admin/alerts" className="flex items-center gap-1 text-xs text-primary hover:underline mt-3">
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {/* Active Projects */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <FolderKanban size={16} className="text-primary" />
            Projects ({data.projects.activeCount} active)
          </h3>
          {data.projects.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active projects.</p>
          ) : (
            <div className="space-y-2">
              {data.projects.items.slice(0, 5).map((p) => {
                const isOverdue = p.targetDate && new Date(p.targetDate) < new Date() && p.status === "active";
                return (
                  <Link
                    key={p.id}
                    href="/projects"
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.team}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isOverdue && <span className="text-xs text-red-400">Overdue</span>}
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${p.progress >= 75 ? "bg-emerald-500" : p.progress >= 40 ? "bg-blue-500" : "bg-amber-500"}`}
                          style={{ width: `${Math.min(p.progress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8">{p.progress}%</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          <Link href="/projects" className="flex items-center gap-1 text-xs text-primary hover:underline mt-3">
            View all <ArrowRight size={12} />
          </Link>
        </div>

        {/* Recent Activity */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Activity size={16} />
            Recent Activity (24h)
          </h3>
          {data.recentActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent activity.</p>
          ) : (
            <div className="space-y-2">
              {data.recentActivity.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 p-2 text-xs"
                >
                  <Activity size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">
                      <span className="font-medium">{a.userName}</span>
                      {" — "}
                      {ACTION_LABELS[a.action] || a.action.replace(/_/g, " ")}
                    </p>
                    <p className="text-muted-foreground">
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

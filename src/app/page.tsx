"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useBranding } from "@/lib/use-branding";
import {
  Zap,
  ShieldAlert,
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
  Coins,
  TrendingUp,
  TrendingDown,
  Fuel,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
} from "recharts";

// ─── Types ───

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
  tokens: {
    total: number;
    pipeline: number;
    complianceReview: number;
    live: number;
    highDemand: number;
  };
}

interface MarketData {
  prices: Array<{
    id: string;
    symbol: string;
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    sparkline: number[];
    isAlert: boolean;
  }>;
  gas: { low: number; average: number; high: number; isSpike: boolean };
  alerts: Array<{
    type: string;
    asset: string;
    message: string;
    value: number;
    severity: "warning" | "critical";
  }>;
  fetchedAt: string;
}

// ─── Constants ───

const AGING_COLORS = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-500/10 text-red-400",
  P1: "bg-orange-500/10 text-orange-400",
  P2: "bg-amber-500/10 text-amber-400",
  P3: "bg-muted text-muted-foreground",
};

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

// ─── Mini Sparkline Component ───

function Sparkline({ data, color, height = 24 }: { data: number[]; color: string; height?: number }) {
  if (!data || data.length < 2) return null;
  const chartData = data.map((v, i) => ({ v, i }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${color.replace("#", "")})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Main Page ───

export default function CommandCenterPage() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { branding } = useBranding();

  useEffect(() => {
    fetchData();
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 60_000);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/command-center");
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.error || "Unknown error");
    } catch {
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }

  async function fetchMarketData() {
    try {
      const res = await fetch("/api/market-data");
      const json = await res.json();
      if (json.success) setMarket(json.data);
    } catch { /* non-critical */ }
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
        <p className="text-muted-foreground mb-1">{error || "Failed to load data."}</p>
        <p className="text-xs text-muted-foreground mb-4">If this persists, try signing out and back in.</p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={fetchData} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent/50 text-foreground">
            <RefreshCw size={14} /> Retry
          </button>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 text-red-400">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Derived chart data
  const stakingPie = [
    { name: "On Time", value: data.staking.onTime, color: "#10b981" },
    { name: "Approaching", value: data.staking.approaching, color: "#f59e0b" },
    { name: "Overdue", value: data.staking.overdue, color: "#ef4444" },
  ].filter((d) => d.value > 0);

  const dailyChecksBar = data.dailyChecks.exists
    ? [
        { name: "Passed", value: data.dailyChecks.passed, fill: "#10b981" },
        { name: "Issues", value: data.dailyChecks.issues, fill: "#ef4444" },
        { name: "Pending", value: data.dailyChecks.pending, fill: "#6b7280" },
      ]
    : [];

  const tasksPie = [
    { name: "Completed", value: data.dailyTasks.completed, color: "#10b981" },
    { name: "In Progress", value: data.dailyTasks.inProgress, color: "#3b82f6" },
    { name: "Pending", value: data.dailyTasks.pending, color: "#6b7280" },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {branding.logoData ? (
            <img src={branding.logoData} alt={branding.appName} className="h-6 w-6 rounded object-contain" />
          ) : (
            <Zap size={22} className="text-primary" />
          )}
          <h1 className="text-lg md:text-xl font-bold text-foreground">{branding.appName}</h1>
        </div>
        <button onClick={() => { fetchData(); fetchMarketData(); }} className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50">
          <RefreshCw size={14} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* ── Market Ticker ── */}
      {market && market.prices.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Market</span>
            {market.gas.average > 0 && (
              <span className={`ml-auto flex items-center gap-1 text-xs ${market.gas.isSpike ? "text-red-400" : "text-muted-foreground"}`}>
                <Fuel size={12} />
                {market.gas.average} gwei
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {market.prices.map((asset) => (
              <div key={asset.id} className={`rounded-lg p-2 ${asset.isAlert ? "bg-amber-500/5 border border-amber-500/20" : "bg-muted/30"}`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-bold text-foreground">{asset.symbol}</span>
                  <span className={`text-[10px] font-semibold flex items-center ${asset.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {asset.change24h >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {Math.abs(asset.change24h).toFixed(1)}%
                  </span>
                </div>
                <p className="text-xs text-foreground font-medium">
                  ${asset.price >= 1000 ? asset.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : asset.price >= 1 ? asset.price.toFixed(2) : asset.price.toFixed(4)}
                </p>
                <div className="mt-1 h-5">
                  <Sparkline data={asset.sparkline} color={asset.change24h >= 0 ? "#10b981" : "#ef4444"} height={20} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alerts Banner (Incidents + Market) ── */}
      {((market?.alerts && market.alerts.length > 0) || data.incidents.activeCount > 0) && (
        <div className="space-y-2">
          {data.incidents.activeCount > 0 && (
            <Link href="/incidents" className={`flex items-center gap-3 p-3 rounded-xl border ${data.incidents.criticalCount > 0 ? "bg-red-500/10 border-red-500/20 animate-pulse" : "bg-amber-500/10 border-amber-500/20"}`}>
              <AlertTriangle size={16} className={data.incidents.criticalCount > 0 ? "text-red-400" : "text-amber-400"} />
              <div className="flex-1">
                <p className={`text-xs font-semibold ${data.incidents.criticalCount > 0 ? "text-red-400" : "text-amber-400"}`}>
                  {data.incidents.activeCount} Active Incident{data.incidents.activeCount !== 1 ? "s" : ""}
                  {data.incidents.criticalCount > 0 && ` (${data.incidents.criticalCount} critical)`}
                </p>
                <p className="text-[10px] text-muted-foreground">{data.incidents.items.slice(0, 2).map((i) => `${i.provider}: ${i.title}`).join(" · ")}</p>
              </div>
              <ArrowRight size={14} className="text-muted-foreground" />
            </Link>
          )}
          {market?.alerts?.map((alert, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${alert.severity === "critical" ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
              {alert.type === "gas_spike" ? <Fuel size={16} className="text-amber-400" /> : alert.value > 0 ? <TrendingUp size={16} className="text-emerald-400" /> : <TrendingDown size={16} className="text-red-400" />}
              <p className={`text-xs font-semibold ${alert.severity === "critical" ? "text-red-400" : "text-amber-400"}`}>{alert.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Ops Vitals (Top Row) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/comms?view=overdue" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">SLA Breaches</span>
            <AlertTriangle size={12} className={data.comms.breachedCount > 0 ? "text-red-400" : "text-muted-foreground"} />
          </div>
          <p className={`text-2xl font-bold ${data.comms.breachedCount > 0 ? "text-red-400" : "text-foreground"}`}>{data.comms.breachedCount}</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">{data.comms.totalActive} active · {data.comms.unassignedCount} unassigned</span>
            <ArrowRight size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/travel-rule" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Travel Rule</span>
            <ShieldAlert size={12} className={data.travelRule.redCount > 0 ? "text-red-400" : "text-muted-foreground"} />
          </div>
          <p className="text-2xl font-bold text-foreground">{data.travelRule.openCount}</p>
          <div className="flex items-center gap-2 mt-1">
            {data.travelRule.redCount > 0 && <span className="text-[10px] text-red-400 font-medium">{data.travelRule.redCount} overdue</span>}
            {data.travelRule.amberCount > 0 && <span className="text-[10px] text-amber-400">{data.travelRule.amberCount} aging</span>}
            {data.travelRule.redCount === 0 && data.travelRule.amberCount === 0 && <span className="text-[10px] text-muted-foreground">all clear</span>}
            <ArrowRight size={10} className="ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/admin/alerts" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Alerts</span>
            <Bell size={12} className={data.alerts.activeCount > 0 ? "text-amber-400" : "text-muted-foreground"} />
          </div>
          <p className={`text-2xl font-bold ${data.alerts.activeCount > 0 ? "text-amber-400" : "text-foreground"}`}>{data.alerts.activeCount}</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">unacknowledged</span>
            <ArrowRight size={10} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        <Link href="/activity" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors group">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Team Coverage</span>
            <Eye size={12} className="text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground">{data.coverage.active}<span className="text-sm text-muted-foreground font-normal">/{data.coverage.total}</span></p>
          <div className="flex items-center gap-2 mt-1">
            {data.coverage.onQueues > 0 && <span className="text-[10px] text-purple-400">{data.coverage.onQueues} queues</span>}
            {data.coverage.onBreak > 0 && <span className="text-[10px] text-amber-400">{data.coverage.onBreak} break</span>}
            {data.coverage.total === 0 && <span className="text-[10px] text-muted-foreground">no data</span>}
            <ArrowRight size={10} className="ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      </div>

      {/* ── Middle Row: Mini Charts + Ops Modules ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Tasks Donut */}
        <Link href="/schedule" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-1 mb-1">
            <CalendarClock size={12} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Tasks</span>
          </div>
          {tasksPie.length > 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-12 h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tasksPie} dataKey="value" cx="50%" cy="50%" innerRadius={12} outerRadius={22} strokeWidth={0} isAnimationActive={false}>
                      {tasksPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{data.dailyTasks.completed}/{data.dailyTasks.total}</p>
                <p className="text-[10px] text-muted-foreground">done</p>
              </div>
            </div>
          ) : (
            <p className="text-sm font-bold text-muted-foreground mt-2">—</p>
          )}
        </Link>

        {/* Staking Donut */}
        <Link href="/staking" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-1 mb-1">
            <Layers size={12} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Staking</span>
          </div>
          {stakingPie.length > 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-12 h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stakingPie} dataKey="value" cx="50%" cy="50%" innerRadius={12} outerRadius={22} strokeWidth={0} isAnimationActive={false}>
                      {stakingPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{data.staking.total}</p>
                {data.staking.overdue > 0 ? <p className="text-[10px] text-red-400">{data.staking.overdue} overdue</p> : <p className="text-[10px] text-muted-foreground">all good</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm font-bold text-muted-foreground mt-2">—</p>
          )}
        </Link>

        {/* Daily Checks Bar */}
        <Link href="/daily-checks" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-1 mb-1">
            <ClipboardCheck size={12} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Checks</span>
          </div>
          {dailyChecksBar.length > 0 ? (
            <div className="h-12">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChecksBar} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {dailyChecksBar.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-muted-foreground mt-2">—</p>
              <p className="text-[10px] text-amber-400">not started</p>
            </>
          )}
        </Link>

        {/* Screening */}
        <Link href="/screening" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-1 mb-1">
            <ScanSearch size={12} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Screening</span>
          </div>
          <p className={`text-xl font-bold ${data.screening.notSubmitted > 0 ? "text-amber-400" : "text-foreground"}`}>{data.screening.notSubmitted}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">pending</span>
            {data.screening.scam > 0 && <span className="text-[10px] text-red-400">{data.screening.scam} scam</span>}
            {data.screening.openAlerts > 0 && <span className="text-[10px] text-amber-400">{data.screening.openAlerts} alerts</span>}
          </div>
        </Link>

        {/* RCA */}
        <Link href="/rca" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-1 mb-1">
            <FileSearch size={12} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">RCA</span>
          </div>
          <p className={`text-xl font-bold ${data.rca.overdue > 0 ? "text-red-400" : "text-foreground"}`}>{data.rca.total}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {data.rca.awaiting > 0 && <span className="text-[10px] text-amber-400">{data.rca.awaiting} awaiting</span>}
            {data.rca.overdue > 0 && <span className="text-[10px] text-red-400">{data.rca.overdue} overdue</span>}
            {data.rca.total === 0 && <span className="text-[10px] text-muted-foreground">clear</span>}
          </div>
        </Link>

        {/* Tokens */}
        <Link href="/tokens" className="bg-card rounded-xl border border-border p-3 hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-1 mb-1">
            <Coins size={12} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Tokens</span>
          </div>
          <p className="text-xl font-bold text-foreground">{data.tokens.pipeline}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">pipeline</span>
            {data.tokens.complianceReview > 0 && <span className="text-[10px] text-amber-400">{data.tokens.complianceReview} compliance</span>}
            {data.tokens.live > 0 && <span className="text-[10px] text-purple-400">{data.tokens.live} live</span>}
          </div>
        </Link>
      </div>

      {/* ── Bottom: Detail Lists (3-col) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Urgent Travel Rule */}
        <Link href="/travel-rule" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors block">
          <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
            <ShieldAlert size={14} className="text-primary" />
            Urgent Travel Rule
            <span className="ml-auto text-[10px] text-muted-foreground font-normal flex items-center gap-1">View all <ArrowRight size={10} /></span>
          </h3>
          {data.travelRule.topUrgent.length === 0 ? (
            <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> No open cases</p>
          ) : (
            <div className="space-y-1.5">
              {data.travelRule.topUrgent.slice(0, 4).map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.agingStatus === "red" ? "bg-red-400" : c.agingStatus === "amber" ? "bg-amber-400" : "bg-emerald-400"}`} />
                  <span className="text-foreground truncate flex-1">{c.asset} {c.direction} — {c.transactionId.slice(0, 12)}...</span>
                  <span className={`text-[10px] font-semibold ${AGING_COLORS[c.agingStatus]}`}>
                    {c.ageHours < 1 ? `${Math.round(c.ageHours * 60)}m` : c.ageHours < 24 ? `${Math.round(c.ageHours)}h` : `${Math.round(c.ageHours / 24)}d`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Link>

        {/* SLA Breaches */}
        <Link href="/comms?view=overdue" className="bg-card rounded-xl border border-border p-4 hover:bg-accent/30 transition-colors block">
          <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
            <Clock size={14} className="text-red-400" />
            SLA Breaches
            <span className="ml-auto text-[10px] text-muted-foreground font-normal flex items-center gap-1">View all <ArrowRight size={10} /></span>
          </h3>
          {data.comms.topBreached.length === 0 ? (
            <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> All within SLA</p>
          ) : (
            <div className="space-y-1.5">
              {data.comms.topBreached.slice(0, 4).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <span className={`text-[10px] px-1.5 py-0 rounded font-medium ${PRIORITY_COLORS[t.priority] || "bg-muted text-muted-foreground"}`}>{t.priority}</span>
                  <span className="text-foreground truncate flex-1">{t.subject}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{t.ownerName || "Unassigned"}</span>
                </div>
              ))}
            </div>
          )}
        </Link>

        {/* Projects */}
        <div className="bg-card rounded-xl border border-border p-4">
          <Link href="/projects" className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2 hover:underline">
            <FolderKanban size={14} className="text-primary" />
            Projects ({data.projects.activeCount})
            <span className="ml-auto text-[10px] text-muted-foreground font-normal flex items-center gap-1">View all <ArrowRight size={10} /></span>
          </Link>
          {data.projects.items.length === 0 ? (
            <p className="text-xs text-muted-foreground mt-2">No active projects.</p>
          ) : (
            <div className="space-y-1.5 mt-2">
              {data.projects.items.slice(0, 4).map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-xs">
                  <span className="text-foreground truncate flex-1">{p.name}</span>
                  <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
                    <div className={`h-full rounded-full ${p.progress >= 75 ? "bg-emerald-500" : p.progress >= 40 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${p.progress}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-6 text-right">{p.progress}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Activity Feed ── */}
      {data.recentActivity.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
            <Activity size={14} />
            Recent Activity
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
            {data.recentActivity.slice(0, 9).map((a) => (
              <div key={a.id} className="flex items-center gap-2 py-1 text-xs">
                <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                <span className="text-foreground font-medium">{a.userName}</span>
                <span className="text-muted-foreground truncate flex-1">{ACTION_LABELS[a.action] || a.action.replace(/_/g, " ")}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

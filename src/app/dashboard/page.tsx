"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TeamOverviewTable } from "@/components/dashboard/TeamOverviewTable";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { ErrorState } from "@/components/shared/ErrorState";
import { Download, RefreshCw, AlertTriangle, Clock, Users, Activity } from "lucide-react";
import type { EmployeeOverview } from "@/types";

interface CommandCenterData {
  comms: { totalActive: number; breachedCount: number; unassignedCount: number };
  travelRule: { openCount: number; redCount: number; amberCount: number };
  alerts: { activeCount: number };
  incidents: { activeCount: number; criticalCount: number };
  dailyChecks: { exists: boolean; total: number; passed: number; issues: number; pending: number };
  staking: { overdue: number; approaching: number };
  coverage: { total: number; active: number; onQueues: number; onBreak: number };
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read filters from URL params for shareable/restorable state
  const [periodType, setPeriodType] = useState<"week" | "month" | "quarter">(
    (searchParams.get("period") as "week" | "month" | "quarter") || "month"
  );
  const [teamFilter, setTeamFilter] = useState(searchParams.get("team") || "");
  const [roleFilter, setRoleFilter] = useState(searchParams.get("role") || "");
  const [regionFilter, setRegionFilter] = useState(searchParams.get("region") || "");
  const [flagFilter, setFlagFilter] = useState(searchParams.get("flags") || "");

  const [employees, setEmployees] = useState<EmployeeOverview[]>([]);
  const [opsData, setOpsData] = useState<CommandCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Persist filters in URL params
  const updateUrl = useCallback((params: Record<string, string>) => {
    const url = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) url.set(key, value);
    }
    const qs = url.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard", { scroll: false });
  }, [router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scoresRes, opsRes] = await Promise.all([
        fetch(`/api/scores?periodType=${periodType}`),
        fetch("/api/command-center").catch(() => null),
      ]);
      const scoresJson = await scoresRes.json();

      if (scoresJson.success) {
        setEmployees(scoresJson.data || []);
      } else {
        setError(scoresJson.error || "Failed to load scores");
      }

      if (opsRes) {
        const opsJson = await opsRes.json();
        if (opsJson.success) setOpsData(opsJson.data);
      }

      setLastRefreshed(new Date());
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }, [periodType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update URL when filters change
  useEffect(() => {
    updateUrl({ period: periodType, team: teamFilter, role: roleFilter, region: regionFilter, flags: flagFilter });
  }, [periodType, teamFilter, roleFilter, regionFilter, flagFilter, updateUrl]);

  const filteredEmployees = employees.filter((e) => {
    if (teamFilter && e.team !== teamFilter) return false;
    if (roleFilter && e.role !== roleFilter) return false;
    if (regionFilter && e.region !== regionFilter) return false;
    if (flagFilter === "warnings" && e.flags.length === 0) return false;
    if (flagFilter === "critical" && !e.flags.some((f) => f.severity === "critical")) return false;
    return true;
  });

  const teams = [...new Set(employees.map((e) => e.team))];
  const roles = [...new Set(employees.map((e) => e.role))];
  const regions = [...new Set(employees.map((e) => e.region))];

  const clearFilters = () => {
    setTeamFilter("");
    setRoleFilter("");
    setRegionFilter("");
    setFlagFilter("");
  };

  const hasActiveFilters = teamFilter || roleFilter || regionFilter || flagFilter;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Command Centre</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Operational overview with performance scores, SLA status, and active alerts
            {lastRefreshed && (
              <span className="ml-2 text-xs opacity-60">
                Last refreshed: {lastRefreshed.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
          >
            <RefreshCw size={16} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-primary-foreground bg-primary rounded-lg hover:bg-primary/90">
            <Download size={16} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && <ErrorState message={error} onRetry={fetchData} />}

      {/* Operational KPIs Banner */}
      {opsData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className={`bg-card rounded-xl border p-3 ${opsData.comms.unassignedCount > 0 ? "border-amber-500/50" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Users size={12} />
              Unowned Threads
            </div>
            <div className={`text-lg font-bold ${opsData.comms.unassignedCount > 0 ? "text-amber-500" : "text-foreground"}`}>
              {opsData.comms.unassignedCount}
            </div>
          </div>

          <div className={`bg-card rounded-xl border p-3 ${opsData.comms.breachedCount > 0 ? "border-red-500/50" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock size={12} />
              SLA Breached
            </div>
            <div className={`text-lg font-bold ${opsData.comms.breachedCount > 0 ? "text-red-500" : "text-foreground"}`}>
              {opsData.comms.breachedCount}
            </div>
          </div>

          <div className={`bg-card rounded-xl border p-3 ${opsData.travelRule.redCount > 0 ? "border-red-500/50" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <AlertTriangle size={12} />
              Travel Rule Overdue
            </div>
            <div className={`text-lg font-bold ${opsData.travelRule.redCount > 0 ? "text-red-500" : "text-foreground"}`}>
              {opsData.travelRule.redCount}
            </div>
          </div>

          <div className={`bg-card rounded-xl border p-3 ${opsData.alerts.activeCount > 0 ? "border-amber-500/50" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <AlertTriangle size={12} />
              Active Alerts
            </div>
            <div className={`text-lg font-bold ${opsData.alerts.activeCount > 0 ? "text-amber-500" : "text-foreground"}`}>
              {opsData.alerts.activeCount}
            </div>
          </div>

          <div className={`bg-card rounded-xl border p-3 ${opsData.incidents.criticalCount > 0 ? "border-red-500/50" : "border-border"}`}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity size={12} />
              Active Incidents
            </div>
            <div className={`text-lg font-bold ${opsData.incidents.criticalCount > 0 ? "text-red-500" : "text-foreground"}`}>
              {opsData.incidents.activeCount}
              {opsData.incidents.criticalCount > 0 && (
                <span className="text-xs ml-1 text-red-500">({opsData.incidents.criticalCount} crit)</span>
              )}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Users size={12} />
              Team Coverage
            </div>
            <div className="text-lg font-bold text-foreground">
              {opsData.coverage.active}/{opsData.coverage.total}
            </div>
          </div>
        </div>
      )}

      {/* Degraded state banners */}
      {opsData?.dailyChecks?.exists && opsData.dailyChecks.issues > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          Daily checks found {opsData.dailyChecks.issues} issue(s) — {opsData.dailyChecks.pending} pending
        </div>
      )}

      {(opsData?.staking?.overdue ?? 0) > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-700 dark:text-red-400">
          {opsData?.staking?.overdue} staking wallet(s) with overdue rewards
        </div>
      )}

      {/* Stats */}
      <StatsCards employees={filteredEmployees} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 md:gap-4 bg-card rounded-xl border border-border p-3 md:p-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Period</label>
          <select
            value={periodType}
            onChange={(e) => setPeriodType(e.target.value as "week" | "month" | "quarter")}
            className="text-sm border border-border rounded-lg px-3 py-1.5"
          >
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Team</label>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5"
          >
            <option value="">All Teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Role</label>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5"
          >
            <option value="">All Roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Region</label>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5"
          >
            <option value="">All Regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Flags</label>
          <select
            value={flagFilter}
            onChange={(e) => setFlagFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5"
          >
            <option value="">All</option>
            <option value="warnings">With Warnings</option>
            <option value="critical">Critical Only</option>
          </select>
        </div>
        {hasActiveFilters && (
          <div className="flex items-end">
            <button
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline mt-4"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading performance data...
        </div>
      ) : filteredEmployees.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          {employees.length === 0 ? (
            <>
              <Users size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No employees found</p>
              <p className="text-sm mt-1">No scoring data available for the selected period.</p>
            </>
          ) : (
            <>
              <AlertTriangle size={32} className="mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No results match your filters</p>
              <p className="text-sm mt-1">Try adjusting the filters above or <button onClick={clearFilters} className="underline">clear all filters</button>.</p>
            </>
          )}
        </div>
      ) : (
        <TeamOverviewTable employees={filteredEmployees} />
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { TeamOverviewTable } from "@/components/dashboard/TeamOverviewTable";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { ErrorState } from "@/components/shared/ErrorState";
import { Download, RefreshCw } from "lucide-react";
import type { EmployeeOverview } from "@/types";

export default function DashboardPage() {
  const [employees, setEmployees] = useState<EmployeeOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periodType, setPeriodType] = useState<"week" | "month" | "quarter">("month");
  const [teamFilter, setTeamFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/scores?periodType=${periodType}`);
      const json = await res.json();
      if (json.success) {
        setEmployees(json.data || []);
      } else {
        setError(json.error || "Failed to load scores");
      }
    } catch (err) {
      console.error("Failed to fetch scores:", err);
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }, [periodType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredEmployees = employees.filter((e) => {
    if (teamFilter && e.team !== teamFilter) return false;
    if (roleFilter && e.role !== roleFilter) return false;
    return true;
  });

  const teams = [...new Set(employees.map((e) => e.team))];
  const roles = [...new Set(employees.map((e) => e.role))];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Team Overview</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Performance scores across all categories with trends and flags
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
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading performance data...
        </div>
      ) : (
        <TeamOverviewTable employees={filteredEmployees} />
      )}
    </div>
  );
}

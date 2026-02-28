"use client";

import { useState, useEffect } from "react";
import { TeamOverviewTable } from "@/components/dashboard/TeamOverviewTable";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { Download, RefreshCw } from "lucide-react";
import type { EmployeeOverview } from "@/types";

export default function DashboardPage() {
  const [employees, setEmployees] = useState<EmployeeOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodType, setPeriodType] = useState<"week" | "month" | "quarter">("month");
  const [teamFilter, setTeamFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  useEffect(() => {
    fetchData();
  }, [periodType]);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/scores?periodType=${periodType}`);
      const json = await res.json();
      if (json.success) {
        setEmployees(json.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch scores:", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredEmployees = employees.filter((e) => {
    if (teamFilter && e.team !== teamFilter) return false;
    if (roleFilter && e.role !== roleFilter) return false;
    return true;
  });

  const teams = [...new Set(employees.map((e) => e.team))];
  const roles = [...new Set(employees.map((e) => e.role))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Performance scores across all categories with trends and flags
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-primary-foreground bg-primary rounded-lg hover:bg-primary/90">
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsCards employees={filteredEmployees} />

      {/* Filters */}
      <div className="flex items-center gap-4 bg-card rounded-xl border border-border p-4">
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

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Clock,
  Users,
  RefreshCw,
  Coffee,
  Monitor,
  Briefcase,
  BookOpen,
  Eye,
  Utensils,
  ChevronDown,
  BarChart3,
  MapPin,
} from "lucide-react";

interface EmployeeActivity {
  employeeId: string;
  employeeName: string;
  team: string;
  role: string;
  region: string;
  currentActivity: {
    id: string;
    activity: string;
    detail: string;
    startedAt: string;
    elapsedMin: number;
  } | null;
}

interface HistoryEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeTeam: string;
  region: string;
  activity: string;
  detail: string;
  startedAt: string;
  endedAt: string | null;
  durationMin: number | null;
}

// Each activity type has a display label, icon, and colour scheme.
// These categories were chosen to reflect the actual work patterns of the
// Transaction Operations team — BAU (daily operational tasks), queue monitoring
// (watching Fireblocks/settlement queues), and project work alongside standard
// categories like meetings and breaks.
const ACTIVITY_CONFIG: Record<string, { label: string; icon: typeof Activity; color: string; bgColor: string }> = {
  project: { label: "Project", icon: Briefcase, color: "text-blue-400", bgColor: "bg-blue-500/10" },
  bau: { label: "BAU", icon: Monitor, color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  queue_monitoring: { label: "Queue Monitoring", icon: Eye, color: "text-purple-400", bgColor: "bg-purple-500/10" },
  lunch: { label: "Lunch", icon: Utensils, color: "text-amber-400", bgColor: "bg-amber-500/10" },
  break: { label: "Break", icon: Coffee, color: "text-orange-400", bgColor: "bg-orange-500/10" },
  meeting: { label: "Meeting", icon: Users, color: "text-cyan-400", bgColor: "bg-cyan-500/10" },
  admin: { label: "Admin", icon: BookOpen, color: "text-gray-400", bgColor: "bg-gray-500/10" },
  training: { label: "Training", icon: BookOpen, color: "text-pink-400", bgColor: "bg-pink-500/10" },
};

const ACTIVITY_TYPES = Object.keys(ACTIVITY_CONFIG);

const LOCATION_COLORS: Record<string, string> = {
  EMEA: "text-blue-400",
  APAC: "text-emerald-400",
  Americas: "text-amber-400",
};

type ViewMode = "board" | "timeline";

export default function ActivityPage() {
  const [employees, setEmployees] = useState<EmployeeActivity[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [teamFilter, setTeamFilter] = useState("Transaction Operations");
  // Tracks which employee's activity-selector dropdown is open (by employee ID)
  const [changingActivity, setChangingActivity] = useState<string | null>(null);
  const [newActivity, setNewActivity] = useState({ activity: "", detail: "" });

  const fetchCurrent = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity?team=${encodeURIComponent(teamFilter)}`);
      const json = await res.json();
      if (json.success) setEmployees(json.data || []);
    } catch { /* ignore */ }
  }, [teamFilter]);

  const fetchHistory = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch(`/api/activity?history=true&from=${today}&team=${encodeURIComponent(teamFilter)}`);
      const json = await res.json();
      if (json.success) setHistory(json.data || []);
    } catch { /* ignore */ }
  }, [teamFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchCurrent(), fetchHistory()]);
    setLoading(false);
  }, [fetchCurrent, fetchHistory]);

  useEffect(() => {
    loadData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchCurrent, 30000);
    return () => clearInterval(interval);
  }, [loadData, fetchCurrent]);

  async function handleSetActivity(employeeId: string) {
    if (!newActivity.activity) return;
    await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, ...newActivity }),
    });
    setChangingActivity(null);
    setNewActivity({ activity: "", detail: "" });
    fetchCurrent();
    fetchHistory();
  }

  async function handleEndActivity(employeeId: string) {
    await fetch("/api/activity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    fetchCurrent();
    fetchHistory();
  }

  function formatElapsed(min: number) {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  // Group employees by activity type for board view
  const activityGroups = new Map<string, EmployeeActivity[]>();
  activityGroups.set("inactive", []);
  for (const type of ACTIVITY_TYPES) activityGroups.set(type, []);

  for (const emp of employees) {
    const key = emp.currentActivity?.activity || "inactive";
    if (!activityGroups.has(key)) activityGroups.set(key, []);
    activityGroups.get(key)!.push(emp);
  }

  // Coverage stats: "active" means checked in and not on lunch/break,
  // which tells managers how many people are currently working on ops tasks
  const totalStaff = employees.length;
  const activeStaff = employees.filter((e) => e.currentActivity && e.currentActivity.activity !== "lunch" && e.currentActivity.activity !== "break").length;
  const onQueues = employees.filter((e) => e.currentActivity?.activity === "queue_monitoring").length;
  const onBreak = employees.filter((e) => e.currentActivity?.activity === "lunch" || e.currentActivity?.activity === "break").length;

  // Aggregate completed activity durations by type for the time breakdown chart.
  // Only includes entries with a computed durationMin (i.e. already ended).
  const timeTotals = new Map<string, number>();
  for (const entry of history) {
    const dur = entry.durationMin || 0;
    timeTotals.set(entry.activity, (timeTotals.get(entry.activity) || 0) + dur);
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Activity Tracker</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Live status board, time tracking, and coverage monitoring
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="Transaction Operations">Transaction Operations</option>
            <option value="Admin Operations">Admin Operations</option>
            <option value="Data Operations">Data Operations</option>
          </select>
          <button
            onClick={loadData}
            className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Coverage Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Users size={14} />
            Total Staff
          </div>
          <p className="text-xl font-bold text-foreground">{totalStaff}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 text-xs text-emerald-400 mb-1">
            <Activity size={14} />
            Active
          </div>
          <p className="text-xl font-bold text-emerald-400">{activeStaff}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 text-xs text-purple-400 mb-1">
            <Eye size={14} />
            On Queues
          </div>
          <p className="text-xl font-bold text-purple-400">{onQueues}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 text-xs text-amber-400 mb-1">
            <Coffee size={14} />
            On Break/Lunch
          </div>
          <p className="text-xl font-bold text-amber-400">{onBreak}</p>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-1 bg-card rounded-xl border border-border p-1">
        <button
          onClick={() => setViewMode("board")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors flex-1 justify-center ${
            viewMode === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <Users size={16} />
          <span className="hidden sm:inline">Status Board</span>
        </button>
        <button
          onClick={() => setViewMode("timeline")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors flex-1 justify-center ${
            viewMode === "timeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent/50"
          }`}
        >
          <BarChart3 size={16} />
          <span className="hidden sm:inline">Time Breakdown</span>
        </button>
      </div>

      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading...
        </div>
      ) : viewMode === "board" ? (
        <div className="space-y-3">
          {/* Employee cards */}
          {employees.map((emp) => {
            const act = emp.currentActivity;
            const config = act ? ACTIVITY_CONFIG[act.activity] : null;
            const ActIcon = config?.icon || Activity;
            const isChanging = changingActivity === emp.employeeId;

            return (
              <div key={emp.employeeId} className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 flex items-center gap-3">
                  {/* Status indicator */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${act ? "bg-emerald-400" : "bg-gray-500"}`} />

                  {/* Employee info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{emp.employeeName}</span>
                      <span className="text-xs text-muted-foreground">{emp.role}</span>
                      <span className={`text-xs flex items-center gap-0.5 ${LOCATION_COLORS[emp.region] || "text-muted-foreground"}`}>
                        <MapPin size={10} />{emp.region}
                      </span>
                    </div>

                    {/* Current activity */}
                    {act ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${config?.bgColor || ""} ${config?.color || ""}`}>
                          <ActIcon size={12} />
                          {config?.label || act.activity}
                        </span>
                        {act.detail && <span className="text-xs text-muted-foreground">{act.detail}</span>}
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <Clock size={10} />{formatElapsed(act.elapsedMin)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not checked in</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {act && (
                      <button
                        onClick={() => handleEndActivity(emp.employeeId)}
                        className="text-xs px-2 py-1 text-red-400 border border-red-500/20 rounded hover:bg-red-500/10"
                      >
                        End
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setChangingActivity(isChanging ? null : emp.employeeId);
                        setNewActivity({ activity: "", detail: "" });
                      }}
                      className="text-xs px-2 py-1 text-muted-foreground border border-border rounded hover:bg-accent/50"
                    >
                      <ChevronDown size={14} className={isChanging ? "rotate-180 transition-transform" : "transition-transform"} />
                    </button>
                  </div>
                </div>

                {/* Activity selector */}
                {isChanging && (
                  <div className="px-4 py-3 border-t border-border bg-accent/20">
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-3">
                      {ACTIVITY_TYPES.map((type) => {
                        const cfg = ACTIVITY_CONFIG[type];
                        const Icon = cfg.icon;
                        return (
                          <button
                            key={type}
                            onClick={() => setNewActivity({ ...newActivity, activity: type })}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg text-xs border transition-colors ${
                              newActivity.activity === type
                                ? `${cfg.bgColor} ${cfg.color} border-current`
                                : "border-border text-muted-foreground hover:bg-accent/50"
                            }`}
                          >
                            <Icon size={16} />
                            <span className="truncate w-full text-center">{cfg.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={newActivity.detail}
                        onChange={(e) => setNewActivity({ ...newActivity, detail: e.target.value })}
                        placeholder="Detail (e.g. project name, queue name)..."
                        className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
                      />
                      <button
                        onClick={() => handleSetActivity(emp.employeeId)}
                        disabled={!newActivity.activity}
                        className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {employees.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground text-sm">
              No employees found for this team
            </div>
          )}
        </div>
      ) : (
        /* Timeline / Time Breakdown View */
        <div className="space-y-4">
          {/* Time totals */}
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Today&apos;s Time Breakdown (team total)</h3>
            {timeTotals.size === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded today</p>
            ) : (
              <div className="space-y-2">
                {/* Sort activities by total time descending; bar width is relative
                    to the highest total (not a percentage of the day) so even small
                    values are visible */}
                {Array.from(timeTotals.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([activity, totalMin]) => {
                    const cfg = ACTIVITY_CONFIG[activity];
                    const Icon = cfg?.icon || Activity;
                    const maxMin = Math.max(...Array.from(timeTotals.values()));
                    const pct = maxMin > 0 ? (totalMin / maxMin) * 100 : 0;
                    return (
                      <div key={activity} className="flex items-center gap-3">
                        <div className={`flex items-center gap-1 w-32 shrink-0 ${cfg?.color || "text-muted-foreground"}`}>
                          <Icon size={14} />
                          <span className="text-xs">{cfg?.label || activity}</span>
                        </div>
                        <div className="flex-1 h-5 bg-accent/30 rounded overflow-hidden">
                          <div
                            className={`h-full rounded ${cfg?.bgColor || "bg-gray-500/20"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-16 text-right">{formatElapsed(totalMin)}</span>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Activity timeline */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Activity Timeline</h3>
            </div>
            {history.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No activity history for today</div>
            ) : (
              <div className="divide-y divide-border">
                {history.slice(0, 50).map((entry) => {
                  const cfg = ACTIVITY_CONFIG[entry.activity];
                  const Icon = cfg?.icon || Activity;
                  return (
                    <div key={entry.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className={`shrink-0 ${cfg?.color || "text-muted-foreground"}`}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-foreground">{entry.employeeName}</span>
                        <span className="text-xs text-muted-foreground ml-2">{cfg?.label || entry.activity}</span>
                        {entry.detail && <span className="text-xs text-muted-foreground ml-1">- {entry.detail}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {formatTime(entry.startedAt)}
                        {entry.endedAt ? ` — ${formatTime(entry.endedAt)}` : " — now"}
                      </div>
                      {entry.durationMin != null && (
                        <span className="text-xs text-muted-foreground shrink-0 w-12 text-right">{formatElapsed(entry.durationMin)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

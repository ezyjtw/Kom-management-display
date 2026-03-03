"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Calendar,
  Clock,
  Users,
  Plus,
  RefreshCw,
  Sun,
  Palmtree,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

interface Employee {
  id: string;
  name: string;
  team: string;
  role: string;
}

interface OnCallEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  team: string;
  shiftType: string;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  region: string;
}

interface PtoEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeTeam?: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  notes: string;
}

interface DailyTaskEntry {
  id: string;
  date: string;
  team: string;
  assigneeId: string | null;
  assigneeName: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  category: string;
  completedAt: string | null;
  createdByName: string;
}

interface TeamSummary {
  team: string;
  teamLead: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  onCall: Array<{ employeeName: string; shiftType: string }>;
  ptoToday: Array<{ employeeName: string; type: string }>;
  tasks: DailyTaskEntry[];
}

interface DailySummary {
  date: string;
  holidays: Array<{ name: string; region: string }>;
  teams: TeamSummary[];
}

type Tab = "daily" | "oncall" | "holidays" | "pto";

const TEAMS = ["Transaction Operations", "Admin Operations", "Data Operations"];
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500/10 text-red-400 border-red-500/20",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  normal: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  low: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};
const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  in_progress: Loader2,
  pending: Circle,
  skipped: AlertTriangle,
};

export default function SchedulePage() {
  const [activeTab, setActiveTab] = useState<Tab>("daily");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Daily task state
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);

  // On-call state
  const [onCallEntries, setOnCallEntries] = useState<OnCallEntry[]>([]);

  // Holiday state
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  // PTO state
  const [ptoEntries, setPtoEntries] = useState<PtoEntry[]>([]);

  // Forms
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddOnCall, setShowAddOnCall] = useState(false);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [showAddPto, setShowAddPto] = useState(false);

  // Form fields
  const [newTask, setNewTask] = useState({ team: TEAMS[0], title: "", description: "", priority: "normal", category: "operational", assigneeId: "" });
  const [newOnCall, setNewOnCall] = useState({ team: TEAMS[0], employeeId: "", shiftType: "primary" });
  const [newHoliday, setNewHoliday] = useState({ name: "", region: "Global" });
  const [newPto, setNewPto] = useState({ employeeId: "", startDate: selectedDate, endDate: selectedDate, type: "annual_leave", notes: "" });

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      const json = await res.json();
      if (json.success) setEmployees(json.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchDailySummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule/daily-tasks/summary?date=${selectedDate}`);
      const json = await res.json();
      if (json.success) setDailySummary(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedDate]);

  const fetchOnCall = useCallback(async () => {
    setLoading(true);
    try {
      // Get a week around the selected date
      const d = new Date(selectedDate);
      const from = new Date(d.getTime() - 3 * 86400000).toISOString().split("T")[0];
      const to = new Date(d.getTime() + 7 * 86400000).toISOString().split("T")[0];
      const res = await fetch(`/api/schedule/on-call?from=${from}&to=${to}`);
      const json = await res.json();
      if (json.success) setOnCallEntries(json.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedDate]);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const year = new Date(selectedDate).getFullYear();
      const res = await fetch(`/api/schedule/holidays?year=${year}`);
      const json = await res.json();
      if (json.success) setHolidays(json.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedDate]);

  const fetchPto = useCallback(async () => {
    setLoading(true);
    try {
      const d = new Date(selectedDate);
      const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split("T")[0];
      const res = await fetch(`/api/schedule/pto?from=${from}&to=${to}`);
      const json = await res.json();
      if (json.success) setPtoEntries(json.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [selectedDate]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  useEffect(() => {
    if (activeTab === "daily") fetchDailySummary();
    else if (activeTab === "oncall") fetchOnCall();
    else if (activeTab === "holidays") fetchHolidays();
    else if (activeTab === "pto") fetchPto();
  }, [activeTab, selectedDate, fetchDailySummary, fetchOnCall, fetchHolidays, fetchPto]);

  function changeDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().split("T")[0]);
  }

  async function handleAddTask() {
    if (!newTask.title) return;
    await fetch("/api/schedule/daily-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newTask, date: selectedDate, assigneeId: newTask.assigneeId || null }),
    });
    setShowAddTask(false);
    setNewTask({ team: TEAMS[0], title: "", description: "", priority: "normal", category: "operational", assigneeId: "" });
    fetchDailySummary();
  }

  async function handleTaskStatusChange(taskId: string, status: string) {
    await fetch("/api/schedule/daily-tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status }),
    });
    fetchDailySummary();
  }

  async function handleAddOnCall() {
    if (!newOnCall.employeeId) return;
    await fetch("/api/schedule/on-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newOnCall, date: selectedDate }),
    });
    setShowAddOnCall(false);
    setNewOnCall({ team: TEAMS[0], employeeId: "", shiftType: "primary" });
    fetchOnCall();
  }

  async function handleAddHoliday() {
    if (!newHoliday.name) return;
    await fetch("/api/schedule/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newHoliday, date: selectedDate }),
    });
    setShowAddHoliday(false);
    setNewHoliday({ name: "", region: "Global" });
    fetchHolidays();
  }

  async function handleAddPto() {
    if (!newPto.employeeId) return;
    await fetch("/api/schedule/pto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPto),
    });
    setShowAddPto(false);
    setNewPto({ employeeId: "", startDate: selectedDate, endDate: selectedDate, type: "annual_leave", notes: "" });
    fetchPto();
  }

  const tabs: Array<{ key: Tab; label: string; icon: typeof Calendar }> = [
    { key: "daily", label: "Daily Tasks", icon: CheckCircle2 },
    { key: "oncall", label: "On-Call", icon: Clock },
    { key: "holidays", label: "Holidays", icon: Sun },
    { key: "pto", label: "PTO / Leave", icon: Palmtree },
  ];

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Schedule & Tasks</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            On-call schedule, daily task allocation, holidays, and PTO management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeDate(-1)} className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg">
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          />
          <button onClick={() => changeDate(1)} className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Date Display */}
      <div className="text-sm font-medium text-muted-foreground">
        {formatDate(selectedDate)}
        {dailySummary?.holidays && dailySummary.holidays.length > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded text-xs">
            {dailySummary.holidays.map((h) => h.name).join(", ")}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card rounded-xl border border-border p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors flex-1 justify-center ${
              activeTab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <Icon size={16} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading...
        </div>
      ) : activeTab === "daily" ? (
        <DailyTasksView
          summary={dailySummary}
          employees={employees}
          showAdd={showAddTask}
          setShowAdd={setShowAddTask}
          newTask={newTask}
          setNewTask={setNewTask}
          onAdd={handleAddTask}
          onStatusChange={handleTaskStatusChange}
        />
      ) : activeTab === "oncall" ? (
        <OnCallView
          entries={onCallEntries}
          selectedDate={selectedDate}
          employees={employees}
          showAdd={showAddOnCall}
          setShowAdd={setShowAddOnCall}
          newOnCall={newOnCall}
          setNewOnCall={setNewOnCall}
          onAdd={handleAddOnCall}
        />
      ) : activeTab === "holidays" ? (
        <HolidaysView
          holidays={holidays}
          showAdd={showAddHoliday}
          setShowAdd={setShowAddHoliday}
          newHoliday={newHoliday}
          setNewHoliday={setNewHoliday}
          onAdd={handleAddHoliday}
        />
      ) : (
        <PtoView
          entries={ptoEntries}
          employees={employees}
          showAdd={showAddPto}
          setShowAdd={setShowAddPto}
          newPto={newPto}
          setNewPto={setNewPto}
          onAdd={handleAddPto}
        />
      )}
    </div>
  );
}

// ─── Daily Tasks View ───

function DailyTasksView({
  summary,
  employees,
  showAdd,
  setShowAdd,
  newTask,
  setNewTask,
  onAdd,
  onStatusChange,
}: {
  summary: DailySummary | null;
  employees: Employee[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newTask: { team: string; title: string; description: string; priority: string; category: string; assigneeId: string };
  setNewTask: (v: typeof newTask) => void;
  onAdd: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  if (!summary) return <div className="text-muted-foreground text-center py-8">No data available</div>;

  return (
    <div className="space-y-4">
      {/* Add Task button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          <Plus size={16} />
          Add Task
        </button>
      </div>

      {/* Add Task Form */}
      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">New Daily Task</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Team</label>
              <select value={newTask.team} onChange={(e) => setNewTask({ ...newTask, team: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Assign To</label>
              <select value={newTask.assigneeId} onChange={(e) => setNewTask({ ...newTask, assigneeId: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="">Unassigned</option>
                {employees.filter((e) => e.team === newTask.team).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Title</label>
              <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" placeholder="Task title..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Priority</label>
              <select value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Category</label>
              <select value={newTask.category} onChange={(e) => setNewTask({ ...newTask, category: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="operational">Operational</option>
                <option value="compliance">Compliance</option>
                <option value="client">Client</option>
                <option value="administrative">Administrative</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      {/* Team Cards */}
      {summary.teams.map((team) => (
        <div key={team.team} className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Team Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{team.team}</h3>
              <p className="text-xs text-muted-foreground">Lead: {team.teamLead}</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {team.onCall.length > 0 && (
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded">
                  On-call: {team.onCall.map((o) => o.employeeName).join(", ")}
                </span>
              )}
              {team.ptoToday.length > 0 && (
                <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded">
                  PTO: {team.ptoToday.map((p) => p.employeeName).join(", ")}
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">{team.completedTasks}/{team.totalTasks}</span>
              </div>
            </div>
          </div>

          {/* Tasks */}
          {team.tasks.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No tasks allocated</div>
          ) : (
            <div className="divide-y divide-border">
              {team.tasks.map((task) => {
                const StatusIcon = STATUS_ICONS[task.status] || Circle;
                const statusColor = task.status === "completed" ? "text-emerald-400" : task.status === "in_progress" ? "text-blue-400 animate-spin" : "text-muted-foreground";
                return (
                  <div key={task.id} className="px-4 py-3 flex items-center gap-3 hover:bg-accent/30 transition-colors">
                    <button
                      onClick={() => {
                        const next = task.status === "pending" ? "in_progress" : task.status === "in_progress" ? "completed" : "pending";
                        onStatusChange(task.id, next);
                      }}
                      className={statusColor}
                    >
                      <StatusIcon size={18} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${task.status === "completed" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {task.title}
                      </p>
                      {task.assigneeName && (
                        <p className="text-xs text-muted-foreground">{task.assigneeName}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded border ${PRIORITY_COLORS[task.priority] || ""}`}>
                      {task.priority}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{task.category}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── On-Call View ───

function OnCallView({
  entries,
  selectedDate,
  employees,
  showAdd,
  setShowAdd,
  newOnCall,
  setNewOnCall,
  onAdd,
}: {
  entries: OnCallEntry[];
  selectedDate: string;
  employees: Employee[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newOnCall: { team: string; employeeId: string; shiftType: string };
  setNewOnCall: (v: typeof newOnCall) => void;
  onAdd: () => void;
}) {
  // Group entries by date
  const byDate = new Map<string, OnCallEntry[]>();
  entries.forEach((e) => {
    const d = e.date.split("T")[0];
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(e);
  });

  const dates = Array.from(byDate.keys()).sort();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          <Plus size={16} /> Assign On-Call
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Assign On-Call for {selectedDate}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Team</label>
              <select value={newOnCall.team} onChange={(e) => setNewOnCall({ ...newOnCall, team: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Employee</label>
              <select value={newOnCall.employeeId} onChange={(e) => setNewOnCall({ ...newOnCall, employeeId: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="">Select...</option>
                {employees.filter((e) => e.team === newOnCall.team).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Shift</label>
              <select value={newOnCall.shiftType} onChange={(e) => setNewOnCall({ ...newOnCall, shiftType: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="primary">Primary</option>
                <option value="backup">Backup</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Assign</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      {/* Schedule Grid */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Date</th>
                {TEAMS.map((t) => (
                  <th key={t} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No on-call assignments in this range</td></tr>
              ) : (
                dates.map((date) => {
                  const isToday = date === selectedDate;
                  return (
                    <tr key={date} className={`border-b border-border ${isToday ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <span className={`text-sm ${isToday ? "font-semibold text-primary" : "text-foreground"}`}>
                          {new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                      </td>
                      {TEAMS.map((team) => {
                        const teamEntries = byDate.get(date)?.filter((e) => e.team === team) || [];
                        return (
                          <td key={team} className="px-4 py-3">
                            {teamEntries.length === 0 ? (
                              <span className="text-muted-foreground text-xs">—</span>
                            ) : (
                              teamEntries.map((e) => (
                                <div key={e.id} className="flex items-center gap-1">
                                  <Users size={12} className="text-muted-foreground" />
                                  <span className="text-sm text-foreground">{e.employeeName}</span>
                                  {e.shiftType === "backup" && (
                                    <span className="text-xs text-muted-foreground">(backup)</span>
                                  )}
                                </div>
                              ))
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Holidays View ───

function HolidaysView({
  holidays,
  showAdd,
  setShowAdd,
  newHoliday,
  setNewHoliday,
  onAdd,
}: {
  holidays: Holiday[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newHoliday: { name: string; region: string };
  setNewHoliday: (v: typeof newHoliday) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          <Plus size={16} /> Add Holiday
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add Public Holiday</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Holiday Name</label>
              <input value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" placeholder="e.g. Good Friday" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Region</label>
              <select value={newHoliday.region} onChange={(e) => setNewHoliday({ ...newHoliday, region: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="Global">Global</option>
                <option value="EMEA">EMEA</option>
                <option value="APAC">APAC</option>
                <option value="Americas">Americas</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {holidays.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">No holidays recorded for this year</div>
        ) : (
          <div className="divide-y divide-border">
            {holidays.map((h) => {
              const d = new Date(h.date);
              const isPast = d < new Date(new Date().toDateString());
              return (
                <div key={h.id} className={`px-4 py-3 flex items-center gap-4 ${isPast ? "opacity-50" : ""}`}>
                  <Sun size={16} className="text-amber-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{h.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded">{h.region}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PTO View ───

function PtoView({
  entries,
  employees,
  showAdd,
  setShowAdd,
  newPto,
  setNewPto,
  onAdd,
}: {
  entries: PtoEntry[];
  employees: Employee[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newPto: { employeeId: string; startDate: string; endDate: string; type: string; notes: string };
  setNewPto: (v: typeof newPto) => void;
  onAdd: () => void;
}) {
  const typeLabels: Record<string, string> = {
    annual_leave: "Annual Leave",
    sick: "Sick Leave",
    wfh: "WFH",
    other: "Other",
  };

  const typeColors: Record<string, string> = {
    annual_leave: "bg-blue-500/10 text-blue-400",
    sick: "bg-red-500/10 text-red-400",
    wfh: "bg-purple-500/10 text-purple-400",
    other: "bg-gray-500/10 text-gray-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          <Plus size={16} /> Add PTO
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add PTO / Leave</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Employee</label>
              <select value={newPto.employeeId} onChange={(e) => setNewPto({ ...newPto, employeeId: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="">Select...</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.team})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Type</label>
              <select value={newPto.type} onChange={(e) => setNewPto({ ...newPto, type: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="annual_leave">Annual Leave</option>
                <option value="sick">Sick Leave</option>
                <option value="wfh">WFH</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
              <input type="date" value={newPto.startDate} onChange={(e) => setNewPto({ ...newPto, startDate: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">End Date</label>
              <input type="date" value={newPto.endDate} onChange={(e) => setNewPto({ ...newPto, endDate: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">No PTO records for this period</div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                <Palmtree size={16} className="text-emerald-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{p.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {" — "}
                    {new Date(p.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {p.notes && ` · ${p.notes}`}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${typeColors[p.type] || ""}`}>
                  {typeLabels[p.type] || p.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

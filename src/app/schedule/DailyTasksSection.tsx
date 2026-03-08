import {
  Plus,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { DailySummary, Employee } from "./types";
import { TEAMS } from "./types";

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

interface DailyTasksSectionProps {
  summary: DailySummary | null;
  employees: Employee[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newTask: { team: string; title: string; description: string; priority: string; category: string; assigneeId: string };
  setNewTask: (v: DailyTasksSectionProps["newTask"]) => void;
  onAdd: () => void;
  onStatusChange: (id: string, status: string) => void;
}

export default function DailyTasksSection({
  summary,
  employees,
  showAdd,
  setShowAdd,
  newTask,
  setNewTask,
  onAdd,
  onStatusChange,
}: DailyTasksSectionProps) {
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

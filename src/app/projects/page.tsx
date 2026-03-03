"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FolderKanban,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  Users,
  MessageSquare,
  Target,
  AlertTriangle,
  CheckCircle2,
  Pause,
  Circle,
  Send,
} from "lucide-react";

interface Employee {
  id: string;
  name: string;
  team: string;
  role: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  team: string;
  leadId: string;
  leadName: string;
  status: string;
  priority: string;
  startDate: string | null;
  targetDate: string | null;
  progress: number;
  tags: string[];
  memberCount: number;
  latestUpdate: string | null;
  latestUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectUpdate {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  type: string;
  progress: number | null;
  createdAt: string;
}

const TEAMS = ["Transaction Operations", "Admin Operations", "Data Operations"];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Circle }> = {
  planned: { label: "Planned", color: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: Circle },
  active: { label: "Active", color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: Target },
  on_hold: { label: "On Hold", color: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Pause },
  completed: { label: "Completed", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", color: "bg-red-500/10 text-red-400 border-red-500/20", icon: AlertTriangle },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400",
  high: "bg-orange-500/10 text-orange-400",
  medium: "bg-blue-500/10 text-blue-400",
  low: "bg-gray-500/10 text-gray-400",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teamFilter, setTeamFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);

  // New project form
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "", description: "", team: TEAMS[0], leadId: "", priority: "medium",
    startDate: new Date().toISOString().split("T")[0], targetDate: "", tags: "",
  });

  // New update form
  const [newUpdate, setNewUpdate] = useState({ content: "", type: "progress", progress: "" });

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (teamFilter) params.set("team", teamFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/projects?${params}`);
      const json = await res.json();
      if (json.success) setProjects(json.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamFilter, statusFilter]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      const json = await res.json();
      if (json.success) setEmployees(json.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchUpdates = useCallback(async (projectId: string) => {
    setLoadingUpdates(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/updates`);
      const json = await res.json();
      if (json.success) setUpdates(json.data || []);
    } catch { /* ignore */ }
    setLoadingUpdates(false);
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setUpdates([]);
    } else {
      setExpandedId(id);
      fetchUpdates(id);
    }
  }

  async function handleAddProject() {
    if (!newProject.name || !newProject.leadId) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newProject,
        tags: newProject.tags ? newProject.tags.split(",").map((t) => t.trim()) : [],
        targetDate: newProject.targetDate || null,
      }),
    });
    setShowAddProject(false);
    setNewProject({ name: "", description: "", team: TEAMS[0], leadId: "", priority: "medium", startDate: new Date().toISOString().split("T")[0], targetDate: "", tags: "" });
    fetchProjects();
  }

  async function handleAddUpdate(projectId: string) {
    if (!newUpdate.content) return;
    await fetch(`/api/projects/${projectId}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: newUpdate.content,
        type: newUpdate.type,
        progress: newUpdate.progress ? parseInt(newUpdate.progress) : undefined,
      }),
    });
    setNewUpdate({ content: "", type: "progress", progress: "" });
    fetchUpdates(projectId);
    fetchProjects();
  }

  // Stats
  const totalActive = projects.filter((p) => p.status === "active").length;
  const totalOnHold = projects.filter((p) => p.status === "on_hold").length;
  const avgProgress = projects.length > 0
    ? Math.round(projects.filter((p) => p.status === "active").reduce((sum, p) => sum + p.progress, 0) / Math.max(totalActive, 1))
    : 0;
  const overdue = projects.filter((p) => p.targetDate && new Date(p.targetDate) < new Date() && p.status === "active").length;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Track project progress, blockers, and team workload
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchProjects} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50">
            <RefreshCw size={16} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button onClick={() => setShowAddProject(!showAddProject)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            <Plus size={16} />
            <span className="hidden sm:inline">New Project</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Active Projects</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totalActive}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">On Hold</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{totalOnHold}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Avg Progress</p>
          <p className="text-2xl font-bold text-blue-400 mt-1">{avgProgress}%</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs text-muted-foreground">Overdue</p>
          <p className={`text-2xl font-bold mt-1 ${overdue > 0 ? "text-red-400" : "text-emerald-400"}`}>{overdue}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-card rounded-xl border border-border p-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Team</label>
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="">All Teams</option>
            {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
            <option value="">All Statuses</option>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* New Project Form */}
      {showAddProject && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">New Project</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Project Name</label>
              <input value={newProject.name} onChange={(e) => setNewProject({ ...newProject, name: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" placeholder="e.g. Custody Onboarding Automation" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <textarea value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" rows={2} placeholder="Brief description..." />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Team</label>
              <select value={newProject.team} onChange={(e) => setNewProject({ ...newProject, team: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Lead</label>
              <select value={newProject.leadId} onChange={(e) => setNewProject({ ...newProject, leadId: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="">Select lead...</option>
                {employees.filter((e) => e.team === newProject.team && (e.role === "Lead" || e.role === "Senior")).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Priority</label>
              <select value={newProject.priority} onChange={(e) => setNewProject({ ...newProject, priority: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Target Date</label>
              <input type="date" value={newProject.targetDate} onChange={(e) => setNewProject({ ...newProject, targetDate: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Tags (comma-separated)</label>
              <input value={newProject.tags} onChange={(e) => setNewProject({ ...newProject, tags: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" placeholder="e.g. automation, compliance, Q1" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddProject} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create Project</button>
            <button onClick={() => setShowAddProject(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      {/* Project List */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <FolderKanban size={32} className="mx-auto mb-3 opacity-50" />
          <p>No projects found</p>
          <p className="text-xs mt-1">Create a project to start tracking progress</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const isExpanded = expandedId === project.id;
            const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.planned;
            const StatusIcon = statusCfg.icon;
            const isOverdue = project.targetDate && new Date(project.targetDate) < new Date() && project.status === "active";

            return (
              <div key={project.id} className="bg-card rounded-xl border border-border overflow-hidden">
                {/* Project Header */}
                <button
                  onClick={() => toggleExpand(project.id)}
                  className="w-full px-4 py-4 flex items-center gap-4 hover:bg-accent/30 transition-colors text-left"
                >
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FolderKanban size={18} className="text-primary" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground">{project.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded border ${statusCfg.color}`}>
                        <StatusIcon size={10} className="inline mr-1" />
                        {statusCfg.label}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${PRIORITY_COLORS[project.priority] || ""}`}>
                        {project.priority}
                      </span>
                      {isOverdue && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400">Overdue</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{project.team}</span>
                      <span>Lead: {project.leadName}</span>
                      <span className="flex items-center gap-1"><Users size={12} /> {project.memberCount}</span>
                      {project.targetDate && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          Due {new Date(project.targetDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Progress Bar */}
                  <div className="flex-shrink-0 w-32 hidden md:block">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>{project.progress}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          project.progress >= 100 ? "bg-emerald-500" : project.progress >= 50 ? "bg-blue-500" : "bg-amber-500"
                        }`}
                        style={{ width: `${Math.min(project.progress, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                  </div>
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Description */}
                    {project.description && (
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-sm text-muted-foreground">{project.description}</p>
                      </div>
                    )}

                    {/* Tags */}
                    {project.tags.length > 0 && (
                      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                        {project.tags.map((tag) => (
                          <span key={tag} className="text-xs px-2 py-0.5 bg-accent/50 text-accent-foreground rounded">{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* Mobile progress */}
                    <div className="px-4 py-3 border-b border-border md:hidden">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span>{project.progress}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${project.progress >= 100 ? "bg-emerald-500" : project.progress >= 50 ? "bg-blue-500" : "bg-amber-500"}`}
                          style={{ width: `${Math.min(project.progress, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Add Update */}
                    <div className="px-4 py-3 border-b border-border space-y-2">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={14} className="text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Add Update</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={newUpdate.content}
                          onChange={(e) => setNewUpdate({ ...newUpdate, content: e.target.value })}
                          className="flex-1 text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
                          placeholder="What's the latest progress?"
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddUpdate(project.id); }}
                        />
                        <select
                          value={newUpdate.type}
                          onChange={(e) => setNewUpdate({ ...newUpdate, type: e.target.value })}
                          className="text-sm border border-border rounded-lg px-2 py-1.5 bg-card text-foreground"
                        >
                          <option value="progress">Progress</option>
                          <option value="blocker">Blocker</option>
                          <option value="milestone">Milestone</option>
                          <option value="note">Note</option>
                        </select>
                        <input
                          value={newUpdate.progress}
                          onChange={(e) => setNewUpdate({ ...newUpdate, progress: e.target.value })}
                          className="w-16 text-sm border border-border rounded-lg px-2 py-1.5 bg-card text-foreground text-center"
                          placeholder="%"
                          type="number"
                          min="0"
                          max="100"
                        />
                        <button
                          onClick={() => handleAddUpdate(project.id)}
                          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Updates Timeline */}
                    <div className="px-4 py-3">
                      <h4 className="text-xs font-medium text-muted-foreground mb-3">Activity</h4>
                      {loadingUpdates ? (
                        <div className="text-center py-4">
                          <RefreshCw size={16} className="mx-auto animate-spin text-muted-foreground" />
                        </div>
                      ) : updates.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">No updates yet</p>
                      ) : (
                        <div className="space-y-3">
                          {updates.map((u) => {
                            const typeColors: Record<string, string> = {
                              progress: "border-blue-500",
                              blocker: "border-red-500",
                              milestone: "border-emerald-500",
                              note: "border-gray-500",
                            };
                            const typeLabels: Record<string, string> = {
                              progress: "Progress",
                              blocker: "Blocker",
                              milestone: "Milestone",
                              note: "Note",
                            };
                            return (
                              <div key={u.id} className={`border-l-2 ${typeColors[u.type] || "border-gray-500"} pl-3`}>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">{u.authorName}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    u.type === "blocker" ? "bg-red-500/10 text-red-400" :
                                    u.type === "milestone" ? "bg-emerald-500/10 text-emerald-400" :
                                    "bg-blue-500/10 text-blue-400"
                                  }`}>
                                    {typeLabels[u.type] || u.type}
                                  </span>
                                  {u.progress !== null && (
                                    <span className="text-blue-400">{u.progress}%</span>
                                  )}
                                  <span>{new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                                <p className="text-sm text-foreground mt-0.5">{u.content}</p>
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
          })}
        </div>
      )}
    </div>
  );
}

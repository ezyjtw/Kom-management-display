"use client";

import { useState, useEffect, useCallback } from "react";
import { ThreadList } from "@/components/comms/ThreadList";
import { ErrorState } from "@/components/shared/ErrorState";
import {
  Inbox,
  User,
  Clock,
  AlertTriangle,
  RefreshCw,
  Filter,
  Sparkles,
  Check,
  X,
} from "lucide-react";
import type { ThreadSummary } from "@/types";

type ViewTab = "all" | "unassigned" | "my_threads" | "overdue";

const viewTabs: { key: ViewTab; label: string; icon: typeof Inbox }[] = [
  { key: "all", label: "All Threads", icon: Inbox },
  { key: "unassigned", label: "Unassigned", icon: Clock },
  { key: "my_threads", label: "My Threads", icon: User },
  { key: "overdue", label: "Overdue / SLA Breach", icon: AlertTriangle },
];

export default function CommsPage() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewTab>("all");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [queueFilter, setQueueFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  // AI triage suggestions: threadId → { priority, reason }
  const [triageSuggestions, setTriageSuggestions] = useState<Record<string, { priority: string; reason: string }>>({});
  const [triaging, setTriaging] = useState(false);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("view", activeView);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (queueFilter) params.set("queue", queueFilter);
      if (sourceFilter) params.set("source", sourceFilter);

      const res = await fetch(`/api/comms/threads?${params}`);
      const json = await res.json();
      if (json.success) {
        setThreads(json.data || []);
      } else {
        setError(json.error || "Failed to load threads");
      }
    } catch (err) {
      console.error("Failed to fetch threads:", err);
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }, [activeView, priorityFilter, queueFilter, sourceFilter]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const filteredThreads = threads.filter((t) => {
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (queueFilter && t.queue !== queueFilter) return false;
    if (sourceFilter && t.source !== sourceFilter) return false;
    return true;
  });

  const overdueCount = threads.filter(
    (t) =>
      t.slaStatus.isTtoBreached || t.slaStatus.isTtfaBreached || t.slaStatus.isTslaBreached
  ).length;

  const unassignedCount = threads.filter((t) => t.status === "Unassigned").length;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Communications</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Manage inbound emails and Slack messages — track ownership and SLAs
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={async () => {
              setTriaging(true);
              const unassigned = threads.filter((t) => t.status === "Unassigned" || t.priority === "P2" || t.priority === "P3");
              const suggestions: Record<string, { priority: string; reason: string }> = {};
              // Triage up to 5 threads at a time
              for (const t of unassigned.slice(0, 5)) {
                try {
                  const res = await fetch("/api/ai/assist", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "triage_thread",
                      data: { subject: t.subject, source: t.source, clientOrPartnerTag: t.clientOrPartnerTag },
                    }),
                  });
                  const json = await res.json();
                  if (json.success && json.data?.suggestion) {
                    suggestions[t.id] = json.data.suggestion;
                  }
                } catch { /* skip failed threads */ }
              }
              setTriageSuggestions(suggestions);
              setTriaging(false);
            }}
            disabled={triaging || threads.length === 0}
            className="flex items-center gap-2 px-3 py-2 text-sm text-primary bg-primary/10 border border-primary/20 rounded-lg hover:bg-primary/20 disabled:opacity-50"
          >
            {triaging ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            <span className="hidden sm:inline">{triaging ? "Triaging..." : "AI Triage"}</span>
          </button>
          <button
            onClick={fetchThreads}
            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
          >
            <RefreshCw size={16} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && <ErrorState message={error} onRetry={fetchThreads} />}

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Threads</p>
          <p className="text-xl font-bold">{threads.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Unassigned</p>
          <p className={`text-xl font-bold ${unassignedCount > 0 ? "text-amber-600" : ""}`}>
            {unassignedCount}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">SLA Breaching</p>
          <p className={`text-xl font-bold ${overdueCount > 0 ? "text-red-600" : ""}`}>
            {overdueCount}
          </p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-xl font-bold">
            {threads.filter((t) => !["Done", "Closed"].includes(t.status)).length}
          </p>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1 overflow-x-auto">
        {viewTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-lg transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Icon size={16} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.key === "overdue" ? "Overdue" : tab.key === "my_threads" ? "Mine" : tab.label}</span>
              {tab.key === "overdue" && overdueCount > 0 && (
                <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {overdueCount}
                </span>
              )}
              {tab.key === "unassigned" && unassignedCount > 0 && (
                <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {unassignedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 bg-card border border-border rounded-xl p-3">
        <Filter size={16} className="text-muted-foreground hidden sm:block" />
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5"
        >
          <option value="">All Priorities</option>
          <option value="P0">P0 - Critical</option>
          <option value="P1">P1 - High</option>
          <option value="P2">P2 - Medium</option>
          <option value="P3">P3 - Low</option>
        </select>
        <select
          value={queueFilter}
          onChange={(e) => setQueueFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5"
        >
          <option value="">All Queues</option>
          <option value="Admin Operations">Admin Operations</option>
          <option value="Transaction Operations">Transaction Operations</option>
          <option value="Data Operations">Data Operations</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5"
        >
          <option value="">All Sources</option>
          <option value="email">Email</option>
          <option value="slack">Slack</option>
          <option value="jira">Jira</option>
        </select>
      </div>

      {/* AI Triage Suggestions */}
      {Object.keys(triageSuggestions).length > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles size={14} className="text-primary" />
              AI Priority Suggestions
              <span className="text-muted-foreground font-normal">— review and approve</span>
            </p>
            <button
              onClick={() => setTriageSuggestions({})}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss all
            </button>
          </div>
          <div className="space-y-2">
            {Object.entries(triageSuggestions).map(([threadId, suggestion]) => {
              const thread = threads.find((t) => t.id === threadId);
              if (!thread) return null;
              const changed = thread.priority !== suggestion.priority;
              return (
                <div key={threadId} className="flex items-center gap-3 p-2.5 rounded-lg bg-card/50 text-sm">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    suggestion.priority === "P0" ? "bg-red-500/10 text-red-400" :
                    suggestion.priority === "P1" ? "bg-orange-500/10 text-orange-400" :
                    suggestion.priority === "P2" ? "bg-amber-500/10 text-amber-400" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {suggestion.priority}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground truncate">{thread.subject}</p>
                    <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                  </div>
                  {changed ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-muted-foreground">was {thread.priority}</span>
                      <button
                        onClick={async () => {
                          await fetch(`/api/comms/threads/${threadId}/status`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ priority: suggestion.priority }),
                          });
                          setTriageSuggestions((prev) => {
                            const next = { ...prev };
                            delete next[threadId];
                            return next;
                          });
                          fetchThreads();
                        }}
                        className="p-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                        title="Accept suggestion"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setTriageSuggestions((prev) => {
                          const next = { ...prev };
                          delete next[threadId];
                          return next;
                        })}
                        className="p-1 rounded bg-muted text-muted-foreground hover:text-foreground"
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-emerald-400 shrink-0">Priority correct</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Thread List */}
      {loading ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading threads...
        </div>
      ) : (
        <ThreadList threads={filteredThreads} />
      )}
    </div>
  );
}

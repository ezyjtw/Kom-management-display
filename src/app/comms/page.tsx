"use client";

import { useState, useEffect } from "react";
import { ThreadList } from "@/components/comms/ThreadList";
import {
  Inbox,
  User,
  Clock,
  AlertTriangle,
  RefreshCw,
  Filter,
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
  const [activeView, setActiveView] = useState<ViewTab>("all");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [queueFilter, setQueueFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  useEffect(() => {
    fetchThreads();
  }, [activeView]);

  async function fetchThreads() {
    setLoading(true);
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
      }
    } catch (err) {
      console.error("Failed to fetch threads:", err);
    } finally {
      setLoading(false);
    }
  }

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage inbound emails and Slack messages — track ownership and SLAs
          </p>
        </div>
        <button
          onClick={fetchThreads}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

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
      <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1">
        {viewTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Icon size={16} />
              {tab.label}
              {tab.key === "overdue" && overdueCount > 0 && (
                <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full ml-1">
                  {overdueCount}
                </span>
              )}
              {tab.key === "unassigned" && unassignedCount > 0 && (
                <span className="bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full ml-1">
                  {unassignedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-card border border-border rounded-xl p-3">
        <Filter size={16} className="text-muted-foreground" />
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
          <option value="Ops">Ops</option>
          <option value="Settlements">Settlements</option>
          <option value="StakingOps">Staking Ops</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-sm border border-border rounded-lg px-3 py-1.5"
        >
          <option value="">All Sources</option>
          <option value="email">Email</option>
          <option value="slack">Slack</option>
        </select>
      </div>

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

"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Play, Pause, Clock, CheckCircle2, XCircle, AlertTriangle, Cog } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface JobSummary {
  pending: number;
  running: number;
  failed: number;
  completed: number;
}

interface RecurringJob {
  id: string;
  type: string;
  status: string;
  cronExpression: string;
  lastRunAt: string | null;
  nextRunAt: string;
  attempts: number;
  error: string;
}

const STATUS_ICONS: Record<string, typeof Clock> = {
  pending: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: XCircle,
  retrying: AlertTriangle,
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400 animate-spin",
  completed: "text-emerald-400",
  failed: "text-red-400",
  retrying: "text-orange-400",
};

const JOB_LABELS: Record<string, string> = {
  sync_slack: "Slack Sync",
  sync_email: "Email Sync",
  sync_jira: "Jira Sync",
  check_sla: "SLA Monitor",
  check_staking: "Staking Heartbeat",
  poll_komainu: "Komainu Poll",
  check_confirmations: "Confirmation Expiry",
  cleanup_sessions: "Session Cleanup",
};

export default function JobsPage() {
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [jobs, setJobs] = useState<RecurringJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs");
      const json = await res.json();
      if (json.success) {
        setSummary(json.data.summary);
        setJobs(json.data.recurringJobs);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function registerDefaults() {
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register_defaults" }),
    });
    fetchData();
  }

  async function triggerJob(type: string) {
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "trigger", type }),
    });
    fetchData();
  }

  async function processNext() {
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "process_next" }),
    });
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading jobs...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <Cog size={24} /> Background Jobs
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={processNext} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md">
            <Play size={14} /> Process Next
          </button>
          <button onClick={registerDefaults} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">
            <Cog size={14} /> Register Defaults
          </button>
          <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Queue summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Pending", value: summary.pending, color: "text-yellow-400" },
            { label: "Running", value: summary.running, color: "text-blue-400" },
            { label: "Failed", value: summary.failed, color: "text-red-400" },
            { label: "Completed", value: summary.completed, color: "text-emerald-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">{label}</div>
              <div className={`text-lg font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Recurring jobs */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Recurring Jobs</h2>
        {jobs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No recurring jobs registered.</p>
            <button onClick={registerDefaults} className="mt-2 text-sm text-primary hover:underline">Register default jobs</button>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => {
              const StatusIcon = STATUS_ICONS[job.status] || Clock;
              return (
                <div key={job.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusIcon size={16} className={STATUS_COLORS[job.status] || "text-muted-foreground"} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-foreground">{JOB_LABELS[job.type] || job.type}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="font-mono">{job.cronExpression}</span>
                        {job.lastRunAt && <span>Last: {formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })}</span>}
                        <span>Next: {formatDistanceToNow(new Date(job.nextRunAt), { addSuffix: true })}</span>
                      </div>
                      {job.error && <div className="text-xs text-red-400 truncate">{job.error}</div>}
                    </div>
                  </div>
                  <button
                    onClick={() => triggerJob(job.type)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded"
                    title="Trigger now"
                  >
                    <Play size={12} /> Run Now
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { Shield, RefreshCw } from "lucide-react";

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchLogs();
  }, [page]);

  async function fetchLogs() {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?page=${page}&pageSize=25`);
      const json = await res.json();
      if (json.success) {
        setLogs(json.data || []);
        setTotal(json.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const actionColors: Record<string, string> = {
    config_change: "bg-purple-500/10 text-purple-400",
    config_update: "bg-purple-500/10 text-purple-400",
    manual_score: "bg-blue-500/10 text-blue-400",
    score_updated: "bg-blue-500/10 text-blue-400",
    ownership_change: "bg-amber-500/10 text-amber-400",
    status_change: "bg-indigo-500/10 text-indigo-400",
    export: "bg-emerald-500/10 text-emerald-400",
    login_success: "bg-green-500/10 text-green-400",
    login_failed: "bg-red-500/10 text-red-400",
    thread_created: "bg-cyan-500/10 text-cyan-400",
    note_created: "bg-sky-500/10 text-sky-400",
    integration_sync: "bg-teal-500/10 text-teal-400",
    alert_acknowledge: "bg-yellow-500/10 text-yellow-400",
    alert_resolve: "bg-lime-500/10 text-lime-400",
    employee_created: "bg-fuchsia-500/10 text-fuchsia-400",
    employee_updated: "bg-fuchsia-500/10 text-fuchsia-400",
    user_created: "bg-rose-500/10 text-rose-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tracks all configuration changes, manual inputs, ownership changes, and exports
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading audit logs...
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-3">Timestamp</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Entity</th>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} className="border-b border-border">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          actionColors[log.action] || "bg-muted text-muted-foreground"
                        }`}
                      >
                        {log.action.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">
                        {log.entityType}: {log.entityId.substring(0, 8)}...
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{log.user?.name || log.userId}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {log.details}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      No audit log entries yet. Actions will be recorded as the system is used.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 25 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {(page - 1) * 25 + 1} - {Math.min(page * 25, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * 25 >= total}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

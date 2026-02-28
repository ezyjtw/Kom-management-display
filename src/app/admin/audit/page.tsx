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
    config_change: "bg-purple-100 text-purple-700",
    manual_score: "bg-blue-100 text-blue-700",
    ownership_change: "bg-amber-100 text-amber-700",
    status_change: "bg-indigo-100 text-indigo-700",
    export: "bg-emerald-100 text-emerald-700",
    login: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tracks all configuration changes, manual inputs, ownership changes, and exports
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading audit logs...
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3">Timestamp</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Entity</th>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          actionColors[log.action] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {log.action.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-600">
                        {log.entityType}: {log.entityId.substring(0, 8)}...
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{log.user?.name || log.userId}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">
                      {log.details}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
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
              <span className="text-sm text-slate-500">
                Showing {(page - 1) * 25 + 1} - {Math.min(page * 25, total)} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * 25 >= total}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-50"
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

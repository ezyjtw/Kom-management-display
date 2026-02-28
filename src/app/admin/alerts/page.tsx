"use client";

import { useState, useEffect } from "react";
import { Bell, Check, Eye, RefreshCw } from "lucide-react";
import { PriorityBadge } from "@/components/shared/StatusBadge";
import type { AlertData } from "@/types";

const alertTypeLabels: Record<string, string> = {
  tto_breach: "Ownership SLA Breach",
  ttfa_breach: "First Action SLA Breach",
  tsla_breach: "Activity SLA Breach",
  ownership_change: "Ownership Changed",
  ownership_bounce: "Excessive Reassignment",
  mistakes_rising: "Quality Alert",
  throughput_drop: "Throughput Alert",
  sla_slipping: "SLA Slipping",
};

const alertTypeColors: Record<string, string> = {
  tto_breach: "bg-red-100 text-red-700",
  ttfa_breach: "bg-red-100 text-red-700",
  tsla_breach: "bg-orange-100 text-orange-700",
  ownership_change: "bg-blue-100 text-blue-700",
  ownership_bounce: "bg-amber-100 text-amber-700",
  mistakes_rising: "bg-red-100 text-red-700",
  throughput_drop: "bg-amber-100 text-amber-700",
  sla_slipping: "bg-orange-100 text-orange-700",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("active");

  useEffect(() => {
    fetchAlerts();
  }, [statusFilter]);

  async function fetchAlerts() {
    setLoading(true);
    try {
      const res = await fetch(`/api/comms/alerts?status=${statusFilter}`);
      const json = await res.json();
      if (json.success) setAlerts(json.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(alertId: string, action: "acknowledge" | "resolve") {
    await fetch("/api/comms/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, action }),
    });
    fetchAlerts();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Alerts</h1>
          <p className="text-sm text-slate-500 mt-1">
            SLA breaches, ownership changes, and performance warnings
          </p>
        </div>
        <button
          onClick={fetchAlerts}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Status Filter */}
      <div className="flex gap-2">
        {["active", "acknowledged", "resolved", "all"].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors capitalize ${
              statusFilter === status
                ? "bg-blue-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Alerts List */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading alerts...
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert: any) => (
            <div
              key={alert.id}
              className={`bg-white rounded-xl border p-4 ${
                alert.status === "active" ? "border-red-200" : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell
                    size={18}
                    className={alert.status === "active" ? "text-red-500" : "text-slate-400"}
                  />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          alertTypeColors[alert.type] || "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {alertTypeLabels[alert.type] || alert.type}
                      </span>
                      <PriorityBadge priority={alert.priority} />
                    </div>
                    <p className="text-sm text-slate-700">{alert.message}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{new Date(alert.createdAt).toLocaleString()}</span>
                      {alert.thread && <span>Thread: {alert.thread.subject}</span>}
                      {alert.employee && <span>Employee: {alert.employee.name}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {alert.status === "active" && (
                    <>
                      <button
                        onClick={() => handleAction(alert.id, "acknowledge")}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200"
                      >
                        <Eye size={12} />
                        Acknowledge
                      </button>
                      <button
                        onClick={() => handleAction(alert.id, "resolve")}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                      >
                        <Check size={12} />
                        Resolve
                      </button>
                    </>
                  )}
                  {alert.status === "acknowledged" && (
                    <button
                      onClick={() => handleAction(alert.id, "resolve")}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                    >
                      <Check size={12} />
                      Resolve
                    </button>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      alert.status === "active"
                        ? "bg-red-100 text-red-600"
                        : alert.status === "acknowledged"
                        ? "bg-amber-100 text-amber-600"
                        : "bg-emerald-100 text-emerald-600"
                    }`}
                  >
                    {alert.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-slate-200">
              No {statusFilter !== "all" ? statusFilter : ""} alerts
            </div>
          )}
        </div>
      )}
    </div>
  );
}

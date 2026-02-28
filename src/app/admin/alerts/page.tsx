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
  tto_breach: "bg-red-500/10 text-red-400",
  ttfa_breach: "bg-red-500/10 text-red-400",
  tsla_breach: "bg-orange-500/10 text-orange-400",
  ownership_change: "bg-blue-500/10 text-blue-400",
  ownership_bounce: "bg-amber-500/10 text-amber-400",
  mistakes_rising: "bg-red-500/10 text-red-400",
  throughput_drop: "bg-amber-500/10 text-amber-400",
  sla_slipping: "bg-orange-500/10 text-orange-400",
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
          <h1 className="text-2xl font-bold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            SLA breaches, ownership changes, and performance warnings
          </p>
        </div>
        <button
          onClick={fetchAlerts}
          className="flex items-center gap-2 px-3 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-accent/50"
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
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Alerts List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw size={24} className="mx-auto mb-3 animate-spin" />
          Loading alerts...
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert: any) => (
            <div
              key={alert.id}
              className={`bg-card rounded-xl border p-4 ${
                alert.status === "active" ? "border-red-200" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell
                    size={18}
                    className={alert.status === "active" ? "text-red-500" : "text-muted-foreground"}
                  />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          alertTypeColors[alert.type] || "bg-muted text-muted-foreground"
                        }`}
                      >
                        {alertTypeLabels[alert.type] || alert.type}
                      </span>
                      <PriorityBadge priority={alert.priority} />
                    </div>
                    <p className="text-sm text-foreground">{alert.message}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20"
                      >
                        <Eye size={12} />
                        Acknowledge
                      </button>
                      <button
                        onClick={() => handleAction(alert.id, "resolve")}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20"
                      >
                        <Check size={12} />
                        Resolve
                      </button>
                    </>
                  )}
                  {alert.status === "acknowledged" && (
                    <button
                      onClick={() => handleAction(alert.id, "resolve")}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20"
                    >
                      <Check size={12} />
                      Resolve
                    </button>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      alert.status === "active"
                        ? "bg-red-500/10 text-red-400"
                        : alert.status === "acknowledged"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    {alert.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="text-center py-12 text-muted-foreground bg-card rounded-xl border border-border">
              No {statusFilter !== "all" ? statusFilter : ""} alerts
            </div>
          )}
        </div>
      )}
    </div>
  );
}

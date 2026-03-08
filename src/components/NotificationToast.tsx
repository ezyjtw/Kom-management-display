"use client";

import { useEffect, useState } from "react";
import { useSSE, type SSEEvent } from "@/hooks/useSSE";
import { AlertTriangle, ShieldAlert, Clock, Bell, X, Wifi, WifiOff } from "lucide-react";

const EVENT_CONFIG: Record<string, { icon: typeof Bell; color: string; label: string }> = {
  sla_breach: { icon: Clock, color: "border-red-500 bg-red-500/10", label: "SLA Breach" },
  incident_update: { icon: AlertTriangle, color: "border-orange-500 bg-orange-500/10", label: "Incident Update" },
  high_risk_transaction: { icon: ShieldAlert, color: "border-red-500 bg-red-500/10", label: "High Risk Transaction" },
  confirmation_expired: { icon: Clock, color: "border-yellow-500 bg-yellow-500/10", label: "Confirmation Expired" },
  alert: { icon: Bell, color: "border-blue-500 bg-blue-500/10", label: "Alert" },
};

interface Toast {
  id: string;
  event: SSEEvent;
  timestamp: Date;
}

export function NotificationToast() {
  const { connected, lastEvent } = useSSE();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!lastEvent || lastEvent.type === "heartbeat" || lastEvent.type === "job_status") return;

    const toast: Toast = {
      id: `${Date.now()}-${Math.random()}`,
      event: lastEvent,
      timestamp: new Date(),
    };

    setToasts((prev) => [...prev.slice(-4), toast]); // Max 5 toasts

    // Auto-dismiss after 8 seconds
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 8000);

    return () => clearTimeout(timer);
  }, [lastEvent]);

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <>
      {/* Connection indicator */}
      <div className="fixed bottom-4 left-4 z-40 md:left-[17rem]">
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] ${connected ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {connected ? "Live" : "Disconnected"}
        </div>
      </div>

      {/* Toast container */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          const config = EVENT_CONFIG[toast.event.type] || EVENT_CONFIG.alert;
          const Icon = config.icon;
          const data = toast.event.data;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto border-l-4 rounded-lg p-3 shadow-lg bg-card border border-border ${config.color} animate-in slide-in-from-right duration-300`}
            >
              <div className="flex items-start gap-2">
                <Icon size={16} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground">{config.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {(data.message as string) ||
                     (data.title as string) ||
                     (data.subject as string) ||
                     `${(data.asset as string) || ""} ${(data.amount as number)?.toLocaleString() || ""} ${(data.riskLevel as string) || ""}`.trim() ||
                     "New notification"}
                  </div>
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

"use client";

/**
 * Alerts (spec §14.1): alerting-engine alerts by severity, with rule code,
 * fire count, linked WorkItem and ticket. Acknowledging needs a ticketed
 * WorkItem (spec §10.2). Informational only: no transaction actions (H1).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, RefreshCw, ExternalLink } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";

interface AlertRow {
  id: string;
  ruleCode: string;
  severity: string;
  status: string;
  message: string;
  fireCount: number;
  firstFiredAt: string;
  lastFiredAt: string;
  workItemId: string | null;
  workItem: { id: string; title: string; ticketKey: string | null; ticketUrl: string | null } | null;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-500/10 text-red-500",
  high: "bg-orange-500/10 text-orange-500",
  medium: "bg-amber-500/10 text-amber-500",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

export default function AlertsPage() {
  const [status, setStatus] = useState("active");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { lastEvent } = useSSE({ filter: ["alert"] });

  const load = useCallback(async () => {
    setLoading(true);
    const json = await fetch(`/api/alerts?status=${status}`).then((r) => r.json()).catch(() => null);
    if (json?.success) setAlerts(json.data.alerts);
    else setMessage({ ok: false, text: json?.error ?? "Could not load alerts." });
    setLoading(false);
  }, [status]);
  useEffect(() => { void load(); }, [load, lastEvent]);

  async function acknowledge(id: string) {
    const res = await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" });
    const json = await res.json().catch(() => null);
    setMessage(res.ok ? { ok: true, text: "Acknowledged." } : { ok: false, text: json?.error ?? "Could not acknowledge." });
    if (res.ok) void load();
  }

  const counts = alerts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.severity]: (acc[a.severity] ?? 0) + 1 }), {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Bell size={24} className="text-primary" /> Alerts</h1>
          <p className="text-xs text-muted-foreground mt-1">{["critical", "high", "medium", "low"].map((s) => `${counts[s] ?? 0} ${s}`).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
            <option value="active">Active</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All</option>
          </select>
          <button onClick={() => void load()} className="px-3 py-1.5 text-sm border border-border rounded-lg inline-flex items-center gap-1"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
        </div>
      </div>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-emerald-500" : "text-red-500"}`}>{message.text}</p>}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground border-b border-border"><th className="p-2">Severity</th><th className="p-2">Rule</th><th className="p-2">Alert</th><th className="p-2">Fired</th><th className="p-2">Work item</th><th className="p-2">Ticket</th><th className="p-2" /></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="border-t border-border/50">
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${SEVERITY_STYLE[a.severity] ?? ""}`}>{a.severity}</span></td>
                <td className="p-2 text-xs font-mono">{a.ruleCode}</td>
                <td className="p-2">{a.message}</td>
                <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{a.fireCount}× · last {new Date(a.lastFiredAt).toLocaleString()}</td>
                <td className="p-2 text-xs">{a.workItem ? <Link href={`/work/${a.workItem.id}`} className="text-primary hover:underline">{a.workItem.title}</Link> : <span className="text-muted-foreground">—</span>}</td>
                <td className="p-2 text-xs whitespace-nowrap">{a.workItem?.ticketKey ? (a.workItem.ticketUrl ? <a href={a.workItem.ticketUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{a.workItem.ticketKey}<ExternalLink size={10} /></a> : a.workItem.ticketKey) : <span className="text-red-500">no ticket</span>}</td>
                <td className="p-2">{a.status === "active" && <button onClick={() => void acknowledge(a.id)} className="text-xs text-primary">Acknowledge</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && alerts.length === 0 && <p className="p-4 text-sm text-muted-foreground">No {status === "all" ? "" : status} alerts.</p>}
      </div>
    </div>
  );
}

"use client";

/** OTC ticket queue (spec §12 TASK-OTC). Tickets live in Jira OTC; this view filters them. */

import { useCallback, useEffect, useState } from "react";
import { ListChecks, ExternalLink, BellRing } from "lucide-react";

interface OtcItem { id: string; title: string; ticketKey: string; ticketUrl: string | null; state: string; priority: string; clockStartedAt: string; overdue: boolean; owner: { name: string } | null; kind: string; metadata: Record<string, unknown> }

export default function OtcPage() {
  const [filter, setFilter] = useState<"all" | "unassigned" | "overdue">("all");
  const [data, setData] = useState<{ overdueDays: number; items: OtcItem[] } | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const json = await fetch(`/api/otc?filter=${filter}`).then((r) => r.json()).catch(() => null);
    setData(json?.success ? json.data : null);
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void fetch("/api/notifications/preferences").then((r) => r.json()).then((j) => setNotify(!!j?.data?.onAssignProjects?.includes("OTC"))).catch(() => undefined);
  }, []);

  async function toggleNotify() {
    const current = (await fetch("/api/notifications/preferences").then((r) => r.json()).catch(() => null))?.data?.onAssignProjects ?? [];
    const next = notify ? current.filter((p: string) => p !== "OTC") : [...current, "OTC"];
    const json = await fetch("/api/notifications/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onAssignProjects: next }) }).then((r) => r.json());
    if (json?.success) setNotify(!notify);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><ListChecks size={22} className="text-primary" /> OTC queue</h1>
        {notify !== null && (
          <button onClick={() => void toggleNotify()} className="px-3 py-1.5 text-xs border border-border rounded-lg flex items-center gap-1">
            <BellRing size={12} /> {notify ? "Notifying me on OTC assignment (Slack DM + in-app)" : "Notify me when an OTC ticket is assigned to me"}
          </button>
        )}
      </div>
      <div role="tablist" className="flex gap-2">
        {(["all", "unassigned", "overdue"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded-lg border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border"}`}>{f}</button>
        ))}
      </div>
      {data && <p className="text-xs text-muted-foreground">{data.items.length} open ticket(s). Overdue means open more than {data.overdueDays} days.</p>}
      <table className="w-full text-sm bg-card rounded-xl border border-border">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2">Ticket</th><th>Summary</th><th>Owner</th><th>State</th><th>Opened</th></tr></thead>
        <tbody>
          {(data?.items ?? []).map((i) => (
            <tr key={i.id} className="border-t border-border/50">
              <td className="px-4 py-2 text-xs">{i.ticketUrl ? <a href={i.ticketUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{i.ticketKey} <ExternalLink size={10} /></a> : i.ticketKey}</td>
              <td className="text-xs">{i.title}{i.kind === "mtd_break" && <span className="ml-2 text-amber-400">GX status vs chain unverified (CF-18)</span>}</td>
              <td className="text-xs">{i.owner?.name ?? <span className="text-amber-400">unassigned</span>}</td>
              <td className="text-xs">{i.state}</td>
              <td className={`text-xs ${i.overdue ? "text-red-400" : ""}`}>{new Date(i.clockStartedAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

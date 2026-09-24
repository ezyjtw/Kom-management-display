"use client";

/**
 * Work: the unified queue (spec §14.1). Default filter "my team, open".
 * Live SLA timers; the queue refreshes on work item, SLA and alert events
 * (SSE) and re-orders by time remaining.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Inbox, RefreshCw, ExternalLink } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";
import { SlaTimer, liveState, useNow } from "@/components/work/SlaTimer";
import { KIND_META, KindIcon } from "@/components/work/kind";
import type { QueueRow } from "@/modules/work-items/queue";

interface Filters {
  team: string;
  kind: string;
  clientId: string;
  priority: string;
  sla: string;
  project: string;
  owner: string;
  status: string;
  q: string;
}

const DEFAULT: Filters = { team: "mine", kind: "", clientId: "", priority: "", sla: "", project: "", owner: "any", status: "open", q: "" };
const select = "h-8 rounded-md border border-border bg-background px-2 text-sm";

function relative(iso: string, now: number): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function WorkPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [team, setTeam] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const { lastEvent, connected } = useSSE({ filter: ["work_item_update", "sla_breach", "alert"] });

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== ""));
    const json = await fetch(`/api/work-items?${qs}`).then((r) => r.json()).catch(() => null);
    if (json?.success) {
      setRows(json.data.rows);
      setTeam(json.data.team);
      setClients(json.data.clientOptions);
      setError(null);
    } else setError(json?.error ?? "Could not load the queue.");
    setLoading(false);
  }, [filters]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (lastEvent) void load(); }, [lastEvent, load]);
  useEffect(() => {
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Re-order by time remaining as timers run (breached first, untimed last).
  const ordered = useMemo(() => {
    const due = (r: QueueRow) => (r.sla.dueAt ? Date.parse(r.sla.dueAt) : Number.POSITIVE_INFINITY);
    return [...rows]
      .filter((r) => !filters.sla || liveState(r.sla, now) === filters.sla || (filters.sla === "none" && !r.sla.dueAt))
      .sort((a, b) => due(a) - due(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sort once a minute, not every tick
  }, [rows, filters.sla, Math.floor(now / 60_000)]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Inbox size={24} className="text-primary" /> Work</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {filters.team === "mine" ? (team ? `My team (${team})` : "You are not in a team yet; showing all teams") : filters.team === "all" ? "All teams" : filters.team}
            {" · "}{rows.length} item{rows.length === 1 ? "" : "s"} · live updates {connected ? "on" : "reconnecting"}
          </p>
        </div>
        <button onClick={() => void load()} className="px-3 py-1.5 text-sm border border-border rounded-lg inline-flex items-center gap-1"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
      </div>

      <div className="flex flex-wrap gap-2 items-center" role="group" aria-label="Queue filters">
        <select aria-label="Team" value={filters.team} onChange={set("team")} className={select}>
          <option value="mine">My team</option><option>Team 1</option><option>Team 2</option><option>Team 3</option><option value="all">All teams</option>
        </select>
        <select aria-label="Kind" value={filters.kind} onChange={set("kind")} className={select}>
          <option value="">All kinds</option>
          {Object.entries(KIND_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select aria-label="Client" value={filters.clientId} onChange={set("clientId")} className={select}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Priority" value={filters.priority} onChange={set("priority")} className={select}>
          <option value="">Any priority</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option>
        </select>
        <select aria-label="SLA state" value={filters.sla} onChange={set("sla")} className={select}>
          <option value="">Any SLA</option><option value="breach">Breached</option><option value="warn">Warning</option><option value="ok">OK</option><option value="none">No SLA</option>
        </select>
        <input aria-label="Ticket project" placeholder="Project (e.g. TOPS)" value={filters.project} onChange={(e) => setFilters((f) => ({ ...f, project: e.target.value.toUpperCase() }))} className={`${select} w-36`} />
        <select aria-label="Owner" value={filters.owner} onChange={set("owner")} className={select}>
          <option value="any">Any owner</option><option value="me">Me</option><option value="unassigned">Unassigned</option><option value="team">My team&apos;s members</option>
        </select>
        <select aria-label="Status" value={filters.status} onChange={set("status")} className={select}>
          <option value="open">Open</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All</option>
        </select>
        <input aria-label="Search titles" placeholder="Search" value={filters.q} onChange={set("q")} className={`${select} w-40`} />
        {JSON.stringify(filters) !== JSON.stringify(DEFAULT) && <button onClick={() => setFilters(DEFAULT)} className="text-xs text-primary">Reset</button>}
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="p-2">Item</th><th className="p-2">Client</th><th className="p-2">SLA</th><th className="p-2">Ticket</th><th className="p-2">Owner</th><th className="p-2">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r) => (
              <tr key={r.id} className="border-t border-border/50 hover:bg-accent/30">
                <td className="p-2">
                  <Link href={`/work/${r.id}`} className="flex items-center gap-2 text-foreground hover:underline">
                    <KindIcon kind={r.kind} />
                    <span className="text-xs text-muted-foreground">{r.priority}</span>
                    <span className="truncate max-w-[28rem]">{r.title}</span>
                  </Link>
                  {r.state.startsWith("waiting") && <span className="ml-6 text-xs text-amber-500">{r.state.replace("_", " ")}</span>}
                </td>
                <td className="p-2 text-xs">{r.client?.name ?? "—"}</td>
                <td className="p-2 whitespace-nowrap"><SlaTimer sla={r.sla} now={now} /></td>
                <td className="p-2 text-xs whitespace-nowrap">
                  {r.ticketKey ? (r.ticketUrl ? <a href={r.ticketUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{r.ticketKey}<ExternalLink size={10} /></a> : r.ticketKey) : <span className="text-red-500">no ticket</span>}
                </td>
                <td className="p-2 text-xs">{r.owner?.name ?? <span className="text-muted-foreground">unassigned</span>}</td>
                <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{relative(r.lastActivityAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && ordered.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing matches these filters.</p>}
      </div>
    </div>
  );
}

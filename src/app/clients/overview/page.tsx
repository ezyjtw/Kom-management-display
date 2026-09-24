"use client";

/** Clients (spec §14.1): open items, SLA status, recent activity, logged effort (team level) and channels, per client. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import type { clientsOverview } from "@/modules/clients/overview";

type Row = Awaited<ReturnType<typeof clientsOverview>>[number];

export default function ClientsOverviewPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/clients/overview").then((r) => r.json()).then((json) => (json?.success ? setRows(json.data.clients) : setError(json?.error ?? "Could not load clients."))).catch(() => setError("Could not load clients."));
  }, []);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Users size={24} className="text-primary" /> Clients</h1>
        <p className="text-xs text-muted-foreground mt-1">Effort is logged effort over the last 30 days, team level. <Link href="/clients" className="text-primary">Client issues from comms</Link></p>
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {!rows && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border"><th className="p-2">Client</th><th className="p-2">Open items</th><th className="p-2">SLA</th><th className="p-2">Last activity</th><th className="p-2">Logged effort (30d)</th><th className="p-2">Channels</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clientId} className="border-t border-border/50">
                  <td className="p-2"><Link href={`/work?team=all&clientId=${r.clientId}`} className="hover:underline">{r.client}</Link></td>
                  <td className="p-2">{r.openItems}</td>
                  <td className="p-2 text-xs">{r.sla.breach ? <span className="text-red-500">{r.sla.breach} breached </span> : null}{r.sla.warn ? <span className="text-amber-500">{r.sla.warn} warning</span> : null}{!r.sla.breach && !r.sla.warn ? <span className="text-emerald-500">ok</span> : null}</td>
                  <td className="p-2 text-xs text-muted-foreground">{r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleString() : "—"}</td>
                  <td className="p-2">{r.loggedEffortHours30d} h</td>
                  <td className="p-2 text-xs">{r.channels.map((c) => `${c.kind}: ${c.ref}`).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No active clients.</p>}
        </div>
      )}
    </div>
  );
}

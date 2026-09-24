"use client";

/**
 * GX sprints (spec §16.7): UAT landed and PROD planned dates, change items by type,
 * mapping to tasks, UAT ticket status and outcomes, and the gate. Testing happens
 * in GX UAT by people; this page only tracks tickets.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GitBranch, RefreshCw, ExternalLink } from "lucide-react";
import type { sprintsView } from "@/modules/gx-sprints/view";

type Sprint = Awaited<ReturnType<typeof sprintsView>>[number];

const GATE: Record<string, { label: string; cls: string }> = {
  green: { label: "Gate: all outcomes recorded, no fails", cls: "bg-emerald-500/10 text-emerald-500" },
  amber: { label: "Gate: outcomes outstanding", cls: "bg-amber-500/10 text-amber-500" },
  red: { label: "Gate: UAT failed", cls: "bg-red-500/10 text-red-500" },
  none: { label: "No UAT items", cls: "bg-muted text-muted-foreground" },
};
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export default function GxSprintsPage() {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const json = await fetch("/api/gx-sprints").then((r) => r.json()).catch(() => null);
    if (json?.success) {
      setSprints(json.data.sprints);
      setCanRun(json.data.canRun);
    } else setMessage({ ok: false, text: json?.error ?? "Could not load sprints." });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(force: boolean) {
    setBusy(true);
    const res = await fetch("/api/gx-sprints/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      const r = json.data;
      setMessage({ ok: true, text: `Intake done: ${r.sprints.length} sprint page(s) read, ${r.newItems} new, ${r.updatedItems} updated, ${r.removedItems} removed, ${r.ticketsCreated} ticket(s) created${r.ticketsFailed ? `, ${r.ticketsFailed} could not be created in Jira (see the unticketed-work report)` : ""}.${r.skipped.length ? ` Skipped: ${r.skipped.join("; ")}` : ""}` });
      void load();
    } else setMessage({ ok: false, text: json?.error ?? "Intake failed." });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><GitBranch size={24} className="text-primary" /> GX sprints</h1>
          <p className="text-xs text-muted-foreground mt-1">UAT tickets from the GX release notes. Tests run in GX UAT, by people.</p>
        </div>
        {canRun && (
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => void run(false)} className="px-3 py-1.5 text-sm border border-border rounded-lg inline-flex items-center gap-1 disabled:opacity-50"><RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Run sprint intake</button>
            <button disabled={busy} onClick={() => void run(true)} className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-lg disabled:opacity-50">Re-read all pages</button>
          </div>
        )}
      </div>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-emerald-500" : "text-red-500"}`}>{message.text}</p>}
      {sprints.length === 0 && <p className="text-sm text-muted-foreground">No sprints yet.</p>}
      {sprints.map((s) => (
        <section key={s.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-base font-semibold">Sprint {s.sprint}</h2>
            <span className={`text-xs px-2 py-0.5 rounded ${GATE[s.gate].cls}`}>{GATE[s.gate].label}</span>
            {s.releaseNotesUrl && <a href={s.releaseNotesUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1">Release notes v{s.pageVersion} <ExternalLink size={10} /></a>}
            {s.parentTicketKey && <span className="text-xs">UAT parent: {s.parentTicketKey}</span>}
          </div>
          <p className="text-xs text-muted-foreground">UAT landed {day(s.uatLandedAt)} · PROD planned {day(s.prodPlannedAt)} · Outcomes: {s.outcomes.pass} pass, {s.outcomes.fail} fail, {s.outcomes.not_applicable} n/a, {s.outcomes.blocked} blocked, {s.outcomes.open} open</p>
          <p className="text-xs">Items: {Object.entries(s.byType).map(([t, n]) => `${t} ${n}`).join(", ") || "none"} · Tasks affected: {s.tasks.join(", ") || "none"}</p>
          <button onClick={() => setOpen(open === s.id ? null : s.id)} className="text-xs text-primary">{open === s.id ? "Hide items" : "Show items"}</button>
          {open === s.id && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1">Type</th><th>Summary</th><th>Team</th><th>Tasks</th><th>UAT ticket</th><th>Outcome</th></tr></thead>
                <tbody>
                  {s.items.map((c) => (
                    <tr key={c.id} className={`border-t border-border/50 ${c.qualifies ? "" : "text-muted-foreground"}`}>
                      <td className="py-1">{c.itemType}{c.tags.length ? ` (${c.tags.join(", ")})` : ""}</td>
                      <td>{c.summary}</td>
                      <td>{c.team}</td>
                      <td>{c.affectedTasks.join(", ") || "—"}</td>
                      <td>{c.workItemId ? <Link href={`/work/${c.workItemId}`} className="text-primary">{c.uatTicketKey ?? "open"}</Link> : c.qualifies ? "pending" : "no UAT"}</td>
                      <td>{c.uatOutcome ?? (c.qualifies ? "open" : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.removed.length > 0 && <p className="text-xs text-amber-500 mt-1">Removed from the release notes (tickets not closed): {s.removed.map((r) => r.uatTicketKey ?? r.summary).join(", ")}</p>}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

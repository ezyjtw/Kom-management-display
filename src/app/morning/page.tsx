"use client";

/**
 * Morning board (spec §14.3, 09:05 UK). Built only from tickets and
 * WorkItems. Absent leads record a covering member and a handover note before
 * 09:00; the note posts to each of their open tickets.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sunrise, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { buildMorningBoard, TeamBoard } from "@/modules/morning/board";

type Board = Awaited<ReturnType<typeof buildMorningBoard>> & {
  me: { employeeId: string | null; role: string; canManage: string[] };
};

const input = "h-8 rounded-md border border-border bg-background px-2 text-sm";
const button = "px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent/50 disabled:opacity-50";

const age = (mins: number) => (mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`);

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title} <span className={count ? "text-foreground" : ""}>({count})</span></h3>
      {count > 0 ? <ul className="mt-1 space-y-1 text-sm">{children}</ul> : <p className="mt-1 text-xs text-muted-foreground">None.</p>}
    </div>
  );
}

function ItemLink({ id, ticketKey, title }: { id: string; ticketKey: string; title: string }) {
  return <Link href={`/work/${id}`} className="hover:underline"><span className="text-primary">{ticketKey}</span> {title}</Link>;
}

function Handover({ t, board, onDone }: { t: TeamBoard; board: Board; onDone: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!t.lead) return <p className="text-xs text-muted-foreground">No lead configured for {t.team}.</p>;
  const h = t.handover;
  const canManage = board.me.canManage.includes(t.team);

  async function post(path: string, body: unknown, ok: string) {
    setBusy(true);
    const res = await fetch(`/api/morning/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: ok } : { ok: false, text: json?.error ?? "Failed." });
    if (res.ok) onDone();
  }

  const posted = h?.postStatus === "posted";
  const incomplete = h?.postStatus === "partially_posted" || h?.postStatus === "failed";
  const total = (h?.postedTo ?? 0) + (h?.failedTickets.length ?? 0);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span>Lead: <strong>{t.lead.name}</strong></span>
        {h?.absent ? <span className="text-amber-500">absent ({h.source === "pto" ? "leave" : "marked absent"})</span> : <span className="text-emerald-500">present</span>}
        {canManage && h?.source !== "pto" && !h?.note && (
          <button disabled={busy} className="text-xs text-primary" onClick={() => post("absence", { date: board.date, team: t.team, absent: !h?.absent }, "Saved.")}>
            {h?.absent ? "Mark present" : "Mark absent today"}
          </button>
        )}
      </div>
      {h?.absent && h.note && (
        <div className="text-sm space-y-1">
          {posted && <p className="flex items-center gap-1 text-emerald-500"><CheckCircle2 size={14} /> Handover posted to {h.postedTo} open ticket(s){h.late ? " (saved after 09:00)" : ""}. Covering: {h.covering?.name ?? "—"}.</p>}
          {h.postStatus === "pending" && <p className="text-muted-foreground">Handover saved{h.late ? " (after 09:00)" : ""}. Covering: {h.covering?.name ?? "—"}. It posts to the lead&apos;s open tickets at 09:00.</p>}
          {incomplete && (
            <p className="flex items-center gap-1 text-red-500 flex-wrap">
              <AlertTriangle size={14} /> Handover {h.postStatus === "failed" ? "not posted" : "partially posted"}: {h.postedTo}/{total} tickets updated. Still to post: {h.failedTickets.join(", ")}.
              {canManage && <button disabled={busy} className="ml-2 text-xs text-primary" onClick={() => post("handover/retry", { date: board.date, team: t.team }, "Retried.")}>Retry now</button>}
            </p>
          )}
          <p className="whitespace-pre-wrap text-muted-foreground">{h.note}</p>
        </div>
      )}
      {h?.absent && !h.note && (
        <div className="space-y-2">
          {h.missing && (
            <p className="text-sm text-red-500 flex items-center gap-1"><AlertTriangle size={14} /> Handover missing: it was due before 09:00.
              {h.reminder ? ` Reminder reached ${h.reminder.reached} of ${h.reminder.recipients} (lead and Head of Transaction Operations)${h.reminder.notifiedAt ? "" : "; retrying"}.` : " Reminder pending."}
            </p>
          )}
          {canManage ? (
            <form className="space-y-2" onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void post("handover", { date: board.date, team: t.team, coveringEmployeeId: f.get("covering"), note: f.get("note") }, "Handover saved.");
            }}>
              {t.coverPool.length === 0 ? (
                <p className="text-xs text-red-500">No one is available to cover: add the deputy and team members in Admin → Reference data → Team config.</p>
              ) : (
                <select name="covering" aria-label="Covering member" required className={input} defaultValue="">
                  <option value="" disabled>Covering member…</option>
                  {t.coverPool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <textarea name="note" aria-label="Handover note" required minLength={20} rows={3} placeholder="Handover note (posted as an internal comment on each of the lead's open tickets)" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
              <button disabled={busy || t.coverPool.length === 0} className={button}>Save handover</button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">The lead, the deputy or an admin records the handover.</p>
          )}
        </div>
      )}
      {msg && <p role="status" className={`text-xs ${msg.ok ? "text-emerald-500" : "text-red-500"}`}>{msg.text}</p>}
    </div>
  );
}

export default function MorningPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const json = await fetch("/api/morning").then((r) => r.json()).catch(() => null);
    if (json?.success) setBoard(json.data);
    else setError(json?.error ?? "Could not load the morning board.");
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Sunrise size={24} className="text-primary" /> Morning board</h1>
          <p className="text-xs text-muted-foreground mt-1">Morning call 09:05 UK{board ? ` · ${board.date} · checks from ${board.previousBusinessDate}` : ""}</p>
        </div>
        <button onClick={() => void load()} className={`${button} inline-flex items-center gap-1`}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</button>
      </div>
      {board && <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">{board.banner}</p>}
      {board?.unticketed && board.unticketed.total > 0 && (
        <p className="text-sm text-red-500">Unticketed work report ({board.unticketed.date}): {board.unticketed.total} item(s) need a ticket.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {board?.teams.map((t) => {
          const empty = !t.lead && !t.checksNotCompleted.length && !t.openExceptions.length && !t.blockers.length && !t.slaBreaches24h.length && !t.activeAlerts.length && !t.fab.open && !t.oes.open;
          if (t.team === "All" && empty) return null;
          return (
            <section key={t.team} aria-label={t.team} className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h2 className="text-base font-semibold text-foreground">{t.team === "All" ? "All teams" : t.team}</h2>
              {t.team !== "All" && <Handover t={t} board={board} onDone={() => void load()} />}
              <Section title="Checks not completed" count={t.checksNotCompleted.length}>
                {t.checksNotCompleted.map((c) => <li key={c.code}>{c.code} {c.name} <span className="text-xs text-muted-foreground">({c.periodKey})</span></li>)}
              </Section>
              <Section title="Open exceptions" count={t.openExceptions.length}>
                {t.openExceptions.map((i) => <li key={i.id}><ItemLink {...i} /> <span className="text-xs text-muted-foreground">{age(i.ageMins)} old</span></li>)}
              </Section>
              <Section title="Blockers" count={t.blockers.length}>
                {t.blockers.map((i) => <li key={i.id}><ItemLink {...i} /> <span className="text-xs text-amber-500">{i.state.replace("_", " ")}{i.reason ? `: ${i.reason}` : ""}</span> <span className="text-xs text-muted-foreground">{age(i.sinceMins)}</span></li>)}
              </Section>
              <Section title="SLA breaches (24h)" count={t.slaBreaches24h.length}>
                {t.slaBreaches24h.map((i) => <li key={`${i.id}-${i.at}`}><ItemLink {...i} /> <span className="text-xs text-red-500">{i.breach}</span></li>)}
              </Section>
              <Section title="Active alerts" count={t.activeAlerts.length}>
                {t.activeAlerts.map((a) => <li key={a.id}><Link href={`/work/${a.workItemId}`} className="hover:underline"><span className={a.severity === "critical" ? "text-red-500" : "text-amber-500"}>{a.ruleCode}</span> {a.message}</Link> <span className="text-xs text-muted-foreground">{a.ticketKey}</span></li>)}
              </Section>
              <div className="flex gap-6 text-sm">
                <span>FAB open: <strong>{t.fab.open}</strong></span>
                <span>OES open: <strong>{t.oes.open}</strong></span>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

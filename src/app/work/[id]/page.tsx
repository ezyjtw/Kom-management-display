"use client";

/**
 * Work item detail (spec §14.2): header with live SLA timers, one timeline,
 * and the actions. Ticket changes are written to Jira first. There are no
 * transaction actions of any kind (H1). Client updates are human-written.
 */

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, MessageSquare, Ticket, Bell, Timer, Send, History, AlertTriangle } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";
import { SlaTimer, useNow } from "@/components/work/SlaTimer";
import { KindIcon, KIND_META } from "@/components/work/kind";
import type { workItemDetail } from "@/modules/work-items/detail";

type Detail = NonNullable<Awaited<ReturnType<typeof workItemDetail>>>;

const input = "h-8 rounded-md border border-border bg-background px-2 text-sm";
const button = "px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent/50 disabled:opacity-50";
const TIMELINE_ICON = { message: MessageSquare, ticket_comment: Ticket, alert: Bell, sla: Timer, client_update: Send, change: History };

export default function WorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"state" | "note" | "time" | "link" | "reassign" | "update" | "close" | null>(null);
  const now = useNow();
  const { lastEvent } = useSSE({ filter: ["work_item_update", "sla_breach"] });

  const load = useCallback(async () => {
    const json = await fetch(`/api/work-items/${id}`).then((r) => r.json()).catch(() => null);
    if (json?.success) setD(json.data);
    else setError(json?.error ?? "Could not load the work item.");
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const data = lastEvent?.data as { workItemId?: string } | undefined;
    if (data?.workItemId === id) void load();
  }, [lastEvent, id, load]);

  async function act(path: string, body: unknown, ok: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && json?.success !== false) {
      setMessage({ ok: true, text: ok });
      setPanel(null);
      await load();
    } else {
      const issues: string[] = json?.issues ?? json?.details?.issues ?? [];
      setMessage({ ok: false, text: [json?.error ?? "The action failed.", ...issues].join(" ") });
    }
  }
  const form = (fn: (f: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    fn(new FormData(e.currentTarget));
  };

  if (error) return <p role="alert" className="text-sm text-red-500">{error}</p>;
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const { item, sla } = d;
  const closed = item.state === "closed" || item.state === "resolved";

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/work" className="text-xs text-muted-foreground inline-flex items-center gap-1"><ArrowLeft size={12} /> Work</Link>

      <header className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-start gap-2">
          <KindIcon kind={item.kind} />
          <h1 className="text-lg font-semibold text-foreground">{item.title}</h1>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{KIND_META[item.kind]?.label ?? item.kind}</span>
          <span>{item.team}</span>
          <span>Client: {item.client?.name ?? "—"}</span>
          <span>Priority {item.priority}</span>
          <span>State: <strong className="text-foreground">{item.state.replace("_", " ")}</strong>{item.waitingReason ? ` — ${item.waitingReason}` : ""}</span>
          <span>Owner: {item.owner?.name ?? "unassigned"}</span>
          <span>SLA: <SlaTimer sla={sla} now={now} /></span>
          <span>
            Ticket: {item.ticketKey ? <a href={item.ticketUrl ?? "#"} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{item.ticketKey}<ExternalLink size={10} /></a> : <span className="text-red-500">none</span>}
          </span>
          {item.clientTicketKey && <span>Client request: <a href={item.clientTicketUrl ?? "#"} target="_blank" rel="noreferrer" className="text-primary">{item.clientTicketKey}</a></span>}
          {item.relatedTickets.length > 0 && <span>Related: {item.relatedTickets.map((t) => <a key={t.key} href={t.url} target="_blank" rel="noreferrer" className="text-primary mr-1">{t.key}</a>)}</span>}
        </div>
        {item.writebackError && <p className="text-xs text-amber-500 flex items-center gap-1"><AlertTriangle size={12} /> Last ticket write failed: {item.writebackError}</p>}
      </header>

      {message && <p role="status" className={`text-sm ${message.ok ? "text-emerald-500" : "text-red-500"}`}>{message.text}</p>}

      <section aria-label="Actions" className="flex flex-wrap gap-2">
        {!closed && <button disabled={busy} className={button} onClick={() => act(`work-items/${id}/ownership`, { employeeId: "me" }, "You own this item.")}>Take ownership</button>}
        {!closed && <button className={button} onClick={() => setPanel(panel === "reassign" ? null : "reassign")}>Reassign</button>}
        {!closed && <button className={button} onClick={() => setPanel(panel === "state" ? null : "state")}>Change state</button>}
        <button className={button} disabled={!item.ticketKey} title={item.ticketKey ? "" : "No ticket"} onClick={() => setPanel(panel === "note" ? null : "note")}>Internal note</button>
        <button className={button} onClick={() => setPanel(panel === "time" ? null : "time")}>Log time</button>
        <button className={button} onClick={() => setPanel(panel === "link" ? null : "link")}>Link ticket</button>
        <a className={button} href={d.raiseLink}>Raise incident / risk</a>
        {d.canPostClientUpdate && !closed && <button className={button} onClick={() => setPanel(panel === "update" ? null : "update")}>Post client update</button>}
        {!closed && <button className={`${button} border-primary text-primary`} onClick={() => setPanel(panel === "close" ? null : "close")}>Close</button>}
      </section>

      {panel === "reassign" && (
        <form className="flex gap-2 items-center flex-wrap" onSubmit={form((f) => act(`work-items/${id}/ownership`, { employeeId: String(f.get("employeeId")) || null }, "Reassigned."))}>
          <select name="employeeId" aria-label="Assignee" className={input} defaultValue={item.owner?.id ?? ""}>
            <option value="">Unassigned</option>
            {d.assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button disabled={busy} className={button}>Save</button>
          <span className="text-xs text-muted-foreground">Leads, admins and the current owner can reassign. Jira is updated first.</span>
        </form>
      )}
      {panel === "state" && (
        <form className="flex gap-2 items-center flex-wrap" onSubmit={form((f) => act(`work-items/${id}/state`, { state: f.get("state"), reason: String(f.get("reason") || "") || undefined, transitionName: String(f.get("transitionName") || "") || undefined }, "State changed."))}>
          <select name="state" aria-label="New state" className={input} defaultValue={item.state}>
            <option value="open">Open</option><option value="owned">Owned</option>
            <option value="waiting_client">Waiting on client</option><option value="waiting_vendor">Waiting on vendor</option><option value="waiting_internal">Waiting internal</option>
          </select>
          <input name="reason" aria-label="Waiting for" placeholder="Waiting for… (required for waiting states)" className={`${input} w-72`} />
          <input name="transitionName" aria-label="Jira transition name" placeholder="Transition name (if asked)" className={`${input} w-48`} />
          <button disabled={busy} className={button}>Save</button>
          <span className="text-xs text-muted-foreground">Resolve and close use the Close write-up.</span>
        </form>
      )}
      {panel === "note" && (
        <form className="space-y-2" onSubmit={form((f) => act(`work-items/${id}/notes`, { text: f.get("text") }, "Internal note posted to the ticket."))}>
          <textarea name="text" aria-label="Internal note" required minLength={2} maxLength={5000} rows={3} className="w-full rounded-md border border-border bg-background p-2 text-sm" placeholder="Internal note (posted as an internal comment on the ticket; not visible to the client)" />
          <button disabled={busy} className={button}>Post internal note</button>
        </form>
      )}
      {panel === "time" && (
        <form className="flex gap-2 items-center" onSubmit={form((f) => act(`work-items/${id}/time`, { bucketMins: Number(f.get("bucketMins")) }, "Time logged."))}>
          <select name="bucketMins" aria-label="Time spent" className={input}>{d.closeOptions.timeBuckets.map((b) => <option key={b} value={b}>{b} min</option>)}</select>
          <button disabled={busy} className={button}>Log</button>
        </form>
      )}
      {panel === "link" && (
        <form className="flex gap-2 items-center" onSubmit={form((f) => act(`work-items/${id}/links`, { key: f.get("key") }, "Ticket linked."))}>
          <input name="key" aria-label="Ticket key" required placeholder="TOPS-123" className={`${input} w-40`} />
          <button disabled={busy} className={button}>Link</button>
        </form>
      )}
      {panel === "update" && (
        <form className="space-y-2" onSubmit={form((f) => act(`client-incidents/${id}/updates`, { body: f.get("body"), targetStatus: String(f.get("targetStatus") || "") || undefined }, "Client update submitted."))}>
          <p className="text-xs text-muted-foreground">Visible to the client on {item.clientTicketKey}. Write it yourself; name no other client and include no internal detail. P0 and P1 updates need a second team member to review before they post.</p>
          <textarea name="body" aria-label="Client update" required minLength={5} maxLength={2000} rows={4} className="w-full rounded-md border border-border bg-background p-2 text-sm" />
          <select name="targetStatus" aria-label="Client-visible status" className={input}>
            <option value="">Keep status</option><option>Investigating</option><option>Update provided</option>
          </select>
          <button disabled={busy} className={button}>Submit update</button>
          <Link href={`/client-incidents/${id}`} className="ml-3 text-xs text-primary">Reviews and client status</Link>
        </form>
      )}
      {panel === "close" && (
        <form className="space-y-2 rounded-xl border border-border bg-card p-4" onSubmit={form((f) => act(`work-items/${id}/close`, {
          resolutionNote: f.get("resolutionNote"), rootCause: f.get("rootCause"), riskScore: f.get("riskScore"),
          timeLogBucketMins: f.get("timeLogBucketMins") ? Number(f.get("timeLogBucketMins")) : undefined,
          clientResolutionMessage: String(f.get("clientResolutionMessage") || "") || undefined,
          transitionName: String(f.get("transitionName") || "") || undefined,
        }, "Closed."))}>
          <textarea name="resolutionNote" aria-label="Resolution note" required minLength={20} rows={3} placeholder="Resolution note (at least 20 characters)" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
          <div className="flex gap-2 flex-wrap">
            <select name="rootCause" aria-label="Root cause" required className={input}><option value="">Root cause…</option>{d.closeOptions.rootCauses.map((r) => <option key={r}>{r}</option>)}</select>
            {d.closeOptions.riskScale.length
              ? <select name="riskScore" aria-label="Risk score" required className={input}><option value="">Risk score…</option>{d.closeOptions.riskScale.map((r) => <option key={r}>{r}</option>)}</select>
              : <input name="riskScore" aria-label="Risk score" required placeholder="Risk score" className={input} />}
            <select name="timeLogBucketMins" aria-label="Time spent" className={input}><option value="">Time spent…</option>{d.closeOptions.timeBuckets.map((b) => <option key={b} value={b}>{b} min</option>)}</select>
            <input name="transitionName" aria-label="Jira transition name" placeholder="Transition name (if asked)" className={`${input} w-48`} />
          </div>
          {d.canPostClientUpdate && (
            <textarea name="clientResolutionMessage" aria-label="Client resolution message" required rows={3} placeholder="Resolution message for the client (posted on the client request; human-written)" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
          )}
          <button disabled={busy} className={button}>Close item</button>
        </form>
      )}

      <section aria-label="Timeline" className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Timeline</h2>
        {d.timelineWarning && <p className="text-xs text-amber-500">{d.timelineWarning}</p>}
        <ol className="space-y-2">
          {d.timeline.map((e, i) => {
            const Icon = TIMELINE_ICON[e.kind];
            return (
              <li key={`${e.at}-${i}`} className={`rounded-lg border border-border p-3 ${e.internal ? "bg-muted/30" : "bg-card"}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon size={12} aria-hidden />
                  <span className="text-foreground">{e.title}</span>
                  {e.author && <span>· {e.author}</span>}
                  <span className="ml-auto">{new Date(e.at).toLocaleString()}</span>
                </div>
                {e.text && <p className="mt-1 text-sm whitespace-pre-wrap break-words">{e.text}</p>}
                <div className="mt-1 flex gap-3 text-xs">
                  {e.link && <a href={e.link} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">Open <ExternalLink size={10} /></a>}
                  {e.raiseLink && <a href={e.raiseLink} className="text-primary">Raise incident / risk</a>}
                </div>
              </li>
            );
          })}
        </ol>
        {d.timeline.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
      </section>
    </div>
  );
}

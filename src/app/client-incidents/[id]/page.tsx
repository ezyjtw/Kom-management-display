"use client";

/**
 * A client incident or risk (spec §9.7): the internal and client tickets,
 * drafted client messages (sent only when you click Send), human-written
 * client updates (four-eyes where required) and the client-visible status.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ShieldAlert, ExternalLink, AlertTriangle, Send } from "lucide-react";

type Entry = {
  id: string; kind: string; title: string; client: string | null; severity: string; state: string;
  ticketKey: string | null; ticketUrl: string | null; clientTicketKey: string | null; clientTicketUrl: string | null;
  category: string; complianceSensitive: boolean; clientFacingSummary: string; internalDescription: string; affectedReferences: string[];
  clientStatus: string | null; lastClientUpdateAt: string | null; banner: string | null; clientTicketError: string | null;
  fourEyes: boolean; clientStatuses: string[];
  updates: Array<{ id: string; body: string; kind: string; status: string; mine: boolean; postedAt: string | null; createdAt: string }>;
  drafts: Array<{ id: string; channel: string; body: string; status: string; sentAt: string | null }>;
};

const box = "bg-card border border-border rounded-xl p-4 space-y-2";

export default function ClientEntryPage() {
  const { id } = useParams<{ id: string }>();
  const [e, setE] = useState<Entry | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const json = await fetch(`/api/client-incidents/${id}`).then((r) => r.json()).catch(() => null);
    if (json?.success) setE(json.data);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function post(url: string, body: unknown, done: string) {
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setMsg(res.ok ? { ok: true, text: done } : { ok: false, text: [json?.error, ...(json?.issues ?? [])].filter(Boolean).join(" ") || "Not saved." });
    await load();
  }

  if (!e) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><ShieldAlert size={22} className="text-primary" /> {e.title}</h1>
      <p className="text-xs text-muted-foreground">{e.kind === "client_incident" ? "Incident" : "Risk"} · {e.severity} · {e.category} · {e.state}</p>
      {e.banner && <p role="alert" className="p-3 rounded-lg text-sm bg-amber-500/10 text-amber-600 border border-amber-500/20 flex gap-2"><AlertTriangle size={16} aria-hidden /> {e.banner}</p>}
      {e.clientTicketError && <p role="alert" className="p-3 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">Client request not created: {e.clientTicketError}</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`p-3 rounded-lg text-sm border ${msg.ok ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"}`}>{msg.text}</p>}

      <section className={box}>
        <h2 className="text-sm font-semibold">Tickets</h2>
        <p className="text-sm">Internal: {e.ticketUrl ? <a className="text-primary inline-flex items-center gap-1" href={e.ticketUrl} target="_blank" rel="noreferrer">{e.ticketKey} <ExternalLink size={12} /></a> : e.ticketKey ?? "not created"}</p>
        <p className="text-sm">Client (portal): {e.clientTicketUrl ? <a className="text-primary inline-flex items-center gap-1" href={e.clientTicketUrl} target="_blank" rel="noreferrer">{e.clientTicketKey} <ExternalLink size={12} /></a> : e.clientTicketKey ?? "none"}{e.clientStatus && ` · client sees: ${e.clientStatus}`}</p>
        {!e.clientTicketKey && !e.banner && <button onClick={() => void post(`/api/client-incidents/${id}/client-ticket`, {}, "Client request created.")} className="px-3 py-1.5 text-xs border border-border rounded-md">Retry client request</button>}
        {!e.clientTicketKey && e.banner && (
          <form className="flex gap-2 items-end" onSubmit={(ev) => { ev.preventDefault(); void post(`/api/client-incidents/${id}/client-ticket`, { complianceDecisionRef: new FormData(ev.currentTarget).get("ref") }, "Client request created after the Compliance decision."); }}>
            <label className="text-xs text-muted-foreground flex-1">Compliance decision reference (admin only)<input name="ref" required minLength={3} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm" /></label>
            <button type="submit" className="px-3 py-1.5 text-xs border border-border rounded-md">Create client request</button>
          </form>
        )}
      </section>

      <section className={box}>
        <h2 className="text-sm font-semibold">What the client sees</h2>
        <p className="text-sm whitespace-pre-wrap">{e.clientFacingSummary}</p>
        <h3 className="text-xs font-semibold text-muted-foreground pt-2">Internal description (never sent to the client)</h3>
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{e.internalDescription}</p>
      </section>

      {e.drafts.length > 0 && (
        <section className={box}>
          <h2 className="text-sm font-semibold">Messages to the client</h2>
          {e.drafts.map((d) => (
            <form key={d.id} className="space-y-2" onSubmit={(ev) => { ev.preventDefault(); void post(`/api/client-incidents/drafts/${d.id}/send`, { body: new FormData(ev.currentTarget).get("body") }, "Message sent."); }}>
              <p className="text-xs text-muted-foreground">{d.channel === "slack" ? "Reply in the client's Slack thread" : "Reply to the client's email"} · {d.status}{d.sentAt ? ` ${new Date(d.sentAt).toLocaleString()}` : ""}</p>
              <textarea name="body" defaultValue={d.body} disabled={d.status !== "draft"} rows={3} aria-label="Message to the client" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
              {d.status === "draft" && (
                <div className="flex gap-2">
                  <button type="submit" className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md inline-flex items-center gap-1"><Send size={12} /> Send</button>
                  {d.channel === "email" && <button type="button" onClick={(ev) => { const f = (ev.currentTarget.closest("form") as HTMLFormElement); void post(`/api/client-incidents/drafts/${d.id}/send`, { body: new FormData(f).get("body"), markSentManually: true }, "Recorded as sent from Outlook."); }} className="px-3 py-1.5 text-xs border border-border rounded-md">I sent it from Outlook</button>}
                </div>
              )}
            </form>
          ))}
        </section>
      )}

      {e.clientTicketKey && e.state !== "closed" && (
        <section className={box}>
          <h2 className="text-sm font-semibold">Post client update</h2>
          {e.fourEyes && <p className="text-xs text-muted-foreground">{e.severity}: a second team member must approve each update before it is posted.</p>}
          <form className="space-y-2" onSubmit={(ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); void post(`/api/client-incidents/${id}/updates`, { body: f.get("body"), ...(f.get("targetStatus") ? { targetStatus: f.get("targetStatus") } : {}) }, e.fourEyes ? "Update saved; waiting for a second approver." : "Update posted to the client."); ev.currentTarget.reset(); }}>
            <textarea name="body" required minLength={5} maxLength={2000} rows={3} aria-label="Client update" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            <div className="flex gap-2 items-center">
              <select name="targetStatus" aria-label="Client-visible status" className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option value="">Keep status</option><option>Investigating</option><option>Update provided</option></select>
              <button type="submit" className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md">Post update</button>
            </div>
          </form>
          <ul className="text-xs space-y-1">
            {e.updates.map((u) => (
              <li key={u.id} className="border-t border-border/50 pt-1">
                <span className="text-muted-foreground">{u.kind} · {u.status}{u.postedAt ? ` ${new Date(u.postedAt).toLocaleString()}` : ""}:</span> {u.body}
                {u.status === "pending_approval" && !u.mine && <button onClick={() => void post(`/api/client-incidents/${id}/updates/${u.id}/review`, {}, "Update reviewed and posted.")} className="ml-2 text-primary">Review and post</button>}
                {u.status === "pending_approval" && u.mine && <span className="ml-2 text-muted-foreground">(waiting for a second team member)</span>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 flex-wrap">
            {["Investigating", "Update provided"].map((s) => <button key={s} onClick={() => void post(`/api/client-incidents/${id}/status`, { status: s }, `Client status set to ${s}.`)} className="px-2 py-1 text-xs border border-border rounded-md">Set “{s}”</button>)}
          </div>
          <p className="text-xs text-muted-foreground">Closing requires the write-up and a client-facing resolution message, which moves the client request to Resolved.</p>
        </section>
      )}
    </div>
  );
}

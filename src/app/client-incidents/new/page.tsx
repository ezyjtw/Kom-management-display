"use client";

/**
 * Raise an incident or risk from a message (spec §9.7). The client-facing
 * summary is the only text the client sees; the internal description never
 * leaves KOMmand Centre. The server enforces every rule (H12).
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, AlertTriangle } from "lucide-react";

interface Context {
  client: { id: string; displayName: string };
  portalUsers: number | null;
  warning: string | null;
  canNotify: boolean;
  replyChannel: "slack" | "email" | null;
  categories: Array<{ code: string; label: string; complianceSensitive: boolean }>;
}

const field = "mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

function RaiseForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const source = ((): Record<string, string> | null => {
    const kind = params.get("kind");
    if (kind === "slack") return { kind, channelId: params.get("channelId") ?? "", ts: params.get("ts") ?? "" };
    if (kind === "email") return { kind, messageRecordId: params.get("messageRecordId") ?? "" };
    if (kind === "work_item") return { kind, workItemId: params.get("workItemId") ?? "" };
    return null;
  })();

  useEffect(() => {
    if (!source) { setError("Open this form from a Slack message, an email or a work item."); return; }
    void fetch(`/api/client-incidents/context?${new URLSearchParams(source)}`).then(async (r) => {
      const json = await r.json().catch(() => null);
      if (r.ok && json?.success) setCtx(json.data);
      else setError(json?.error ?? "Could not load the source.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const selected = ctx?.categories.find((c) => c.code === category);

  async function submit(form: HTMLFormElement) {
    setSubmitting(true);
    setError(null);
    const f = new FormData(form);
    const res = await fetch("/api/client-incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: f.get("type"),
        source,
        severity: f.get("severity"),
        category,
        clientFacingSummary: f.get("clientFacingSummary"),
        internalDescription: f.get("internalDescription"),
        affectedReferences: String(f.get("affectedReferences") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
        notifyClientNow: f.get("notifyClientNow") === "on",
      }),
    });
    const json = await res.json().catch(() => null);
    setSubmitting(false);
    if (res.ok && json?.success) router.push(`/client-incidents/${json.data.id}`);
    else setError([json?.error, ...(json?.issues ?? [])].filter(Boolean).join(" ") || "Not raised.");
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><ShieldAlert size={22} className="text-primary" /> Raise incident / risk</h1>
      {error && <p role="alert" className="p-3 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">{error}</p>}
      {ctx && (
        <form className="space-y-3 bg-card border border-border rounded-xl p-4" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
          <p className="text-sm">Client: <strong>{ctx.client.displayName}</strong></p>
          {ctx.warning && <p className="text-xs text-amber-500 flex gap-1 items-center"><AlertTriangle size={12} aria-hidden /> {ctx.warning}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-muted-foreground">Type<select name="type" required className={field}><option value="incident">Incident</option><option value="risk">Risk</option></select></label>
            <label className="text-xs text-muted-foreground">Severity<select name="severity" required defaultValue="P2" className={field}>{["P0", "P1", "P2", "P3"].map((p) => <option key={p}>{p}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Category
              <select required value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                <option value="" disabled>Choose…</option>
                {ctx.categories.map((c) => <option key={c.code} value={c.code}>{c.label}{c.complianceSensitive ? " (compliance-sensitive)" : ""}</option>)}
              </select>
            </label>
          </div>
          {selected?.complianceSensitive && (
            <p role="note" className="text-xs text-amber-500">Compliance-sensitive: no client-visible ticket is created (tipping-off risk). Compliance is alerted; an admin can create the client request after recording the Compliance decision.</p>
          )}
          <label className="block text-xs text-muted-foreground">Client-facing summary (the only text the client sees; plain language, no other clients, no internal detail)
            <textarea name="clientFacingSummary" required minLength={10} maxLength={1000} rows={3} className={field} />
          </label>
          <label className="block text-xs text-muted-foreground">Internal description (team only; never sent to the client)
            <textarea name="internalDescription" required minLength={10} maxLength={10000} rows={5} className={field} />
          </label>
          <label className="block text-xs text-muted-foreground">Affected references (optional, one per line; internal only)
            <textarea name="affectedReferences" rows={2} className={field} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notifyClientNow" defaultChecked={!selected?.complianceSensitive} disabled={!ctx.canNotify || selected?.complianceSensitive} />
            Prepare a message telling the client where to follow it {ctx.replyChannel ? `(${ctx.replyChannel}; you review and send it)` : "(no reply channel for this source)"}
          </label>
          <button type="submit" disabled={submitting} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50">{submitting ? "Raising…" : "Raise"}</button>
        </form>
      )}
    </div>
  );
}

export default function RaisePage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}><RaiseForm /></Suspense>;
}

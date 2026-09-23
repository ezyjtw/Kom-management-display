"use client";

/**
 * Team boards (spec §12). The server enforces the rules (spec §10.2); this page
 * shows the checks and tasks per team and sends evidence, exceptions and skip
 * requests. Proposed evidence from automated data pulls must still be
 * recorded explicitly by the operator.
 */

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, XCircle, SkipForward, ShieldCheck, Download } from "lucide-react";
import type { BoardCard, BoardItem } from "@/modules/daily-checks/board";

const TEAMS = ["Team 1", "Team 2", "Team 3", "All"] as const;
type Form = { itemId: string; kind: "pass" | "issues" | "skip" } | null;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  pass: "bg-emerald-500/10 text-emerald-400",
  issues_found: "bg-red-500/10 text-red-400",
  skipped: "bg-amber-500/10 text-amber-400",
};

function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BoardsPage() {
  const [team, setTeam] = useState<(typeof TEAMS)[number]>("Team 1");
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const json = await fetch(`/api/boards?team=${encodeURIComponent(team)}`).then((r) => r.json()).catch(() => null);
    setCards(json?.success ? json.data : []);
    setLoading(false);
  }, [team]);
  useEffect(() => { void load(); }, [load]);

  async function send(url: string, method: string, body: unknown, done: string) {
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage({ ok: false, text: [json?.error, ...(json?.issues ?? [])].filter(Boolean).join(" ") || "The change was rejected." });
      return;
    }
    setMessage({ ok: true, text: done });
    setForm(null);
    await load();
  }

  function submitPass(card: BoardCard, item: BoardItem, el: HTMLFormElement) {
    const f = new FormData(el);
    const fields: Record<string, string | number> = {};
    for (const name of card.requiredFields) {
      const v = String(f.get(`field:${name}`) ?? "");
      fields[name] = v !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
    }
    const asOf = String(f.get("dataAsOf") ?? "");
    void send("/api/daily-checks", "PATCH", {
      itemId: item.id,
      status: "pass",
      evidence: {
        recordCount: f.get("recordCount") === "" ? undefined : Number(f.get("recordCount")),
        dataAsOf: asOf ? new Date(asOf).toISOString() : undefined,
        source: String(f.get("source") ?? ""),
        fields,
      },
    }, `${card.code} recorded as pass.`);
  }

  function submitExceptions(card: BoardCard, item: BoardItem, el: HTMLFormElement) {
    const rows = String(new FormData(el).get("rows") ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [summary, reference] = l.split("|").map((p) => p.trim());
      return { summary, ...(reference ? { reference } : {}) };
    });
    void send(`/api/daily-checks/items/${item.id}/exceptions`, "POST", { exceptions: rows }, `${rows.length} exception(s) recorded for ${card.code}; each gets a ticket.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><ClipboardList size={24} className="text-primary" /> Team Boards</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Every recurring check and task, by owning team. Due times are UK time.</p>
        </div>
        <button onClick={() => void load()} aria-label="Refresh" className="p-2 text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
      </div>

      <div role="tablist" className="flex gap-2 flex-wrap">
        {TEAMS.map((t) => (
          <button key={t} role="tab" aria-selected={team === t} onClick={() => setTeam(t)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${team === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:bg-accent/50"}`}>
            {t}
          </button>
        ))}
      </div>

      {message && (
        <div role={message.ok ? "status" : "alert"} className={`p-3 rounded-lg text-sm border ${message.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cards.map((card) => (
            <section key={card.code} className="bg-card rounded-xl border border-border p-4 space-y-3">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{card.code} · {card.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {card.team} · {card.kind} · {card.frequency}{/^\d/.test(card.dueByLocal) ? ` · due ${card.dueByLocal}` : ""} · tickets in {card.ticketProject}
                    {card.openWorkItems > 0 && ` · ${card.openWorkItems} open work item(s)`}
                  </p>
                </div>
                {card.confluenceUrl ? (
                  <a href={card.confluenceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary flex items-center gap-1 shrink-0">Process <ExternalLink size={12} /></a>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0" title={card.confluenceTitle ?? ""}>Confluence link not set</span>
                )}
              </header>

              {card.banners.map((b) => (
                <p key={b} className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> {b}</p>
              ))}
              {card.knownIssues.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Known issues ({card.knownIssues.length})</summary>
                  <ul className="mt-1 space-y-0.5 list-disc pl-4">{card.knownIssues.map((k) => <li key={k.id}><strong>{k.id}</strong>: {k.text}</li>)}</ul>
                </details>
              )}
              {card.evidenceNotes && <p className="text-xs text-muted-foreground">Evidence: {card.evidenceNotes}{card.requiredFields.length ? ` (plus ${card.requiredFields.join(", ")})` : ""}</p>}

              {card.items.length === 0 && !card.banners.length && (
                <p className="text-xs text-muted-foreground">{card.kind === "task" && ["event", "continuous"].includes(card.frequency) ? "Tracked as work items as they arise." : "Nothing due today."}</p>
              )}

              {card.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{item.periodKey}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[item.status] ?? ""}`}>{item.status.replace("_", " ")}</span>
                  </div>
                  {item.status === "pass" && item.dataAsOf && <p className="text-xs text-muted-foreground">{item.recordCount} record(s), data as of {new Date(item.dataAsOf).toLocaleString()}</p>}
                  {item.status === "issues_found" && <p className="text-xs text-red-400">{item.exceptionCount} exception(s) ticketed</p>}
                  {item.status === "pending" && item.skipRequestedBy && <p className="text-xs text-amber-400">Skip requested: {item.skippedReason}. Awaiting a different lead or admin.</p>}

                  {item.proposal && item.status === "pending" && (
                    <div className="text-xs bg-muted/40 rounded p-2 space-y-1">
                      {item.proposal.available ? (
                        <>
                          <p>Collected {new Date(item.proposal.collectedAt).toLocaleTimeString()}: {item.proposal.recordCount} record(s) from {item.proposal.source}, data as of {item.proposal.dataAsOf ? new Date(item.proposal.dataAsOf).toLocaleString() : "?"}.</p>
                          {Object.keys(item.proposal.fields).length > 0 && <p>{Object.entries(item.proposal.fields).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
                          {item.proposal.exceptions.length > 0 && <p className="text-red-400">{item.proposal.exceptions.length} proposed exception(s).</p>}
                          {item.proposal.suppressed.length > 0 && <p className="text-amber-400">{item.proposal.suppressed.length} suppressed (known degraded): {item.proposal.suppressed.map((x) => `${x.summary} — ${x.reason}`).join("; ")}</p>}
                        </>
                      ) : (
                        <p className="text-amber-400">Automated pull unavailable: {item.proposal.reason}</p>
                      )}
                      {item.proposal.notes.map((n) => <p key={n} className="text-muted-foreground">{n}</p>)}
                    </div>
                  )}

                  {item.status === "pending" && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {card.hasCollector && (
                        <button onClick={() => void send(`/api/daily-checks/items/${item.id}/collect`, "POST", {}, `Data pulled for ${card.code}.`)} className="px-2 py-1 text-xs bg-blue-500/10 text-blue-400 rounded-md flex items-center gap-1"><Download size={12} /> Pull data</button>
                      )}
                      <button onClick={() => setForm({ itemId: item.id, kind: "pass" })} className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded-md flex items-center gap-1"><CheckCircle2 size={12} /> Pass with evidence</button>
                      <button onClick={() => setForm({ itemId: item.id, kind: "issues" })} className="px-2 py-1 text-xs bg-red-500/10 text-red-400 rounded-md flex items-center gap-1"><XCircle size={12} /> Record exceptions</button>
                      {item.skipRequestedBy ? (
                        <button onClick={() => void send(`/api/daily-checks/items/${item.id}/skip-signoff`, "POST", {}, `Skip signed off for ${card.code}.`)} className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded-md flex items-center gap-1"><ShieldCheck size={12} /> Sign off skip</button>
                      ) : (
                        <button onClick={() => setForm({ itemId: item.id, kind: "skip" })} className="px-2 py-1 text-xs bg-amber-500/10 text-amber-400 rounded-md flex items-center gap-1"><SkipForward size={12} /> Request skip</button>
                      )}
                    </div>
                  )}

                  {form?.itemId === item.id && form.kind === "pass" && (
                    <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submitPass(card, item, e.currentTarget); }}>
                      <label className="text-xs text-muted-foreground">Record count<input name="recordCount" type="number" min={0} required defaultValue={item.proposal?.recordCount ?? ""} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                      <label className="text-xs text-muted-foreground">Data as of<input name="dataAsOf" type="datetime-local" required defaultValue={toLocalInput(item.proposal?.dataAsOf)} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                      <label className="text-xs text-muted-foreground sm:col-span-2">Source<input name="source" required maxLength={200} defaultValue={item.proposal?.source ?? ""} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                      {card.requiredFields.map((name) => (
                        <label key={name} className="text-xs text-muted-foreground">{name}<input name={`field:${name}`} required defaultValue={String(item.proposal?.fields[name] ?? "")} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                      ))}
                      <button type="submit" className="sm:col-span-2 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg">Record pass</button>
                    </form>
                  )}
                  {form?.itemId === item.id && form.kind === "issues" && (
                    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submitExceptions(card, item, e.currentTarget); }}>
                      <label className="text-xs text-muted-foreground block">One exception per line: <code>summary | reference</code>. Each becomes a work item and a {card.ticketProject} ticket.
                        <textarea name="rows" required rows={4} defaultValue={(item.proposal?.exceptions ?? []).map((x) => `${x.summary}${x.reference ? ` | ${x.reference}` : ""}`).join("\n")} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" />
                      </label>
                      <button type="submit" className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg">Record exceptions</button>
                    </form>
                  )}
                  {form?.itemId === item.id && form.kind === "skip" && (
                    <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); void send("/api/daily-checks", "PATCH", { itemId: item.id, status: "skipped", skippedReason: String(new FormData(e.currentTarget).get("reason") ?? "") }, `Skip requested for ${card.code}.`); }}>
                      <label className="text-xs text-muted-foreground flex-1">Reason<input name="reason" required minLength={5} maxLength={1000} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                      <button type="submit" className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg">Request skip</button>
                    </form>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

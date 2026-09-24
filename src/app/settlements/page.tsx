"use client";

/**
 * OES settlement monitoring (spec §12 CHK-10): a read-only matching view from
 * the Komainu API, one row per portfolio per settlement window. There are no
 * approval actions: settlement approvals happen in the platforms (H1).
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { ArrowDownUp, RefreshCw, AlertTriangle, ExternalLink, MessageSquarePlus } from "lucide-react";
import type { SettlementRow, SettlementView } from "@/modules/settlements/matching-view";

const STATUS: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-400",
  failed: "bg-red-500/10 text-red-400",
  partial: "bg-red-500/10 text-red-400",
  in_progress: "bg-blue-500/10 text-blue-400",
  pending: "bg-blue-500/10 text-blue-400",
  no_record: "bg-amber-500/10 text-amber-400",
  not_started: "bg-muted text-muted-foreground",
  unknown: "bg-amber-500/10 text-amber-400",
};

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function SettlementsPage() {
  const [date, setDate] = useState(londonToday());
  const [view, setView] = useState<SettlementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const json = await fetch(`/api/settlements?date=${date}`).then((r) => r.json()).catch(() => null);
    setView(json?.success ? json.data : null);
    setLoading(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  async function post(url: string, body: unknown, done: string) {
    setMessage(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setMessage(res.ok ? { ok: true, text: done } : { ok: false, text: json?.error ?? "Not saved." });
    if (res.ok) await load();
  }

  const rowKey = (r: SettlementRow) => `${r.windowKey}|${r.portfolioId ?? r.settlementId}`;
  const windows = [...new Set((view?.rows ?? []).map((r) => r.windowKey))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><ArrowDownUp size={24} className="text-primary" /> OES Settlement Monitoring</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Read-only matching view from the Komainu API. Approvals happen in the platforms, not here.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ml-1 h-8 rounded-md border border-border bg-background px-2 text-sm" /></label>
          <button onClick={() => void load()} aria-label="Refresh" className="p-2 text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
        </div>
      </div>

      {message && <div role={message.ok ? "status" : "alert"} className={`p-3 rounded-lg text-sm border ${message.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>{message.text}</div>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && view && windows.length === 0 && <p className="text-sm text-muted-foreground">No settlement windows or portfolios for this date.</p>}

      {!loading && view && windows.map((wk) => {
        const rows = view.rows.filter((r) => r.windowKey === wk);
        return (
          <section key={wk} className="bg-card rounded-xl border border-border overflow-hidden">
            <h2 className="px-4 py-2 text-sm font-semibold border-b border-border">{rows[0].exchange.toUpperCase()} window {new Date(rows[0].windowStart).toISOString().slice(11, 16)} UTC <span className="text-xs text-muted-foreground font-normal">({rows.length} row(s))</span></h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2">Portfolio</th><th>Settlement</th><th>Status</th><th>Alerts</th><th>Ticket</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={rowKey(r)}>
                    <tr className="border-t border-border/50 align-top">
                      <td className="px-4 py-2 text-xs">{r.portfolioId ?? <span className="text-amber-400">unmatched</span>}</td>
                      <td className="text-xs">{r.settlementId ?? "—"}</td>
                      <td><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[r.mappedStatus] ?? STATUS.unknown}`}>{r.mappedStatus.replace("_", " ")}</span></td>
                      <td className="text-xs">{r.alerts.map((a) => <div key={a.id} className={a.status === "resolved" ? "text-muted-foreground" : "text-red-400"}>{a.ruleCode} ({a.status})</div>)}</td>
                      <td className="text-xs">{r.ticketUrl ? <a href={r.ticketUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">{r.ticketKey} <ExternalLink size={10} /></a> : r.ticketKey ?? "—"}</td>
                      <td className="pr-4"><button onClick={() => setOpen(open === rowKey(r) ? null : rowKey(r))} className="text-xs text-primary">{open === rowKey(r) ? "Hide" : "Timeline & notes"}</button></td>
                    </tr>
                    {open === rowKey(r) && (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-4 py-3 space-y-3">
                          <ol className="text-xs space-y-0.5">{r.timeline.map((t, i) => <li key={i}><span className="text-muted-foreground">{new Date(t.at).toLocaleString()}</span> — {t.label}</li>)}</ol>
                          {r.notes.map((n, i) => <p key={i} className="text-xs"><span className="text-muted-foreground">{new Date(n.at).toLocaleString()}:</span> {n.text}</p>)}

                          {r.exposure && (
                            <div className="rounded-lg border border-red-500/30 p-3 space-y-2">
                              <p className="text-xs font-semibold text-red-400 flex items-center gap-1"><AlertTriangle size={12} /> End-of-day failure (ALR-OES-06): client notification</p>
                              <p className="text-xs">{view.clientTemplateUrl
                                ? <a href={view.clientTemplateUrl} target="_blank" rel="noreferrer" className="text-primary">Client-notification template (FB OES Collateral Settlement Monitoring)</a>
                                : "Client-notification template: Confluence \"FB OES Collateral Settlement Monitoring\" (link not configured yet)."}</p>
                              <p className="text-xs text-amber-400">{view.cf39}</p>
                              <p className="text-xs">Exposure: {r.exposure.exposureUsd != null ? `USD ${r.exposure.exposureUsd}` : "not recorded"}. Band: {r.exposure.band ?? <strong>not chosen (required)</strong>}</p>
                              <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); void post(`/api/work-items/${r.exposure!.workItemId}/exposure-band`, { band: String(new FormData(e.currentTarget).get("band") ?? "") }, "Exposure band recorded."); }}>
                                {view.exposureBands.length ? (
                                  <select name="band" required aria-label="Exposure band" className="h-8 rounded-md border border-border bg-background px-2 text-xs">{view.exposureBands.map((b) => <option key={b}>{b}</option>)}</select>
                                ) : (
                                  <input name="band" required aria-label="Exposure band" placeholder="Exposure band" className="h-8 rounded-md border border-border bg-background px-2 text-xs" />
                                )}
                                <button type="submit" className="px-2 py-1 text-xs bg-red-600 text-white rounded-md">Record band</button>
                              </form>
                            </div>
                          )}

                          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text") ?? ""); void post("/api/settlements/notes", { windowKey: r.windowKey, portfolioId: r.portfolioId ?? r.settlementId, text }, "Note added."); e.currentTarget.reset(); }}>
                            <input name="text" required maxLength={2000} placeholder="Add a note" aria-label="Note" className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-xs" />
                            <button type="submit" className="px-2 py-1 text-xs border border-border rounded-md flex items-center gap-1"><MessageSquarePlus size={12} /> Add note</button>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

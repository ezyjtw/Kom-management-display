"use client";

import { useState, useEffect } from "react";
import { RefreshCw, ClipboardCheck, CheckCircle2, XCircle, SkipForward, Copy, ShieldCheck } from "lucide-react";
import { CheckStatusBadge } from "@/components/shared/StatusBadge";
import type { DailyCheckRunEntry } from "@/types";

export default function DailyChecksPage() {
  const [run, setRun] = useState<DailyCheckRunEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRun, setNoRun] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openForm, setOpenForm] = useState<{ itemId: string; kind: "pass" | "issues" | "skip" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/daily-checks");
      const json = await res.json();
      if (json.success && json.data) {
        setRun(json.data);
        setNoRun(false);
      } else {
        setRun(null);
        setNoRun(true);
      }
    } catch (err) { console.error("Failed to load daily checks:", err); setRun(null); setNoRun(true); } finally { setLoading(false); }
  }

  async function createRun() {
    setCreating(true);
    try {
      await fetch("/api/daily-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      await fetchData();
    } catch { /* */ } finally { setCreating(false); }
  }

  /** The server enforces the rules (spec §10.2); errors are shown as returned. */
  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError([json?.error, ...(json?.issues ?? [])].filter(Boolean).join(" ") || "The change was rejected.");
      return false;
    }
    setOpenForm(null);
    await fetchData();
    return true;
  }

  function submitPass(itemId: string, form: HTMLFormElement) {
    const f = new FormData(form);
    const asOf = String(f.get("dataAsOf") || "");
    return send("/api/daily-checks", "PATCH", {
      itemId,
      status: "pass",
      evidence: {
        recordCount: f.get("recordCount") === "" ? undefined : Number(f.get("recordCount")),
        dataAsOf: asOf ? new Date(asOf).toISOString() : undefined,
        source: String(f.get("source") || ""),
      },
    });
  }

  function submitExceptions(itemId: string, form: HTMLFormElement) {
    const f = new FormData(form);
    const exceptions = String(f.get("rows") || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [summary, reference] = line.split("|").map((p) => p.trim());
        return { summary, ...(reference ? { reference } : {}) };
      });
    return send(`/api/daily-checks/items/${itemId}/exceptions`, "POST", { exceptions });
  }

  function submitSkip(itemId: string, form: HTMLFormElement) {
    const f = new FormData(form);
    return send("/api/daily-checks", "PATCH", { itemId, status: "skipped", skippedReason: String(f.get("reason") || "") });
  }

  function generateJiraSummary() {
    if (!run) return;
    const lines = run.items.map((item) => {
      const icon = item.status === "pass" ? "(/) " : item.status === "issues_found" ? "(x) " : "(-) ";
      return `${icon}${item.name}: ${item.status === "pass" ? "OK" : item.status === "issues_found" ? "ISSUES — " + (item.notes || "see details") : item.status}`;
    });
    const summary = `*Daily Ops Checks — ${new Date(run.date).toLocaleDateString()}*\nOperator: ${run.operatorName}\n\n${lines.join("\n")}`;
    navigator.clipboard.writeText(summary);

    fetch("/api/daily-checks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.id, jiraSummary: summary }),
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardCheck size={24} className="text-primary" /> Daily Ops Checks
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Structured daily operational checklist</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50"><RefreshCw size={16} /></button>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg text-sm bg-red-500/10 text-red-400 border border-red-500/20">{error}</div>
      )}

      {noRun && !run && (
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <ClipboardCheck size={40} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground mb-4">No check run started for today.</p>
          <button onClick={createRun} disabled={creating} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {creating ? "Creating..." : "Start Today's Checks"}
          </button>
        </div>
      )}

      {run && (
        <>
          {/* Progress bar */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">
                Progress: {run.progress.completed}/{run.progress.total} checks completed
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-emerald-400">{run.progress.passed} pass</span>
                <span className="text-red-400">{run.progress.issues} issues</span>
              </div>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${run.progress.total > 0 ? (run.progress.completed / run.progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Check items */}
          <div className="space-y-2">
            {run.items.map((item) => (
              <div key={item.id} className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <CheckStatusBadge status={item.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.category.replace(/_/g, " ")}</p>
                  {item.notes && <p className="text-xs text-muted-foreground mt-1 italic">{item.notes}</p>}
                </div>

                {item.status === "pending" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => setOpenForm({ itemId: item.id, kind: "pass" })} className="p-2 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20" title="Pass (with evidence)">
                      <CheckCircle2 size={14} />
                    </button>
                    <button onClick={() => setOpenForm({ itemId: item.id, kind: "issues" })} className="p-2 text-xs bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20" title="Record exceptions">
                      <XCircle size={14} />
                    </button>
                    {item.skipRequestedBy ? (
                      <button onClick={() => send(`/api/daily-checks/items/${item.id}/skip-signoff`, "POST", {})} className="p-2 text-xs bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20" title="Approve skip (lead/admin, not the requester)">
                        <ShieldCheck size={14} />
                      </button>
                    ) : (
                      <button onClick={() => setOpenForm({ itemId: item.id, kind: "skip" })} className="p-2 text-xs bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20" title="Request skip">
                        <SkipForward size={14} />
                      </button>
                    )}
                  </div>
                )}
                </div>

                {item.status === "pending" && item.skipRequestedBy && (
                  <p className="text-xs text-amber-400 mt-2">Skip requested: {item.skippedReason}. Awaiting approval by a different lead or admin.</p>
                )}
                {item.status === "pass" && item.dataAsOf && (
                  <p className="text-xs text-muted-foreground mt-2">Evidence: {item.recordCount} record(s), data as of {new Date(item.dataAsOf).toLocaleString()}</p>
                )}
                {item.status === "issues_found" && (
                  <p className="text-xs text-red-400 mt-2">{item.exceptionWorkItemIds?.length ?? 0} exception(s) ticketed</p>
                )}

                {openForm?.itemId === item.id && openForm.kind === "pass" && (
                  <form className="mt-3 grid gap-2 sm:grid-cols-4 items-end" onSubmit={(e) => { e.preventDefault(); submitPass(item.id, e.currentTarget); }}>
                    <label className="text-xs text-muted-foreground">Record count<input name="recordCount" type="number" min={0} required className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                    <label className="text-xs text-muted-foreground">Data as of<input name="dataAsOf" type="datetime-local" required className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                    <label className="text-xs text-muted-foreground">Source<input name="source" required maxLength={200} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                    <button type="submit" className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg">Record pass</button>
                  </form>
                )}
                {openForm?.itemId === item.id && openForm.kind === "issues" && (
                  <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); submitExceptions(item.id, e.currentTarget); }}>
                    <label className="text-xs text-muted-foreground block">One exception per line: <code>summary | reference</code>. Each gets a ticket.
                      <textarea name="rows" required rows={3} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" />
                    </label>
                    <button type="submit" className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg">Record exceptions</button>
                  </form>
                )}
                {openForm?.itemId === item.id && openForm.kind === "skip" && (
                  <form className="mt-3 flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); submitSkip(item.id, e.currentTarget); }}>
                    <label className="text-xs text-muted-foreground flex-1">Reason for skipping<input name="reason" required minLength={5} maxLength={1000} className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm" /></label>
                    <button type="submit" className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded-lg">Request skip</button>
                  </form>
                )}
              </div>
            ))}
          </div>

          {/* Jira summary generator */}
          <div className="flex items-center gap-3">
            <button onClick={generateJiraSummary} className="flex items-center gap-2 px-4 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent/50 text-foreground">
              <Copy size={16} /> Copy Jira Summary
            </button>
            {run.completedAt && (
              <p className="text-xs text-emerald-400 flex items-center gap-1">
                <CheckCircle2 size={12} /> All checks completed
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

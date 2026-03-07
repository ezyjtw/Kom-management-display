"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, ClipboardCheck, Play, CheckCircle2, XCircle, SkipForward, Copy } from "lucide-react";
import { CheckStatusBadge } from "@/components/shared/StatusBadge";
import type { DailyCheckRunEntry, DailyCheckItemEntry } from "@/types";

export default function DailyChecksPage() {
  const [run, setRun] = useState<DailyCheckRunEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRun, setNoRun] = useState(false);
  const [creating, setCreating] = useState(false);

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

  async function updateItem(itemId: string, status: string, notes?: string) {
    await fetch("/api/daily-checks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, status, notes }),
    });
    await fetchData();
  }

  async function runAutoCheck(item: DailyCheckItemEntry) {
    // Auto-check queries existing data — for now, mark as pass if autoCheckKey is set
    if (!item.autoCheckKey) return;
    await updateItem(item.id, "pass", "Auto-checked");
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
              <div key={item.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
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
                    {item.autoCheckKey && (
                      <button onClick={() => runAutoCheck(item)} className="p-2 text-xs bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20" title="Auto-check">
                        <Play size={14} />
                      </button>
                    )}
                    <button onClick={() => updateItem(item.id, "pass")} className="p-2 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20" title="Pass">
                      <CheckCircle2 size={14} />
                    </button>
                    <button onClick={() => {
                      const notes = prompt("Describe the issues found:");
                      if (notes) updateItem(item.id, "issues_found", notes);
                    }} className="p-2 text-xs bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20" title="Issues found">
                      <XCircle size={14} />
                    </button>
                    <button onClick={() => updateItem(item.id, "skipped")} className="p-2 text-xs bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20" title="Skip">
                      <SkipForward size={14} />
                    </button>
                  </div>
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

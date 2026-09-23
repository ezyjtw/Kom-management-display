"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

interface Rule {
  code: string;
  name: string;
  ownerTeam: string | null;
  clock: string | null;
  severity: string;
  enabled: boolean;
  evaluated: boolean;
  autoResolve: boolean;
  params: Record<string, unknown>;
  effectiveParams: Record<string, unknown>;
  missingConfirm: string[];
  version: number;
}

/** Alert catalogue (spec §11.2). Rules ship disabled; CONFIRM placeholders block enabling. */
export default function AlertRulesTab() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<{ code: string; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const json = await fetch("/api/admin/alert-rules").then((r) => r.json()).catch(() => null);
    if (json?.success) setRules(json.data);
  }
  useEffect(() => { void load(); }, []);

  async function patch(code: string, body: unknown) {
    setMessage(null);
    const json = await fetch(`/api/admin/alert-rules/${code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    setMessage(json?.success ? `${code} saved.` : `Not saved: ${json?.error ?? "unknown error"}`);
    if (json?.success) setEditing(null);
    await load();
  }

  function saveParams() {
    if (!editing) return;
    try {
      void patch(editing.code, { params: JSON.parse(editing.text) });
    } catch {
      setMessage("Parameters must be valid JSON.");
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><BellRing size={18} /> Alert Rules</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Every rule ships disabled. Enable rules one by one once thresholds are confirmed. A parameter shown as null is a
          CONFIRM placeholder and blocks enabling. Alerts are informational only: approvals stay in GX.
        </p>
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="py-2">Rule</th><th>Owner / clock</th><th>Severity</th><th>Source</th><th>Enabled</th><th />
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code} className="border-b border-border/50 align-top">
              <td className="py-2">
                <div className="font-medium text-foreground">{r.code}</div>
                <div className="text-xs text-muted-foreground">{r.name} · v{r.version}</div>
                {r.missingConfirm.length > 0 && <div className="text-xs text-amber-400 mt-1">Needs: {r.missingConfirm.join(", ")}</div>}
                {editing?.code === r.code && (
                  <div className="mt-2 space-y-1">
                    <textarea
                      aria-label={`Parameters for ${r.code}`}
                      value={editing.text}
                      onChange={(e) => setEditing({ code: r.code, text: e.target.value })}
                      rows={6}
                      className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                    />
                    <button onClick={saveParams} className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md">Save parameters</button>
                  </div>
                )}
              </td>
              <td className="text-xs text-muted-foreground">{r.ownerTeam}<br />{r.clock}</td>
              <td className="text-xs">{r.severity}</td>
              <td className="text-xs text-muted-foreground">{r.evaluated ? "engine" : "event / job"}{r.autoResolve ? " · auto-resolves" : ""}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Enable ${r.code}`}
                  checked={r.enabled}
                  onChange={(e) => patch(r.code, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <button
                  onClick={() => setEditing({ code: r.code, text: JSON.stringify(r.effectiveParams, null, 2) })}
                  className="px-2 py-1 text-xs border border-border rounded-md hover:bg-accent/50"
                >
                  Parameters
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

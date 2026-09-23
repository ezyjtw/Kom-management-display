"use client";

import { useEffect, useState } from "react";
import { Timer, Save } from "lucide-react";
import { SlaTargetsBanner } from "./SlaTargetsBanner";

interface Policy {
  id: string;
  code: string;
  description: string;
  ownershipMins: number | null;
  firstRespMins: number | null;
  resolveMins: number | null;
  resolveRule: string | null;
  calendar: string;
  warnAtPct: number;
  version: number;
  isActive: boolean;
}

type Field = "ownershipMins" | "firstRespMins" | "resolveMins";
const FIELDS: Array<[Field, string]> = [["ownershipMins", "Ownership (min)"], ["firstRespMins", "First response (min)"], ["resolveMins", "Resolution (min)"]];

export default function SlaPoliciesTab() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [notSet, setNotSet] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Record<Field, string>>>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const json = await fetch("/api/admin/sla-policies").then((r) => r.json()).catch(() => null);
    if (json?.success) {
      setPolicies(json.data.policies);
      setNotSet(json.data.targetsNotSet);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save(p: Policy) {
    const e = edits[p.id] ?? {};
    const body: Record<string, number | null> = {};
    for (const [f] of FIELDS) {
      if (e[f] === undefined) continue;
      const v = e[f]!.trim();
      body[f] = v === "" ? null : Number(v);
    }
    if (Object.keys(body).length === 0) return;
    const json = await fetch(`/api/admin/sla-policies/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    setMessage(json?.success ? `${p.code} saved (v${json.data.version}).` : `Could not save ${p.code}: targets must be whole minutes.`);
    if (json?.success) {
      setEdits((prev) => ({ ...prev, [p.id]: {} }));
      await load();
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Timer size={18} /> SLA Policies</h2>
        <p className="text-xs text-muted-foreground mt-1">Blank means not set. Changes are versioned and audit-logged.</p>
      </div>
      <SlaTargetsBanner codes={notSet} />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="py-2 pr-3">Policy</th>
            {FIELDS.map(([, label]) => <th key={label} className="py-2 pr-3">{label}</th>)}
            <th className="py-2 pr-3">Calendar</th><th className="py-2 pr-3">Status</th><th />
          </tr></thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id} className="border-b border-border/50 align-top">
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{p.code} <span className="text-xs text-muted-foreground">v{p.version}</span></div>
                  <div className="text-xs text-muted-foreground max-w-xs">{p.description}</div>
                  {p.resolveRule === "next_business_day_eod" && <div className="text-xs text-muted-foreground">Resolve: end of next business day (T+1)</div>}
                </td>
                {FIELDS.map(([f]) => (
                  <td key={f} className="py-2 pr-3">
                    <input
                      aria-label={`${p.code} ${f}`}
                      inputMode="numeric"
                      className="w-24 h-8 rounded-md border border-input bg-background px-2 text-sm"
                      placeholder="not set"
                      value={edits[p.id]?.[f] ?? (p[f] === null ? "" : String(p[f]))}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: { ...prev[p.id], [f]: e.target.value } }))}
                    />
                  </td>
                ))}
                <td className="py-2 pr-3 text-xs">{p.calendar}</td>
                <td className="py-2 pr-3 text-xs">{notSet.includes(p.code) ? "Targets not set" : "Set"}</td>
                <td className="py-2"><button onClick={() => save(p)} className="flex items-center gap-1 text-xs text-primary hover:underline"><Save size={12} /> Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

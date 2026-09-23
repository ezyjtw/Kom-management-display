"use client";

import { useEffect, useState } from "react";
import { Database, Trash2 } from "lucide-react";

type Row = Record<string, unknown>;
const input = "h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground";

/** Spec §12 reference data: team leads, asset status (CF-26) and the approved validator set (CF-10, CF-24). */
export default function ReferenceDataTab() {
  const [teams, setTeams] = useState<Row[]>([]);
  const [assets, setAssets] = useState<Row[]>([]);
  const [validators, setValidators] = useState<Row[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const get = (t: string) => fetch(`/api/admin/reference/${t}`).then((r) => r.json()).then((j) => (j?.success ? j.data : [])).catch(() => []);
    setTeams(await get("team-config"));
    setAssets(await get("asset-status"));
    setValidators(await get("approved-validators"));
  }
  useEffect(() => { void load(); }, []);

  async function call(table: string, method: "PUT" | "DELETE", body?: Row, key?: string) {
    setMessage(null);
    const json = await fetch(`/api/admin/reference/${table}${key ? `?key=${encodeURIComponent(key)}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json()).catch(() => null);
    setMessage(json?.success ? "Saved." : `Not saved: ${json?.error ?? "unknown error"}`);
    await load();
  }

  const form = (onSubmit: (f: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); e.currentTarget.reset(); };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Database size={18} /> Reference Data</h2>
        <p className="text-xs text-muted-foreground mt-1">Team ownership, asset status and the approved validator set used by the daily checks. Every change is audit-logged.</p>
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Team leads (fixed teams, no rotation)</h3>
        {teams.map((t) => (
          <form key={String(t.team)} className="flex gap-2 items-center flex-wrap" onSubmit={form((f) => call("team-config", "PUT", { team: t.team, leadEmployeeId: String(f.get("lead") || "") || null, deputyEmployeeId: String(f.get("deputy") || "") || null }))}>
            <span className="text-xs w-16">{String(t.team)}</span>
            <input name="lead" aria-label={`${t.team} lead employee id`} placeholder="Lead employee id" defaultValue={String(t.leadEmployeeId ?? "")} className={input} />
            <input name="deputy" aria-label={`${t.team} deputy employee id`} placeholder="Deputy employee id" defaultValue={String(t.deputyEmployeeId ?? "")} className={input} />
            <button type="submit" className="px-2 py-1 text-xs border border-border rounded-md">Save</button>
          </form>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Asset status (CF-26)</h3>
        <p className="text-xs text-muted-foreground">Known degraded or sunset assets are listed but not ticketed by CHK-01, with the reason shown.</p>
        {assets.map((a) => (
          <div key={String(a.asset)} className="flex gap-2 items-center text-xs">
            <span className="w-16 font-medium">{String(a.asset)}</span><span className="w-28">{String(a.status)}</span><span className="flex-1 text-muted-foreground">{String(a.reason)}</span>
            <button aria-label={`Remove ${a.asset}`} onClick={() => void call("asset-status", "DELETE", undefined, String(a.asset))}><Trash2 size={12} /></button>
          </div>
        ))}
        <form className="flex gap-2 flex-wrap" onSubmit={form((f) => call("asset-status", "PUT", { asset: f.get("asset"), status: f.get("status"), reason: f.get("reason") }))}>
          <input name="asset" required placeholder="Asset" aria-label="Asset" className={input} />
          <select name="status" aria-label="Status" className={input}><option value="known_degraded">known degraded</option><option value="sunset">sunset</option><option value="normal">normal</option></select>
          <input name="reason" placeholder="Reason" aria-label="Reason" className={`${input} flex-1`} />
          <button type="submit" className="px-2 py-1 text-xs border border-border rounded-md">Save</button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Approved validators (CF-10, CF-24)</h3>
        {validators.length === 0 && <p className="text-xs text-amber-400">Approved validator set not defined: control 5.1 cannot be evidenced.</p>}
        {validators.map((v) => (
          <div key={String(v.id)} className="flex gap-2 items-center text-xs">
            <span className="w-24">{String(v.chain)}</span><span className="flex-1">{String(v.validator)}</span>
            <button aria-label={`Remove ${v.validator}`} onClick={() => void call("approved-validators", "DELETE", undefined, String(v.id))}><Trash2 size={12} /></button>
          </div>
        ))}
        <form className="flex gap-2 flex-wrap" onSubmit={form((f) => call("approved-validators", "PUT", { chain: f.get("chain"), validator: f.get("validator"), notes: f.get("notes") ?? "" }))}>
          <input name="chain" required placeholder="Chain" aria-label="Chain" className={input} />
          <input name="validator" required placeholder="Validator" aria-label="Validator" className={`${input} flex-1`} />
          <input name="notes" placeholder="Notes" aria-label="Notes" className={input} />
          <button type="submit" className="px-2 py-1 text-xs border border-border rounded-md">Add</button>
        </form>
      </section>
    </div>
  );
}

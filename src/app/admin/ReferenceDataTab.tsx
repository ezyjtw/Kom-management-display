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
  const [breakTypes, setBreakTypes] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [gxRules, setGxRules] = useState<Row[]>([]);
  const [uatTemplates, setUatTemplates] = useState<Row[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const get = (t: string) => fetch(`/api/admin/reference/${t}`).then((r) => r.json()).then((j) => (j?.success ? j.data : [])).catch(() => []);
    setTeams(await get("team-config"));
    setAssets(await get("asset-status"));
    setValidators(await get("approved-validators"));
    setBreakTypes(await get("otc-break-types"));
    setCategories(await get("incident-categories"));
    setGxRules(await get("gx-impact-rules"));
    setUatTemplates(await get("uat-templates"));
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

  const list = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const joined = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
  const ruleBody = (f: FormData, id?: string) => ({
    ...(id ? { id } : {}), name: f.get("name"), matchOn: f.get("matchOn"), pattern: f.get("pattern"), taskCodes: list(f.get("taskCodes")), alertCodes: list(f.get("alertCodes")),
    controls: list(f.get("controls")), team: f.get("team") || "All", uatTemplate: f.get("uatTemplate") ?? "", priority: f.get("priority") || "P2", isActive: f.get("isActive") === "on",
  });
  const keepForm = (onSubmit: (f: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); };
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
          <form key={String(t.team)} className="flex gap-2 items-center flex-wrap" onSubmit={form((f) => call("team-config", "PUT", { team: t.team, leadEmployeeId: String(f.get("lead") || "") || null, deputyEmployeeId: String(f.get("deputy") || "") || null, memberEmployeeIds: String(f.get("members") || "").split(",").map((x) => x.trim()).filter(Boolean) }))}>
            <span className="text-xs w-16">{String(t.team)}</span>
            <input name="lead" aria-label={`${t.team} lead employee id`} placeholder="Lead employee id" defaultValue={String(t.leadEmployeeId ?? "")} className={input} />
            <input name="deputy" aria-label={`${t.team} deputy employee id`} placeholder="Deputy employee id" defaultValue={String(t.deputyEmployeeId ?? "")} className={input} />
            <input name="members" aria-label={`${t.team} member employee ids`} placeholder="Member employee ids, comma-separated" defaultValue={Array.isArray(t.memberEmployeeIds) ? (t.memberEmployeeIds as string[]).join(", ") : ""} className={input} />
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
        <h3 className="text-sm font-semibold">Incident and risk categories (§9.7)</h3>
        <p className="text-xs text-muted-foreground">Compliance-sensitive categories never create a client-visible ticket without a recorded Compliance decision (tipping-off risk).</p>
        {categories.map((c) => (
          <div key={String(c.code)} className="flex gap-2 items-center text-xs">
            <span className="w-48 font-medium">{String(c.code)}</span><span className="flex-1">{String(c.label)}</span>
            <span>{c.complianceSensitive ? "compliance-sensitive" : "client ticket"}</span><span>{c.isActive ? "active" : "inactive"}</span>
            {c.isActive ? <button aria-label={`Deactivate ${c.code}`} onClick={() => void call("incident-categories", "DELETE", undefined, String(c.code))}><Trash2 size={12} /></button> : null}
          </div>
        ))}
        <form className="flex gap-2 flex-wrap" onSubmit={form((f) => call("incident-categories", "PUT", { code: f.get("code"), label: f.get("label"), complianceSensitive: f.get("complianceSensitive") === "on" }))}>
          <input name="code" required placeholder="code" aria-label="Category code" className={input} />
          <input name="label" required placeholder="Label" aria-label="Category label" className={`${input} flex-1`} />
          <label className="text-xs flex items-center gap-1"><input type="checkbox" name="complianceSensitive" /> compliance-sensitive</label>
          <button type="submit" className="px-2 py-1 text-xs border border-border rounded-md">Save</button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">OTC break types (CHK-02)</h3>
        <p className="text-xs text-muted-foreground">From Confluence &quot;2.3 OTC Break Types&quot;. While the list is empty, MTD breaks are recorded as unclassified.</p>
        {breakTypes.map((b) => (
          <div key={String(b.code)} className="flex gap-2 items-center text-xs">
            <span className="w-40 font-medium">{String(b.code)}</span><span className="flex-1">{String(b.label)}</span><span>{b.isActive ? "active" : "inactive"}</span>
            <button aria-label={`Remove ${b.code}`} onClick={() => void call("otc-break-types", "DELETE", undefined, String(b.code))}><Trash2 size={12} /></button>
          </div>
        ))}
        <form className="flex gap-2 flex-wrap" onSubmit={form((f) => call("otc-break-types", "PUT", { code: f.get("code"), label: f.get("label"), description: f.get("description") ?? "" }))}>
          <input name="code" required placeholder="code (e.g. missing_tx)" aria-label="Break type code" className={input} />
          <input name="label" required placeholder="Label" aria-label="Break type label" className={`${input} flex-1`} />
          <input name="description" placeholder="Description" aria-label="Break type description" className={input} />
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

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">GX impact rules (§16.3)</h3>
        <p className="text-xs text-muted-foreground">Which GX sprint changes affect which tasks, alerts and controls. Seeded from the spec and inactive until reviewed (CONFIRM-GX-IMPACT-RULES). Every save increases the version and is audit-logged.</p>
        {gxRules.map((r) => (
          <form key={String(r.id)} className="flex gap-1 flex-wrap items-center text-xs border-t border-border/50 pt-1" onSubmit={keepForm((f) => call("gx-impact-rules", "PUT", ruleBody(f, String(r.id))))}>
            <input name="name" defaultValue={String(r.name)} aria-label="Rule name" className={`${input} w-44`} />
            <select name="matchOn" defaultValue={String(r.matchOn)} aria-label="Match on" className={input}><option>section</option><option>workstream</option><option>keyword</option><option>jira_project</option></select>
            <input name="pattern" defaultValue={String(r.pattern)} aria-label="Pattern (regular expression)" className={`${input} w-40 font-mono`} />
            <input name="taskCodes" defaultValue={joined(r.taskCodes)} aria-label="Task codes" placeholder="Tasks" className={`${input} w-40`} />
            <input name="alertCodes" defaultValue={joined(r.alertCodes)} aria-label="Alert codes" placeholder="Alerts" className={`${input} w-28`} />
            <input name="controls" defaultValue={joined(r.controls)} aria-label="Controls" placeholder="Controls" className={`${input} w-20`} />
            <input name="team" defaultValue={String(r.team)} aria-label="Team" className={`${input} w-28`} />
            <input name="uatTemplate" defaultValue={String(r.uatTemplate ?? "")} aria-label="UAT template" className={`${input} w-32`} />
            <select name="priority" defaultValue={String(r.priority)} aria-label="Priority" className={input}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select>
            <label className="flex items-center gap-1"><input type="checkbox" name="isActive" defaultChecked={!!r.isActive} /> active</label>
            <span className="text-muted-foreground">v{String(r.version)}</span>
            <button type="submit" className="px-2 py-1 border border-border rounded-md">Save</button>
          </form>
        ))}
        <form className="flex gap-1 flex-wrap text-xs" onSubmit={form((f) => call("gx-impact-rules", "PUT", ruleBody(f)))}>
          <input name="name" required placeholder="New rule name" aria-label="New rule name" className={`${input} w-44`} />
          <select name="matchOn" aria-label="New rule match on" className={input}><option>section</option><option>workstream</option><option>keyword</option><option>jira_project</option></select>
          <input name="pattern" required placeholder="Pattern" aria-label="New rule pattern" className={`${input} w-40 font-mono`} />
          <input name="taskCodes" placeholder="Tasks, comma-separated" aria-label="New rule tasks" className={`${input} w-40`} />
          <input name="team" placeholder="Team" aria-label="New rule team" className={`${input} w-28`} />
          <button type="submit" className="px-2 py-1 border border-border rounded-md">Add (inactive)</button>
        </form>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">UAT test outlines (§16.5)</h3>
        <p className="text-xs text-muted-foreground">Written by the team, never generated. Until a template has steps, its UAT tickets say &quot;Test outline not yet written: owner to define&quot;.</p>
        {uatTemplates.map((t) => (
          <details key={String(t.code)} className="text-xs border-t border-border/50 pt-1">
            <summary>{String(t.code)} — {String(t.title)} {String(t.steps ?? "").trim() ? "" : <span className="text-amber-500">(not written)</span>}</summary>
            <form className="space-y-1 mt-1" onSubmit={keepForm((f) => call("uat-templates", "PUT", { code: t.code, title: f.get("title"), steps: f.get("steps"), expectedResults: f.get("expectedResults"), evidenceRequired: f.get("evidenceRequired") }))}>
              <input name="title" defaultValue={String(t.title)} aria-label="Template title" className={`${input} w-full`} />
              <textarea name="steps" defaultValue={String(t.steps ?? "")} aria-label="Test steps" placeholder="Test steps (Markdown)" rows={4} className="w-full rounded-md border border-input bg-background p-2 text-xs" />
              <textarea name="expectedResults" defaultValue={String(t.expectedResults ?? "")} aria-label="Expected results" placeholder="Expected results" rows={2} className="w-full rounded-md border border-input bg-background p-2 text-xs" />
              <input name="evidenceRequired" defaultValue={String(t.evidenceRequired ?? "")} aria-label="Evidence required" placeholder="Evidence required" className={`${input} w-full`} />
              <button type="submit" className="px-2 py-1 border border-border rounded-md">Save</button>
            </form>
          </details>
        ))}
      </section>
    </div>
  );
}

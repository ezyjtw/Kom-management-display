"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Save, X } from "lucide-react";

type ChannelKind = "slack" | "email_domain" | "teams" | "slack_user";

interface Channel { kind: ChannelKind; ref: string }
interface Client {
  id: string;
  displayName: string;
  komainuOrgId: string | null;
  komainuAccountNos: string[];
  jsmOrganizationId: string | null;
  jurisdiction: string;
  isActive: boolean;
  channels: Channel[];
}

type Draft = Omit<Client, "id" | "komainuAccountNos"> & { id?: string; accountNosText: string };

const KIND_LABEL: Record<ChannelKind, string> = { slack: "Slack channel ID", email_domain: "Email domain", teams: "Teams channel ID", slack_user: "Client Slack user ID" };
const EMPTY: Draft = { displayName: "", komainuOrgId: "", jsmOrganizationId: "", jurisdiction: "", isActive: true, channels: [], accountNosText: "" };

const input = "w-full h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

export default function ClientsTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const json = await fetch("/api/admin/clients").then((r) => r.json()).catch(() => null);
    if (json?.success) setClients(json.data);
  }
  useEffect(() => { void load(); }, []);

  function edit(c: Client) {
    setError(null);
    setDraft({ ...c, komainuOrgId: c.komainuOrgId ?? "", jsmOrganizationId: c.jsmOrganizationId ?? "", accountNosText: c.komainuAccountNos.join(", ") });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const { id, accountNosText, ...rest } = draft;
    const body = {
      ...rest,
      komainuAccountNos: accountNosText.split(",").map((s) => s.trim()).filter(Boolean),
      channels: draft.channels.filter((c) => c.ref.trim()).map((c) => ({ kind: c.kind, ref: c.ref.trim() })),
    };
    const res = await fetch(id ? `/api/admin/clients/${id}` : "/api/admin/clients", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!json?.success) {
      setError(typeof json?.error === "string" ? json.error : "Could not save. Check the fields and try again.");
      return;
    }
    setDraft(null);
    await load();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Building2 size={18} /> Clients &amp; Channels</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Maps incoming Slack channels, email domains and Teams channels to a client. Clients are deactivated, never deleted.
          </p>
        </div>
        {!draft && (
          <button onClick={() => { setError(null); setDraft({ ...EMPTY, channels: [] }); }} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            <Plus size={14} /> Add client
          </button>
        )}
      </div>

      {draft && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          {error && <div role="alert" className="bg-red-500/10 text-red-400 text-sm px-3 py-2 rounded">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">Display name
              <input className={input} value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground">Jurisdiction (servicing entity)
              <select className={input} value={draft.jurisdiction} onChange={(e) => setDraft({ ...draft, jurisdiction: e.target.value })}>
                <option value="">Not set</option><option>UK</option><option>JE</option><option>AE</option><option>EU</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Komainu organisation ID
              <input className={input} value={draft.komainuOrgId ?? ""} onChange={(e) => setDraft({ ...draft, komainuOrgId: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground">JSM organisation ID
              <input className={input} value={draft.jsmOrganizationId ?? ""} onChange={(e) => setDraft({ ...draft, jsmOrganizationId: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground md:col-span-2">Komainu account numbers (comma-separated)
              <input className={input} value={draft.accountNosText} onChange={(e) => setDraft({ ...draft, accountNosText: e.target.value })} />
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Channels</p>
            {draft.channels.map((c, i) => (
              <div key={i} className="flex gap-2">
                <select className={`${input} max-w-[180px]`} value={c.kind}
                  onChange={(e) => setDraft({ ...draft, channels: draft.channels.map((x, j) => (j === i ? { ...x, kind: e.target.value as ChannelKind } : x)) })}>
                  {(Object.keys(KIND_LABEL) as ChannelKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <input className={input} placeholder={c.kind === "email_domain" ? "example.com" : c.kind === "slack" ? "C01234ABCDE" : c.kind === "slack_user" ? "U01234ABCDE" : "Teams channel ID"} value={c.ref}
                  onChange={(e) => setDraft({ ...draft, channels: draft.channels.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)) })} />
                <button aria-label="Remove channel" onClick={() => setDraft({ ...draft, channels: draft.channels.filter((_, j) => j !== i) })} className="px-2 text-muted-foreground hover:text-foreground"><X size={14} /></button>
              </div>
            ))}
            <button onClick={() => setDraft({ ...draft, channels: [...draft.channels, { kind: "slack", ref: "" }] })} className="text-xs text-primary hover:underline">+ Add channel</button>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> Active
          </label>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !draft.displayName.trim()} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50"><Save size={14} /> {saving ? "Saving..." : "Save"}</button>
            <button onClick={() => setDraft(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients yet. Add one to start mapping channels.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Jurisdiction</th><th className="py-2 pr-3">Channels</th><th className="py-2 pr-3">Status</th><th />
            </tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium text-foreground">{c.displayName}</td>
                  <td className="py-2 pr-3">{c.jurisdiction || "—"}</td>
                  <td className="py-2 pr-3 text-xs">{c.channels.length === 0 ? "—" : c.channels.map((ch) => `${KIND_LABEL[ch.kind]}: ${ch.ref}`).join(" · ")}</td>
                  <td className="py-2 pr-3">{c.isActive ? "Active" : "Inactive"}</td>
                  <td className="py-2 text-right"><button onClick={() => edit(c)} className="text-xs text-primary hover:underline">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

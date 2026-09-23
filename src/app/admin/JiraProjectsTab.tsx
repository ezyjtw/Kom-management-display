"use client";

import { useEffect, useState } from "react";
import { Ticket, RefreshCw } from "lucide-react";

interface Project {
  key: string;
  name: string;
  purpose: string;
  kind: string;
  enabled: boolean;
  syncInbound: boolean;
  issueTypeIds: Record<string, string>;
}

/** Local routing for Jira/JSM projects (spec §8.3, §10.1). Never changes Jira. */
export default function JiraProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const json = await fetch("/api/admin/jira-projects").then((r) => r.json()).catch(() => null);
    if (json?.success) setProjects(json.data);
  }
  useEffect(() => { void load(); }, []);

  async function call(url: string, method: string, body?: unknown) {
    setMessage(null);
    const json = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    setMessage(json?.success ? "Saved." : `Not saved: ${json?.error ?? "unknown error"}`);
    await load();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Ticket size={18} /> Jira Projects</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Tickets are only created in enabled projects with a default issue type. Discover issue types from Jira, choose the
          default, then enable. This changes KOMmand Centre&apos;s routing only; Jira configuration is never modified.
        </p>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b border-border">
            <th className="py-2">Project</th><th>Purpose</th><th>Default issue type</th><th>Inbound sync</th><th>Enabled</th><th />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const types = Object.entries(p.issueTypeIds ?? {}).filter(([name]) => name !== "_default");
            const current = types.find(([, id]) => id === p.issueTypeIds?._default)?.[0] ?? "";
            return (
              <tr key={p.key} className="border-b border-border/50 align-top">
                <td className="py-2 font-medium text-foreground">{p.key}<div className="text-xs text-muted-foreground">{p.name} ({p.kind})</div></td>
                <td className="text-xs text-muted-foreground max-w-xs">{p.purpose}</td>
                <td>
                  <select
                    value={current}
                    disabled={types.length === 0}
                    onChange={(e) => call(`/api/admin/jira-projects/${p.key}`, "PATCH", { defaultIssueType: e.target.value })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="" disabled>{types.length ? "Choose…" : "Not discovered"}</option>
                    {types.map(([name]) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={p.syncInbound} onChange={(e) => call(`/api/admin/jira-projects/${p.key}`, "PATCH", { syncInbound: e.target.checked })} /></td>
                <td><input type="checkbox" checked={p.enabled} onChange={(e) => call(`/api/admin/jira-projects/${p.key}`, "PATCH", { enabled: e.target.checked })} /></td>
                <td>
                  <button onClick={() => call(`/api/admin/jira-projects/${p.key}/discover`, "POST")} className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-accent/50">
                    <RefreshCw size={12} /> Discover
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

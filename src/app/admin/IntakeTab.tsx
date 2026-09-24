"use client";

import { useEffect, useState } from "react";
import { Inbox, Save } from "lucide-react";

interface Row { key: string; label: string; value: unknown; default: unknown }

const input = "w-full h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function toText(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fromText(text: string, like: unknown): unknown {
  if (Array.isArray(like)) return text.split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof like === "number") return Number(text);
  if (like === null || typeof like === "object") return text.trim() ? JSON.parse(text) : null;
  return text;
}

export default function IntakeTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const json = await fetch("/api/admin/settings").then((r) => r.json()).catch(() => null);
    if (json?.success) setRows(json.data);
  }
  useEffect(() => { void load(); }, []);

  async function save(key: string, value: unknown) {
    setMessage(null);
    const json = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).then((r) => r.json()).catch(() => null);
    setMessage(json?.success ? `${key} saved.` : `Not saved: ${json?.error ?? "unknown error"}`);
    if (json?.success) {
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
      await load();
    }
  }

  const route = rows.find((r) => r.key === "intake.slack.route")?.value;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><Inbox size={18} /> Client Intake</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Client questions become JSM requests (spec §9). Only one Slack route may be active. The kommand route needs the
          JSM service desk, request type and the custody provider&apos;s Slack workspace id; jsm_native needs the completed verification record.
          Switch off the <code>:inbox_tray:</code> Slack-to-VND skill when intake goes live (see docs/phase1/intake-cutover.md).
        </p>
      </div>
      <div role="status" className="text-sm">Current Slack route: <strong>{String(route ?? "off")}</strong></div>
      {message && <p role="alert" className="text-sm text-muted-foreground">{message}</p>}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-1 md:grid-cols-[260px_1fr_auto] gap-2 items-center">
            <label htmlFor={`s-${r.key}`} className="text-sm text-foreground">
              {r.label}
              <span className="block text-[11px] text-muted-foreground font-mono">{r.key}</span>
            </label>
            {r.key === "intake.slack.route" ? (
              <select id={`s-${r.key}`} className={input} value={drafts[r.key] ?? String(r.value)} onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}>
                <option value="off">off</option>
                <option value="kommand">kommand (KOMmand Centre creates requests)</option>
                <option value="jsm_native">jsm_native (JSM&apos;s Slack integration creates requests)</option>
              </select>
            ) : typeof r.default === "boolean" ? (
              <input id={`s-${r.key}`} type="checkbox" checked={drafts[r.key] !== undefined ? drafts[r.key] === "true" : r.value === true}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: String(e.target.checked) }))} />
            ) : (
              <input id={`s-${r.key}`} className={input} value={drafts[r.key] ?? toText(r.value)}
                placeholder={r.key === "intake.slack.jsmNativeVerification" ? '{"completedBy":"...","completedAt":"2026-...Z","evidenceUrl":"https://..."}' : ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))} />
            )}
            <button
              disabled={drafts[r.key] === undefined}
              onClick={() => {
                try {
                  const raw = drafts[r.key];
                  const value = typeof r.default === "boolean" ? raw === "true" : fromText(raw, r.default);
                  void save(r.key, value);
                } catch {
                  setMessage(`Not saved: ${r.key} is not valid JSON.`);
                }
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg disabled:opacity-40"
            >
              <Save size={12} /> Save
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Flag, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  roles: string[];
  teams: string[];
  percentage: number;
}

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newFlag, setNewFlag] = useState({ key: "", name: "", description: "", enabled: false, percentage: 100 });

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/feature-flags");
      const json = await res.json();
      if (json.success) {
        setFlags(json.data.flags || []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function toggleFlag(flag: FeatureFlag) {
    await fetch("/api/feature-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...flag, enabled: !flag.enabled }),
    });
    fetchData();
  }

  async function deleteFlag(key: string) {
    if (!confirm(`Delete feature flag "${key}"?`)) return;
    await fetch(`/api/feature-flags?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    fetchData();
  }

  async function addFlag() {
    if (!newFlag.key || !newFlag.name) return;
    await fetch("/api/feature-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newFlag),
    });
    setNewFlag({ key: "", name: "", description: "", enabled: false, percentage: 100 });
    setShowAdd(false);
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading flags...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <Flag size={24} /> Feature Flags
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md">
            <Plus size={14} /> Add Flag
          </button>
          <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Add flag form */}
      {showAdd && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">New Feature Flag</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
              placeholder="Flag key (e.g. sse_notifications)"
              value={newFlag.key}
              onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value })}
            />
            <input
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
              placeholder="Display name"
              value={newFlag.name}
              onChange={(e) => setNewFlag({ ...newFlag, name: e.target.value })}
            />
            <input
              className="bg-background border border-border rounded px-3 py-1.5 text-sm"
              placeholder="Description"
              value={newFlag.description}
              onChange={(e) => setNewFlag({ ...newFlag, description: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newFlag.enabled} onChange={(e) => setNewFlag({ ...newFlag, enabled: e.target.checked })} />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              Rollout %:
              <input
                type="number" min={0} max={100}
                className="bg-background border border-border rounded px-2 py-1 text-sm w-20"
                value={newFlag.percentage}
                onChange={(e) => setNewFlag({ ...newFlag, percentage: parseInt(e.target.value) || 0 })}
              />
            </label>
            <button onClick={addFlag} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-md">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">Cancel</button>
          </div>
        </div>
      )}

      {/* Flag list */}
      {flags.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No feature flags configured.</div>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => (
            <div key={flag.key} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <button onClick={() => toggleFlag(flag)} className="flex-shrink-0">
                  {flag.enabled
                    ? <ToggleRight size={24} className="text-emerald-400" />
                    : <ToggleLeft size={24} className="text-muted-foreground" />
                  }
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{flag.name}</span>
                    <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{flag.key}</code>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {flag.description || "No description"}
                    {flag.percentage < 100 && <span className="ml-2 text-yellow-400">{flag.percentage}% rollout</span>}
                    {flag.roles.length > 0 && <span className="ml-2">Roles: {flag.roles.join(", ")}</span>}
                    {flag.teams.length > 0 && <span className="ml-2">Teams: {flag.teams.join(", ")}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => deleteFlag(flag.key)} className="text-muted-foreground hover:text-red-400 flex-shrink-0">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

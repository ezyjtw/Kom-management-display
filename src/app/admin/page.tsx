"use client";

import { useState, useEffect } from "react";
import { Settings, Save, Users, BarChart3, Shield, Clock, Link2, UserPlus } from "lucide-react";
import type { ScoringConfigData, Category } from "@/types";

const categoryLabels: Record<Category, string> = {
  daily_tasks: "Daily Tasks",
  projects: "Projects / Docs",
  asset_actions: "Asset Actions",
  quality: "Mistakes vs Positives",
  knowledge: "Crypto Knowledge",
};

export default function AdminPage() {
  const [config, setConfig] = useState<ScoringConfigData | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"weights" | "targets" | "employees" | "knowledge" | "users" | "integrations">("weights");

  // Integration status
  const [slackStatus, setSlackStatus] = useState<{ configured: boolean; channels: string[] } | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ configured: boolean; inbox: string | null; smtpConfigured: boolean } | null>(null);
  const [syncingSlack, setSyncingSlack] = useState(false);
  const [syncingEmail, setSyncingEmail] = useState(false);
  const [slackChannelInput, setSlackChannelInput] = useState("");
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // New user form
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", role: "employee", password: "" });

  // Knowledge scoring state
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [knowledgeForm, setKnowledgeForm] = useState({
    operationalUnderstanding: 5,
    assetKnowledge: 5,
    complianceAwareness: 5,
    incidentResponse: 5,
    notes: "",
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/scoring-config").then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()).catch(() => ({ success: false })),
      fetch("/api/integrations/slack").then((r) => r.json()).catch(() => ({ success: false })),
      fetch("/api/integrations/email").then((r) => r.json()).catch(() => ({ success: false })),
    ])
      .then(([configJson, empJson, usersJson, slackJson, emailJson]) => {
        if (configJson.success) {
          const parsed =
            typeof configJson.data.config === "string"
              ? JSON.parse(configJson.data.config)
              : configJson.data.config;
          setConfig(parsed);
        }
        if (empJson.success) setEmployees(empJson.data || []);
        if (usersJson.success) setUsers(usersJson.data || []);
        if (slackJson.success) setSlackStatus(slackJson.data);
        if (emailJson.success) setEmailStatus(emailJson.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    try {
      const newVersion = `${config.version.split(".").slice(0, 2).join(".")}.${
        parseInt(config.version.split(".")[2] || "0") + 1
      }`;
      await fetch("/api/scoring-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: newVersion,
          config,
          createdBy: "admin",
          notes: "Updated via admin panel",
        }),
      });
      setConfig({ ...config, version: newVersion });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function updateWeight(category: Category, value: number) {
    if (!config) return;
    setConfig({
      ...config,
      weights: { ...config.weights, [category]: value },
    });
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading admin panel...</div>;
  }

  async function createUser() {
    if (!newUserForm.name || !newUserForm.email || !newUserForm.password) return;
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUserForm),
      });
      const json = await res.json();
      if (json.success) {
        setUsers((prev) => [...prev, json.data]);
        setNewUserForm({ name: "", email: "", role: "employee", password: "" });
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function triggerSlackSync() {
    if (!slackChannelInput.trim()) return;
    setSyncingSlack(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: slackChannelInput.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setSyncResult(`Slack sync complete: ${json.data.threadsSynced} threads from #${json.data.channelName}`);
      } else {
        setSyncResult(`Slack sync error: ${json.error}`);
      }
    } catch (err) {
      setSyncResult(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingSlack(false);
    }
  }

  async function triggerEmailSync() {
    setSyncingEmail(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        setSyncResult(`Email sync complete: ${json.data.threadsSynced} threads from ${json.data.inbox}`);
      } else {
        setSyncResult(`Email sync error: ${json.error}`);
      }
    } catch (err) {
      setSyncResult(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingEmail(false);
    }
  }

  const tabs = [
    { key: "weights" as const, label: "Scoring Weights", icon: BarChart3 },
    { key: "targets" as const, label: "Role Targets", icon: Shield },
    { key: "employees" as const, label: "Employees", icon: Users },
    { key: "knowledge" as const, label: "Knowledge Scoring", icon: Clock },
    { key: "users" as const, label: "User Accounts", icon: UserPlus },
    { key: "integrations" as const, label: "Integrations", icon: Link2 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage scoring configuration, employee data, and manual inputs
          </p>
        </div>
        <div className="flex items-center gap-3">
          {config && (
            <span className="text-xs text-muted-foreground">Config v{config.version}</span>
          )}
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save Config"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card border border-border rounded-xl p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "weights" && config && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold mb-4">Category Weights</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Weights determine how each category contributes to the overall score. Must total 1.0 (100%).
          </p>
          <div className="space-y-4">
            {(Object.keys(config.weights) as Category[]).map((cat) => (
              <div key={cat} className="flex items-center gap-4">
                <label className="w-40 text-sm font-medium text-foreground">
                  {categoryLabels[cat]}
                </label>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.05}
                  value={config.weights[cat]}
                  onChange={(e) => updateWeight(cat, parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="w-16 text-sm text-right font-mono">
                  {(config.weights[cat] * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Total</span>
                <span
                  className={`text-sm font-mono font-bold ${
                    Math.abs(
                      Object.values(config.weights).reduce((a, b) => a + b, 0) - 1
                    ) < 0.01
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {(Object.values(config.weights).reduce((a, b) => a + b, 0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <h4 className="text-sm font-semibold mb-2">Score Clamping</h4>
            <div className="flex items-center gap-6">
              <div>
                <label className="text-xs text-muted-foreground">Minimum Score</label>
                <p className="text-lg font-bold text-red-600">{config.clampMin}</p>
              </div>
              <div className="flex-1 h-2 bg-muted rounded-full relative">
                <div
                  className="absolute h-2 bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400 rounded-full"
                  style={{ left: "0%", width: "100%" }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Maximum Score</label>
                <p className="text-lg font-bold text-emerald-600">{config.clampMax}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Scores are displayed on a 1-10 scale but clamped to {config.clampMin}-{config.clampMax} to prevent
              demoralising extremes and inflation.
            </p>
          </div>
        </div>
      )}

      {activeTab === "targets" && config && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold mb-4">Role-Based Targets</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Different targets by seniority level to ensure fair comparison.
          </p>
          <div className="space-y-6">
            {Object.entries(config.targets).map(([role, targets]) => (
              <div key={role} className="p-4 bg-muted/50 rounded-lg">
                <h4 className="text-sm font-semibold text-foreground mb-3">{role}</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Tickets/Week</p>
                    <p className="text-sm font-semibold">{targets.daily_tasks.ticketsPerWeek}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">On-Time Rate</p>
                    <p className="text-sm font-semibold">{(targets.daily_tasks.onTimeRate * 100).toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pages Created/Mo</p>
                    <p className="text-sm font-semibold">{targets.projects.pagesCreatedPerMonth}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Actions/Week</p>
                    <p className="text-sm font-semibold">{targets.asset_actions.actionsPerWeek}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Max Mistakes</p>
                    <p className="text-sm font-semibold">{targets.quality.maxMistakes}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Positive Actions Target</p>
                    <p className="text-sm font-semibold">{targets.quality.positiveActionsTarget}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">SLA Compliance</p>
                    <p className="text-sm font-semibold">
                      {(targets.asset_actions.slaComplianceRate * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cycle Time Target</p>
                    <p className="text-sm font-semibold">{targets.daily_tasks.cycleTimeDays}d</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "employees" && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold mb-4">Team Members</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2">Team</th>
                  <th className="text-left px-3 py-2">Region</th>
                  <th className="text-center px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-b border-border">
                    <td className="px-3 py-2 font-medium">{emp.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{emp.email}</td>
                    <td className="px-3 py-2">{emp.role}</td>
                    <td className="px-3 py-2">{emp.team}</td>
                    <td className="px-3 py-2">{emp.region}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          emp.active
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No employees added yet. Use the seed script or API to add employees.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "knowledge" && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-semibold mb-4">Crypto Knowledge Scoring</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Score each employee on rubric dimensions (1-10). Score is mapped to the 3-8 dashboard range.
          </p>

          <div className="mb-4">
            <label className="text-sm font-medium block mb-1">Select Employee</label>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-2 w-full max-w-xs"
            >
              <option value="">Choose...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.role})
                </option>
              ))}
            </select>
          </div>

          {selectedEmployee && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-4">
              {[
                { key: "operationalUnderstanding", label: "Operational Understanding" },
                { key: "assetKnowledge", label: "Asset-Specific Knowledge" },
                { key: "complianceAwareness", label: "Compliance Awareness" },
                { key: "incidentResponse", label: "Incident Response Competence" },
              ].map((dim) => (
                <div key={dim.key} className="flex items-center gap-4">
                  <label className="w-48 text-sm">{dim.label}</label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={(knowledgeForm as any)[dim.key]}
                    onChange={(e) =>
                      setKnowledgeForm((prev) => ({
                        ...prev,
                        [dim.key]: parseInt(e.target.value),
                      }))
                    }
                    className="flex-1"
                  />
                  <span className="w-12 text-sm text-right font-mono">
                    {(knowledgeForm as any)[dim.key]}/10
                  </span>
                </div>
              ))}
              <div>
                <label className="text-sm block mb-1">Notes</label>
                <textarea
                  value={knowledgeForm.notes}
                  onChange={(e) =>
                    setKnowledgeForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="Training completed, areas for improvement..."
                  className="w-full text-sm border border-border rounded-lg p-2 h-20"
                />
              </div>
              <button className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                Save Knowledge Score
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "users" && (
        <div className="space-y-6">
          {/* Existing Users */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold mb-4">User Accounts</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Manage who can log in to the dashboard. Each user has a role that controls their access level.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Email</th>
                    <th className="text-left px-3 py-2">Role</th>
                    <th className="text-left px-3 py-2">Linked Employee</th>
                    <th className="text-left px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{u.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          u.role === "admin"
                            ? "bg-red-500/10 text-red-400"
                            : u.role === "lead"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-blue-500/10 text-blue-400"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{u.employeeId || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                        No user accounts found. Run the seed script or create one below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Create User */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold mb-4">Create New User</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label className="text-sm font-medium block mb-1">Full Name</label>
                <input
                  type="text"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="John Smith"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Email</label>
                <input
                  type="email"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="john@ops.com"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Role</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, role: e.target.value }))}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                >
                  <option value="employee">Employee</option>
                  <option value="lead">Lead</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Password</label>
                <input
                  type="password"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Initial password"
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            <button
              onClick={createUser}
              disabled={!newUserForm.name || !newUserForm.email || !newUserForm.password}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              <UserPlus size={16} />
              Create User
            </button>
          </div>
        </div>
      )}

      {activeTab === "integrations" && (
        <div className="space-y-6">
          {/* Slack Integration */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Slack Integration</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect Slack channels to automatically import messages as comms threads.
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                slackStatus?.configured
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}>
                {slackStatus?.configured ? "Connected" : "Not Configured"}
              </span>
            </div>

            {!slackStatus?.configured ? (
              <div className="p-4 bg-muted/50 rounded-lg">
                <h4 className="text-sm font-semibold mb-2">Setup Instructions</h4>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>Create a Slack App at api.slack.com/apps</li>
                  <li>Add Bot Token Scopes: <code className="text-xs bg-muted px-1 py-0.5 rounded">channels:history</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">channels:read</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">chat:write</code></li>
                  <li>Install the app to your workspace</li>
                  <li>Copy the Bot User OAuth Token</li>
                  <li>Set <code className="text-xs bg-muted px-1 py-0.5 rounded">SLACK_BOT_TOKEN</code> in your <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code> file</li>
                  <li>Optionally set <code className="text-xs bg-muted px-1 py-0.5 rounded">SLACK_CHANNELS</code> (comma-separated channel IDs)</li>
                  <li>Restart the server</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-4">
                {slackStatus.channels.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Configured channels:</p>
                    <div className="flex gap-2 flex-wrap">
                      {slackStatus.channels.map((ch) => (
                        <span key={ch} className="text-xs bg-muted px-2 py-1 rounded">{ch}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={slackChannelInput}
                    onChange={(e) => setSlackChannelInput(e.target.value)}
                    placeholder="Channel ID (e.g. C01234ABCDE)"
                    className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground w-72"
                  />
                  <button
                    onClick={triggerSlackSync}
                    disabled={syncingSlack}
                    className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {syncingSlack ? "Syncing..." : "Sync Channel"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Email Integration */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Email Integration</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect an email inbox (IMAP) to automatically import emails as comms threads.
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                emailStatus?.configured
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}>
                {emailStatus?.configured ? "Connected" : "Not Configured"}
              </span>
            </div>

            {!emailStatus?.configured ? (
              <div className="p-4 bg-muted/50 rounded-lg">
                <h4 className="text-sm font-semibold mb-2">Setup Instructions</h4>
                <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>For Gmail: Enable IMAP in Gmail settings, generate an App Password</li>
                  <li>For Outlook/Exchange: Use your email server&apos;s IMAP settings</li>
                  <li>Set these environment variables in <code className="text-xs bg-muted px-1 py-0.5 rounded">.env</code>:</li>
                </ol>
                <pre className="mt-2 text-xs bg-background border border-border rounded-lg p-3 overflow-x-auto">{`IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=ops-inbox@yourcompany.com
IMAP_PASSWORD=your-app-password
IMAP_TLS=true

# For sending notifications (optional):
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ops-inbox@yourcompany.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=ops@yourcompany.com`}</pre>
                <p className="text-xs text-muted-foreground mt-2">Restart the server after setting these values.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Connected inbox</p>
                    <p className="text-sm font-medium">{emailStatus.inbox}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">SMTP (outbound)</p>
                    <p className="text-sm font-medium">{emailStatus.smtpConfigured ? "Configured" : "Not set up"}</p>
                  </div>
                </div>
                <button
                  onClick={triggerEmailSync}
                  disabled={syncingEmail}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  {syncingEmail ? "Syncing..." : "Sync Inbox Now"}
                </button>
              </div>
            )}
          </div>

          {/* Sync result message */}
          {syncResult && (
            <div className={`p-4 rounded-lg text-sm ${
              syncResult.includes("error") || syncResult.includes("failed")
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            }`}>
              {syncResult}
            </div>
          )}

          {/* Environment Variables Reference */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-lg font-semibold mb-4">Environment Variables Reference</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2">Variable</th>
                    <th className="text-left px-3 py-2">Purpose</th>
                    <th className="text-center px-3 py-2">Required</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">NEXTAUTH_SECRET</td>
                    <td className="px-3 py-2">Session encryption key</td>
                    <td className="px-3 py-2 text-center">Yes (production)</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">NEXTAUTH_URL</td>
                    <td className="px-3 py-2">App base URL (e.g. https://ops.yourcompany.com)</td>
                    <td className="px-3 py-2 text-center">Yes (production)</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">SLACK_BOT_TOKEN</td>
                    <td className="px-3 py-2">Slack Bot User OAuth Token</td>
                    <td className="px-3 py-2 text-center">For Slack</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">SLACK_CHANNELS</td>
                    <td className="px-3 py-2">Comma-separated Slack channel IDs to sync</td>
                    <td className="px-3 py-2 text-center">Optional</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">IMAP_HOST</td>
                    <td className="px-3 py-2">IMAP server hostname</td>
                    <td className="px-3 py-2 text-center">For Email</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">IMAP_USER</td>
                    <td className="px-3 py-2">IMAP login email</td>
                    <td className="px-3 py-2 text-center">For Email</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">IMAP_PASSWORD</td>
                    <td className="px-3 py-2">IMAP password / app password</td>
                    <td className="px-3 py-2 text-center">For Email</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 font-mono text-xs">SMTP_HOST</td>
                    <td className="px-3 py-2">SMTP server for outbound notifications</td>
                    <td className="px-3 py-2 text-center">Optional</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

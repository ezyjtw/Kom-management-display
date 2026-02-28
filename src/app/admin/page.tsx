"use client";

import { useState, useEffect } from "react";
import { Settings, Save, Users, BarChart3, Shield, Clock } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"weights" | "targets" | "employees" | "knowledge">("weights");

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
    ])
      .then(([configJson, empJson]) => {
        if (configJson.success) {
          const parsed =
            typeof configJson.data.config === "string"
              ? JSON.parse(configJson.data.config)
              : configJson.data.config;
          setConfig(parsed);
        }
        if (empJson.success) setEmployees(empJson.data || []);
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
    return <div className="text-center py-12 text-slate-500">Loading admin panel...</div>;
  }

  const tabs = [
    { key: "weights" as const, label: "Scoring Weights", icon: BarChart3 },
    { key: "targets" as const, label: "Role Targets", icon: Shield },
    { key: "employees" as const, label: "Employees", icon: Users },
    { key: "knowledge" as const, label: "Knowledge Scoring", icon: Clock },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage scoring configuration, employee data, and manual inputs
          </p>
        </div>
        <div className="flex items-center gap-3">
          {config && (
            <span className="text-xs text-slate-400">Config v{config.version}</span>
          )}
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save Config"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors ${
                activeTab === tab.key
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
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
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Category Weights</h3>
          <p className="text-sm text-slate-500 mb-6">
            Weights determine how each category contributes to the overall score. Must total 1.0 (100%).
          </p>
          <div className="space-y-4">
            {(Object.keys(config.weights) as Category[]).map((cat) => (
              <div key={cat} className="flex items-center gap-4">
                <label className="w-40 text-sm font-medium text-slate-700">
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
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Total</span>
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

          <div className="mt-6 p-4 bg-slate-50 rounded-lg">
            <h4 className="text-sm font-semibold mb-2">Score Clamping</h4>
            <div className="flex items-center gap-6">
              <div>
                <label className="text-xs text-slate-500">Minimum Score</label>
                <p className="text-lg font-bold text-red-600">{config.clampMin}</p>
              </div>
              <div className="flex-1 h-2 bg-slate-200 rounded-full relative">
                <div
                  className="absolute h-2 bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400 rounded-full"
                  style={{ left: "0%", width: "100%" }}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Maximum Score</label>
                <p className="text-lg font-bold text-emerald-600">{config.clampMax}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Scores are displayed on a 1-10 scale but clamped to {config.clampMin}-{config.clampMax} to prevent
              demoralising extremes and inflation.
            </p>
          </div>
        </div>
      )}

      {activeTab === "targets" && config && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Role-Based Targets</h3>
          <p className="text-sm text-slate-500 mb-6">
            Different targets by seniority level to ensure fair comparison.
          </p>
          <div className="space-y-6">
            {Object.entries(config.targets).map(([role, targets]) => (
              <div key={role} className="p-4 bg-slate-50 rounded-lg">
                <h4 className="text-sm font-semibold text-slate-800 mb-3">{role}</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-slate-500">Tickets/Week</p>
                    <p className="text-sm font-semibold">{targets.daily_tasks.ticketsPerWeek}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">On-Time Rate</p>
                    <p className="text-sm font-semibold">{(targets.daily_tasks.onTimeRate * 100).toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Pages Created/Mo</p>
                    <p className="text-sm font-semibold">{targets.projects.pagesCreatedPerMonth}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Actions/Week</p>
                    <p className="text-sm font-semibold">{targets.asset_actions.actionsPerWeek}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Max Mistakes</p>
                    <p className="text-sm font-semibold">{targets.quality.maxMistakes}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Positive Actions Target</p>
                    <p className="text-sm font-semibold">{targets.quality.positiveActionsTarget}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">SLA Compliance</p>
                    <p className="text-sm font-semibold">
                      {(targets.asset_actions.slaComplianceRate * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Cycle Time Target</p>
                    <p className="text-sm font-semibold">{targets.daily_tasks.cycleTimeDays}d</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "employees" && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Team Members</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
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
                  <tr key={emp.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{emp.name}</td>
                    <td className="px-3 py-2 text-slate-500">{emp.email}</td>
                    <td className="px-3 py-2">{emp.role}</td>
                    <td className="px-3 py-2">{emp.team}</td>
                    <td className="px-3 py-2">{emp.region}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          emp.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
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
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold mb-4">Crypto Knowledge Scoring</h3>
          <p className="text-sm text-slate-500 mb-6">
            Score each employee on rubric dimensions (1-10). Score is mapped to the 3-8 dashboard range.
          </p>

          <div className="mb-4">
            <label className="text-sm font-medium block mb-1">Select Employee</label>
            <select
              value={selectedEmployee}
              onChange={(e) => setSelectedEmployee(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-full max-w-xs"
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
            <div className="p-4 bg-slate-50 rounded-lg space-y-4">
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
                  className="w-full text-sm border border-slate-200 rounded-lg p-2 h-20"
                />
              </div>
              <button className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Save Knowledge Score
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

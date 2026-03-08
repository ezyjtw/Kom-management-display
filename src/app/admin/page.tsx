"use client";

import { useState, useEffect } from "react";
import { Save, Users, BarChart3, Shield, Clock, Link2, UserPlus, Palette } from "lucide-react";
import type { ScoringConfigData, Category } from "@/types";

import ScoringWeightsTab from "./ScoringWeightsTab";
import RoleTargetsTab from "./RoleTargetsTab";
import EmployeesTab from "./EmployeesTab";
import KnowledgeScoringTab from "./KnowledgeScoringTab";
import UserAccountsTab from "./UserAccountsTab";
import IntegrationsTab from "./IntegrationsTab";
import BrandingTab from "./BrandingTab";
import type { Employee } from "./EmployeesTab";
import type { UserAccount } from "./UserAccountsTab";
import type { SlackStatus, EmailStatus } from "./IntegrationsTab";

const tabs = [
  { key: "weights" as const, label: "Scoring Weights", icon: BarChart3 },
  { key: "targets" as const, label: "Role Targets", icon: Shield },
  { key: "employees" as const, label: "Employees", icon: Users },
  { key: "knowledge" as const, label: "Knowledge Scoring", icon: Clock },
  { key: "users" as const, label: "User Accounts", icon: UserPlus },
  { key: "integrations" as const, label: "Integrations", icon: Link2 },
  { key: "branding" as const, label: "Branding", icon: Palette },
];

type TabKey = (typeof tabs)[number]["key"];

export default function AdminPage() {
  const [config, setConfig] = useState<ScoringConfigData | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("weights");
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);

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
          const parsed = typeof configJson.data.config === "string"
            ? JSON.parse(configJson.data.config) : configJson.data.config;
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
        body: JSON.stringify({ version: newVersion, config, createdBy: "admin", notes: "Updated via admin panel" }),
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
    setConfig({ ...config, weights: { ...config.weights, [category]: value } });
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading admin panel...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage scoring configuration, employee data, and manual inputs
          </p>
        </div>
        <div className="flex items-center gap-3">
          {config && <span className="text-xs text-muted-foreground">Config v{config.version}</span>}
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

      {activeTab === "weights" && config && <ScoringWeightsTab config={config} onUpdateWeight={updateWeight} />}
      {activeTab === "targets" && config && <RoleTargetsTab config={config} />}
      {activeTab === "employees" && <EmployeesTab employees={employees} />}
      {activeTab === "knowledge" && <KnowledgeScoringTab employees={employees} />}
      {activeTab === "users" && (
        <UserAccountsTab users={users} onUserCreated={(u) => setUsers((prev) => [...prev, u])} />
      )}
      {activeTab === "integrations" && (
        <IntegrationsTab slackStatus={slackStatus} emailStatus={emailStatus} />
      )}
      {activeTab === "branding" && <BrandingTab />}
    </div>
  );
}

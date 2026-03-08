"use client";

import { useState } from "react";
import { AlertTriangle, Database, Loader2 } from "lucide-react";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  region: string;
  active: boolean;
}

interface EmployeesTabProps {
  employees: Employee[];
  orphanedUserCount?: number;
  onRefresh?: () => void;
}

export default function EmployeesTab({ employees, orphanedUserCount = 0, onRefresh }: EmployeesTabProps) {
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSeed() {
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await fetch("/api/admin/seed", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setSeedResult({ ok: true, message: json.data.results.join(". ") });
        onRefresh?.();
      } else {
        setSeedResult({ ok: false, message: json.error || "Seed failed" });
      }
    } catch (err) {
      setSeedResult({ ok: false, message: String(err) });
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-4">
      {employees.length === 0 && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <AlertTriangle size={20} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            {orphanedUserCount > 0 && (
              <p className="text-sm font-medium text-amber-400 mb-1">
                {orphanedUserCount} user account{orphanedUserCount !== 1 ? "s" : ""} with missing employee records
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              No employee records found. Click below to seed the database with default employee and user data.
            </p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 disabled:opacity-50 transition-colors"
            >
              {seeding ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              {seeding ? "Seeding..." : "Seed Database"}
            </button>
            {seedResult && (
              <p className={`mt-2 text-xs ${seedResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {seedResult.message}
              </p>
            )}
          </div>
        </div>
      )}

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
    </div>
  );
}

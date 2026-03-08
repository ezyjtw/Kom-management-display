"use client";

import { AlertTriangle } from "lucide-react";

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
}

export default function EmployeesTab({ employees, orphanedUserCount = 0 }: EmployeesTabProps) {
  return (
    <div className="space-y-4">
      {employees.length === 0 && orphanedUserCount > 0 && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <AlertTriangle size={20} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-400">
              {orphanedUserCount} user account{orphanedUserCount !== 1 ? "s" : ""} with missing employee records
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              User accounts exist with linked employee IDs that no longer resolve to Employee records.
              Run the database seed script (<code className="text-amber-400/80">npx prisma db seed</code>) to recreate
              employee records, or check the User Accounts tab to review affected accounts.
            </p>
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

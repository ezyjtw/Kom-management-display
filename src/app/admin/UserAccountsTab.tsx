"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: string;
  employeeId: string | null;
  createdAt: string;
}

interface UserAccountsTabProps {
  users: UserAccount[];
  onUserCreated: (user: UserAccount) => void;
}

export default function UserAccountsTab({ users, onUserCreated }: UserAccountsTabProps) {
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", role: "employee", password: "" });

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
        onUserCreated(json.data);
        setNewUserForm({ name: "", email: "", role: "employee", password: "" });
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
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
                  <td className="px-3 py-2 text-muted-foreground">{u.employeeId || "\u2014"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "\u2014"}
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
  );
}

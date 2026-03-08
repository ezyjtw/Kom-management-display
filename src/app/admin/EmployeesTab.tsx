"use client";

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
}

export default function EmployeesTab({ employees }: EmployeesTabProps) {
  return (
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
  );
}

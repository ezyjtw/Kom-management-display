"use client";

import Link from "next/link";
import { ScoreBadge } from "@/components/shared/ScoreBadge";
import { TrendIndicator } from "@/components/shared/TrendIndicator";
import { FlagBadge } from "@/components/shared/FlagBadge";
import type { EmployeeOverview, Category } from "@/types";

const categoryLabels: Record<Category, string> = {
  daily_tasks: "Daily Tasks",
  projects: "Projects",
  asset_actions: "Asset Actions",
  quality: "Quality",
  knowledge: "Knowledge",
};

interface TeamOverviewTableProps {
  employees: EmployeeOverview[];
}

export function TeamOverviewTable({ employees }: TeamOverviewTableProps) {
  const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-700">Employee</th>
              <th className="text-left px-3 py-3 font-semibold text-slate-700">Role</th>
              <th className="text-center px-3 py-3 font-semibold text-slate-700">Overall</th>
              {categories.map((cat) => (
                <th key={cat} className="text-center px-3 py-3 font-semibold text-slate-700">
                  {categoryLabels[cat]}
                </th>
              ))}
              <th className="text-center px-3 py-3 font-semibold text-slate-700">Trend</th>
              <th className="text-left px-3 py-3 font-semibold text-slate-700">Flags</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/employee/${emp.id}`} className="font-medium text-blue-600 hover:underline">
                    {emp.name}
                  </Link>
                  <div className="text-xs text-slate-500">{emp.team}</div>
                </td>
                <td className="px-3 py-3 text-slate-600">{emp.role}</td>
                <td className="px-3 py-3 text-center">
                  <ScoreBadge score={emp.overallScore} size="md" />
                </td>
                {categories.map((cat) => (
                  <td key={cat} className="px-3 py-3 text-center">
                    <ScoreBadge score={emp.categoryScores[cat] ?? 3} size="sm" />
                  </td>
                ))}
                <td className="px-3 py-3 text-center">
                  <TrendIndicator
                    delta={emp.trends?.overall?.delta ?? 0}
                    direction={(emp.trends?.overall?.direction as "up" | "down" | "flat") ?? "flat"}
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {emp.flags.map((flag, i) => (
                      <FlagBadge key={i} flag={flag} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  No employee data available. Add employees and scores to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

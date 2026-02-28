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
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-3 font-semibold text-foreground">Employee</th>
              <th className="text-left px-3 py-3 font-semibold text-foreground">Role</th>
              <th className="text-center px-3 py-3 font-semibold text-foreground">Overall</th>
              {categories.map((cat) => (
                <th key={cat} className="text-center px-3 py-3 font-semibold text-foreground">
                  {categoryLabels[cat]}
                </th>
              ))}
              <th className="text-center px-3 py-3 font-semibold text-foreground">Trend</th>
              <th className="text-left px-3 py-3 font-semibold text-foreground">Flags</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/employee/${emp.id}`} className="font-medium text-primary hover:underline">
                    {emp.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{emp.team}</div>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{emp.role}</td>
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
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
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

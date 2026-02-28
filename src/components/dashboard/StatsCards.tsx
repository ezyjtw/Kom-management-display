"use client";

import { Users, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { EmployeeOverview } from "@/types";

interface StatsCardsProps {
  employees: EmployeeOverview[];
}

export function StatsCards({ employees }: StatsCardsProps) {
  const totalEmployees = employees.length;
  const avgScore =
    totalEmployees > 0
      ? employees.reduce((sum, e) => sum + e.overallScore, 0) / totalEmployees
      : 0;
  const flagCount = employees.reduce((sum, e) => sum + e.flags.length, 0);
  const highPerformers = employees.filter((e) => e.overallScore >= 6.5).length;

  const stats = [
    {
      label: "Team Size",
      value: totalEmployees,
      icon: Users,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Avg Score",
      value: avgScore.toFixed(1),
      icon: TrendingUp,
      color: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Active Flags",
      value: flagCount,
      icon: AlertTriangle,
      color: flagCount > 0 ? "text-amber-600 bg-amber-50" : "text-slate-500 bg-slate-50",
    },
    {
      label: "High Performers",
      value: highPerformers,
      icon: CheckCircle2,
      color: "text-emerald-600 bg-emerald-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">{stat.label}</p>
                <p className="text-2xl font-bold mt-1">{stat.value}</p>
              </div>
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <Icon size={22} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

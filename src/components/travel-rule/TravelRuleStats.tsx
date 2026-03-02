"use client";

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  UserX,
  Activity,
} from "lucide-react";

interface TravelRuleStatsProps {
  summary: {
    total: number;
    matched: number;
    unmatched: number;
    missingOriginator: number;
    missingBeneficiary: number;
  };
}

export function TravelRuleStats({ summary }: TravelRuleStatsProps) {
  const stats = [
    {
      label: "Total Transactions",
      value: summary.total,
      icon: Activity,
      color: "text-foreground",
      bg: "bg-muted/30",
    },
    {
      label: "Matched",
      value: summary.matched,
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "No Travel Rule",
      value: summary.unmatched,
      icon: XCircle,
      color: "text-red-400",
      bg: "bg-red-500/10",
    },
    {
      label: "Missing Originator",
      value: summary.missingOriginator,
      icon: UserX,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      label: "Missing Beneficiary",
      value: summary.missingBeneficiary,
      icon: AlertTriangle,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="bg-card rounded-xl border border-border p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${stat.bg}`}>
                <Icon size={16} className={stat.color} />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stat.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

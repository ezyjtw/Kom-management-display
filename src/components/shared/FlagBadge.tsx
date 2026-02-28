"use client";

import { AlertTriangle, AlertCircle } from "lucide-react";
import type { Flag } from "@/types";

const flagLabels: Record<string, string> = {
  mistakes_rising: "Mistakes Rising",
  throughput_drop: "Throughput Drop",
  docs_stalled: "Docs Stalled",
  sla_slipping: "SLA Slipping",
};

export function FlagBadge({ flag }: { flag: Flag }) {
  const Icon = flag.severity === "critical" ? AlertCircle : AlertTriangle;
  const colorClass =
    flag.severity === "critical"
      ? "bg-red-50 text-red-700 border-red-200"
      : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${colorClass}`}
    >
      <Icon size={12} />
      {flagLabels[flag.type] || flag.type}
    </span>
  );
}

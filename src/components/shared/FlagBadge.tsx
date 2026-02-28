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
      ? "bg-red-500/10 text-red-400 border-red-500/20"
      : "bg-amber-500/10 text-amber-400 border-amber-500/20";

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${colorClass}`}
    >
      <Icon size={12} />
      {flagLabels[flag.type] || flag.type}
    </span>
  );
}

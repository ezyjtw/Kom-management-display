// ─── Employee Types ───

import type { Category } from "./scoring";

export interface EmployeeOverview {
  id: string;
  name: string;
  role: string;
  team: string;
  region: string;
  overallScore: number;
  categoryScores: Record<Category, number>;
  trends: Record<Category | "overall", TrendData>;
  flags: Flag[];
}

export interface TrendData {
  current: number;
  previous: number;
  delta: number;
  direction: "up" | "down" | "flat";
}

export interface Flag {
  type: "mistakes_rising" | "throughput_drop" | "docs_stalled" | "sla_slipping";
  message: string;
  severity: "warning" | "critical";
}

// ─── Daily Ops Checks Types ───

export type DailyCheckStatus = "pending" | "pass" | "issues_found" | "skipped";
export type DailyCheckCategory =
  | "stuck_tx"
  | "balance_variance"
  | "staking_rewards"
  | "screening"
  | "travel_rule"
  | "pending_approvals"
  | "scam_dust"
  | "validator_health"
  | "external_provider";

export interface DailyCheckItemEntry {
  id: string;
  name: string;
  category: DailyCheckCategory;
  status: DailyCheckStatus;
  autoCheckKey: string;
  autoResult: string;
  notes: string;
  operatorId: string | null;
  completedAt: string | null;
}

export interface DailyCheckRunEntry {
  id: string;
  date: string;
  operatorId: string;
  operatorName: string;
  completedAt: string | null;
  jiraSummary: string;
  items: DailyCheckItemEntry[];
  progress: { total: number; completed: number; passed: number; issues: number };
}

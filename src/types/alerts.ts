// ─── Alert Types ───

export type AlertType =
  | "tto_breach"
  | "ttfa_breach"
  | "tsla_breach"
  | "ownership_change"
  | "ownership_bounce"
  | "mistakes_rising"
  | "throughput_drop"
  | "sla_slipping"
  | "travel_rule_missing_originator"
  | "travel_rule_missing_beneficiary"
  | "travel_rule_unmatched"
  | "travel_rule_sla_breach";

export interface AlertData {
  id: string;
  type: AlertType;
  priority: string;
  message: string;
  status: "active" | "acknowledged" | "resolved";
  threadId: string | null;
  employeeId: string | null;
  createdAt: string;
}

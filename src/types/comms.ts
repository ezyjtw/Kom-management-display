// ─── Comms Types ───

export type ThreadStatus =
  | "Unassigned"
  | "Assigned"
  | "InProgress"
  | "WaitingExternal"
  | "WaitingInternal"
  | "Done"
  | "Closed";

export type ThreadPriority = "P0" | "P1" | "P2" | "P3";

export type CommsSource = "email" | "slack" | "jira";

export interface ThreadSummary {
  id: string;
  source: CommsSource;
  subject: string;
  clientOrPartnerTag: string;
  status: ThreadStatus;
  priority: ThreadPriority;
  ownerName: string | null;
  ownerUserId: string | null;
  queue: string;
  lastMessageAt: string;
  lastActionAt: string | null;
  createdAt: string;
  slaStatus: SlaStatus;
}

export interface SlaStatus {
  ttoRemaining: number | null; // minutes remaining, negative = breached
  ttfaRemaining: number | null;
  tslaRemaining: number | null;
  isTtoBreached: boolean;
  isTtfaBreached: boolean;
  isTslaBreached: boolean;
}

export interface SlaThresholds {
  tto: Record<ThreadPriority, number>; // minutes
  ttfa: Record<ThreadPriority, number>;
  tsla: {
    InProgress: number;
    WaitingExternal: number;
    default: number;
  };
}

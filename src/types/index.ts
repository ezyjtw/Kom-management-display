// ─── Scoring Types ───

export type Category = "daily_tasks" | "projects" | "asset_actions" | "quality" | "knowledge";

export type ScoreRange = { min: 3; max: 8 };

export interface CategoryWeight {
  daily_tasks: number;
  projects: number;
  asset_actions: number;
  quality: number;
  knowledge: number;
}

export interface ScoringConfigData {
  version: string;
  weights: CategoryWeight;
  targets: Record<string, RoleTargets>;
  clampMin: number;
  clampMax: number;
  definitions: DataDefinitions;
}

export interface RoleTargets {
  daily_tasks: { ticketsPerWeek: number; onTimeRate: number; cycleTimeDays: number };
  projects: { pagesCreatedPerMonth: number; pagesUpdatedPerMonth: number };
  asset_actions: { actionsPerWeek: number; slaComplianceRate: number };
  quality: { maxMistakes: number; positiveActionsTarget: number };
}

export interface DataDefinitions {
  jira: {
    doneStatuses: string[];
    issueTypes: string[];
    creditRule: "assignee_at_completion" | "current_assignee";
    reopenedHandling: "quality_penalty" | "tracked_only";
  };
  confluence: {
    qualifyingSpaces: string[];
    qualifyingLabels: string[];
    createWeight: number;
    updateWeight: number;
  };
  assetActions: {
    countableTypes: string[];
    performedMeans: "completed" | "approved" | "initiated";
    multiApproverCredit: "all_approvers" | "final_approver";
  };
  quality: {
    severityWeights: { low: number; medium: number; high: number };
    positiveActionDefinition: string;
  };
  knowledge: {
    rubricDimensions: string[];
    cadence: "monthly" | "quarterly";
  };
}

// ─── Employee Types ───

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

// ─── Komainu API Types ───

export type KomainuTransactionStatus = "PENDING" | "BROADCASTED" | "CONFIRMED" | "FAILED";
export type KomainuTransactionDirection = "IN" | "OUT" | "FLAT";
export type KomainuRequestStatus = "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
export type KomainuRequestType = "CREATE_TRANSACTION" | "COLLATERAL_OPERATION_OFFCHAIN" | "COLLATERAL_OPERATION_ONCHAIN";

export interface KomainuPendingTransaction {
  id: string;
  wallet_id: string;
  direction: KomainuTransactionDirection;
  asset: string;
  amount: number;
  fees: number;
  created_at: string;
  transaction_type: string;
  status: KomainuTransactionStatus;
  tx_hash: string;
  sender_address: string;
  receiver_address: string;
  note: string;
  created_by: string;
  workspace: string;
  organization: string;
  account: string;
}

export interface KomainuPendingRequest {
  id: string;
  type: KomainuRequestType;
  status: KomainuRequestStatus;
  entity: string;
  entity_id?: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  updated_at: string;
  workspace: string;
  organization: string;
  account: string;
}

export interface KomainuPendingOverview {
  pendingTransactions: KomainuPendingTransaction[];
  pendingRequests: KomainuPendingRequest[];
  transactionCount: number;
  requestCount: number;
  configured: boolean;
}

// ─── Travel Rule / Notabene Types ───

export type NotabeneTransferStatus =
  | "NEW"
  | "SENT"
  | "ACK"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED"
  | "INCOMPLETE";

export interface NotabeneTransfer {
  id: string;
  status: NotabeneTransferStatus;
  transactionAsset: string;
  transactionAmount: string;
  transactionHash: string | null;
  originatorVASPdid: string;
  beneficiaryVASPdid: string;
  originator: NotabeneParty | null;
  beneficiary: NotabeneParty | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotabeneParty {
  originatorPersons?: NotabenePerson[];
  beneficiaryPersons?: NotabenePerson[];
  accountNumber?: string[];
}

export interface NotabenePerson {
  naturalPerson?: {
    name: Array<{ nameIdentifier: Array<{ primaryIdentifier: string; secondaryIdentifier?: string }> }>;
    geographicAddress?: Array<{ addressLine?: string[]; country?: string }>;
    dateAndPlaceOfBirth?: { dateOfBirth?: string; placeOfBirth?: string };
  };
  legalPerson?: {
    name: Array<{ nameIdentifier: Array<{ legalPersonName: string }> }>;
  };
}

export type TravelRuleMatchStatus =
  | "matched"           // Komainu tx matched to Notabene transfer
  | "unmatched"         // Komainu tx with no Notabene transfer
  | "missing_originator" // Transfer exists but originator info missing
  | "missing_beneficiary"; // Transfer exists but beneficiary info missing

export interface TravelRuleReconciliationRow {
  transactionId: string;
  txHash: string;
  direction: KomainuTransactionDirection;
  asset: string;
  amount: number;
  senderAddress: string;
  receiverAddress: string;
  createdAt: string;
  status: KomainuTransactionStatus;
  matchStatus: TravelRuleMatchStatus;
  notabeneTransferId: string | null;
  notabeneStatus: NotabeneTransferStatus | null;
  hasOriginator: boolean;
  hasBeneficiary: boolean;
  originatorName: string | null;
  beneficiaryName: string | null;
  alerts: string[]; // alert IDs generated for this row
}

export interface TravelRuleOverview {
  rows: TravelRuleReconciliationRow[];
  summary: {
    total: number;
    matched: number;
    unmatched: number;
    missingOriginator: number;
    missingBeneficiary: number;
  };
  configured: { komainu: boolean; notabene: boolean };
}

// ─── API Response Types ───

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

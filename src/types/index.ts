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

// ─── Schedule & On-Call Types ───

export type ShiftType = "primary" | "backup";
export type PtoType = "annual_leave" | "sick" | "wfh" | "other";
export type PtoStatus = "pending" | "approved" | "rejected";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "pending" | "in_progress" | "completed" | "skipped";
export type TaskCategory = "operational" | "compliance" | "client" | "administrative";

export interface OnCallEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  team: string;
  shiftType: ShiftType;
}

export interface PublicHolidayEntry {
  id: string;
  date: string;
  name: string;
  region: string;
}

export interface PtoEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  type: PtoType;
  status: PtoStatus;
  notes: string;
}

export interface DailyTaskEntry {
  id: string;
  date: string;
  team: string;
  assigneeId: string | null;
  assigneeName: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  category: TaskCategory;
  completedAt: string | null;
  createdById: string;
  createdByName: string;
}

export interface DailyTaskSummary {
  team: string;
  teamLead: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  tasks: DailyTaskEntry[];
}

// ─── Project Types ───

export type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";
export type ProjectPriority = "low" | "medium" | "high" | "critical";
export type UpdateType = "progress" | "blocker" | "milestone" | "note";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  team: string;
  leadId: string;
  leadName: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: string | null;
  targetDate: string | null;
  progress: number;
  tags: string[];
  memberCount: number;
  latestUpdate: string | null;
  latestUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  members: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    role: string;
  }>;
  updates: Array<{
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    type: UpdateType;
    progress: number | null;
    createdAt: string;
  }>;
}

// ─── OES Settlement Types ───

export type OesVenue = "okx" | "fireblocks";
export type SettlementMatchStatus = "pending" | "matched" | "mismatch" | "missing_tx" | "flagged";
export type SettlementStatus = "pending" | "confirmed" | "completed" | "escalated" | "failed";
export type DelegationStatus = "n/a" | "delegated" | "undelegated" | "pending_delegation";

export interface OesSettlementEntry {
  id: string;
  settlementRef: string;
  venue: OesVenue;
  clientName: string;
  clientAccount: string;
  asset: string;
  amount: number;
  direction: string; // custody_to_exchange | exchange_to_custody
  settlementCycle: string;
  exchangeInstructionId: string;
  onChainTxHash: string;
  collateralWallet: string;
  custodyWallet: string;
  matchStatus: SettlementMatchStatus;
  matchNote: string;
  delegationStatus: DelegationStatus;
  delegatedAmount: number;
  status: SettlementStatus;
  makerById: string | null;
  makerByName: string | null;
  makerAt: string | null;
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  escalationNote: string;
  fireblockssTxId: string;
  oesSignerGroup: string;
  createdAt: string;
}

export interface OesSettlementOverview {
  settlements: OesSettlementEntry[];
  summary: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    escalated: number;
    failed: number;
    matched: number;
    mismatched: number;
    missingTx: number;
    flagged: number;
    byVenue: { okx: number; fireblocks: number };
  };
}

// ─── USDC On/Off Ramp Types ───

export type RampDirection = "onramp" | "offramp";
export type OnrampStatus =
  | "instruction_received"
  | "usd_received"
  | "usd_receipt_confirmed"
  | "usd_sent_to_issuer"
  | "usdc_minted"
  | "usdc_delivered"
  | "completed"
  | "rejected";
export type OfframpStatus =
  | "instruction_received"
  | "instruction_accepted"
  | "usdc_received"
  | "usd_conversion_pending"
  | "usd_sent"
  | "completed"
  | "rejected";
export type RampPriority = "low" | "normal" | "high" | "urgent";

export interface UsdcRampTicket {
  id: string;
  ticketRef: string;
  clientName: string;
  clientAccount: string;
  direction: RampDirection;
  amount: number;
  fiatCurrency: string;
  fiatAmount: number | null;
  status: string; // OnrampStatus | OfframpStatus
  bankReference: string;
  instructionRef: string;
  ssiVerified: boolean;
  ssiDetails: string;
  custodyWalletId: string;
  holdingWalletId: string;
  onChainTxHash: string;
  gasWalletOk: boolean;
  issuerConfirmation: string;
  expressEnabled: boolean;
  feesFromBuffer: boolean;
  feeBufferLow: boolean;
  makerById: string | null;
  makerByName: string | null;
  makerAt: string | null;
  checkerById: string | null;
  checkerByName: string | null;
  checkerAt: string | null;
  kycAmlOk: boolean;
  walletWhitelisted: boolean;
  evidence: string; // JSON array
  notes: string;
  rejectionReason: string;
  requestedAt: string;
  completedAt: string | null;
  clientNotifiedAt: string | null;
  priority: RampPriority;
  createdAt: string;
}

export interface UsdcRampOverview {
  tickets: UsdcRampTicket[];
  summary: {
    total: number;
    active: number;
    awaitingCheckerApproval: number;
    completed: number;
    feeBufferLow: boolean;
    totalOnrampVolume: number;
    totalOfframpVolume: number;
  };
}

// ─── Staking Operations Types ───

export type StakingRewardModel = "auto" | "daily" | "weekly" | "monthly" | "manual_claim" | "rebate";
export type StakingStatus = "active" | "unstaking" | "inactive";
export type RewardHealthStatus = "on_time" | "approaching" | "overdue" | "no_data";

export interface StakingWalletEntry {
  id: string;
  walletAddress: string;
  asset: string;
  validator: string;
  stakedAmount: number;
  rewardModel: StakingRewardModel;
  clientName: string;
  isColdStaking: boolean;
  isTestWallet: boolean;
  stakeDate: string | null;
  expectedFirstRewardDate: string | null;
  actualFirstRewardDate: string | null;
  lastRewardAt: string | null;
  expectedNextRewardAt: string | null;
  onChainBalance: number | null;
  platformBalance: number | null;
  varianceThreshold: number;
  tags: string[];
  notes: string;
  status: StakingStatus;
  rewardHealth: RewardHealthStatus;
  varianceFlag: boolean;
  createdAt: string;
}

export interface StakingOverview {
  wallets: StakingWalletEntry[];
  summary: {
    total: number;
    active: number;
    overdue: number;
    approaching: number;
    coldStaking: number;
    reconciliationFlags: number;
  };
}

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

// ─── Approvals Queue Types ───

export type ApprovalRiskLevel = "low" | "medium" | "high";
export type ApprovalLane = "auto_approve" | "ops_approval" | "compliance_review";

export interface ApprovalQueueItem {
  id: string;
  type: string;
  status: string;
  entity: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  workspace: string;
  organization: string;
  account: string;
  ageMinutes: number;
  riskLevel: ApprovalRiskLevel;
  lane: ApprovalLane;
}

export interface ApprovalQueueOverview {
  items: ApprovalQueueItem[];
  summary: {
    total: number;
    autoApprove: number;
    opsApproval: number;
    complianceReview: number;
  };
  configured: boolean;
}

// ─── Screening & Scam/Dust Types ───

export type ScreeningStatus = "submitted" | "processing" | "completed" | "not_submitted" | "exception";
export type ScreeningClassification = "unclassified" | "legitimate" | "dust" | "scam";
export type AnalyticsAlertStatus = "none" | "open" | "under_review" | "resolved";
export type ComplianceReviewStatus = "none" | "pending" | "approved" | "rejected";

export interface ScreeningEntryData {
  id: string;
  transactionId: string;
  txHash: string;
  asset: string;
  amount: number;
  direction: string;
  screeningStatus: ScreeningStatus;
  classification: ScreeningClassification;
  isKnownException: boolean;
  exceptionReason: string;
  analyticsAlertId: string;
  analyticsStatus: AnalyticsAlertStatus;
  complianceReviewStatus: ComplianceReviewStatus;
  reclassifiedAt: string | null;
  notes: string;
  createdAt: string;
}

export interface ScreeningOverview {
  entries: ScreeningEntryData[];
  summary: {
    total: number;
    submitted: number;
    processing: number;
    notSubmitted: number;
    dust: number;
    scam: number;
    openAlerts: number;
  };
}

// ─── RCA Tracker Types ───

export type RcaStatus = "none" | "raised" | "awaiting_rca" | "rca_received" | "follow_up_pending" | "closed";

export interface RcaFollowUpItem {
  title: string;
  status: "pending" | "done";
  assigneeId?: string;
}

export interface RcaIncidentEntry {
  id: string;
  title: string;
  provider: string;
  severity: string;
  status: string;
  rcaStatus: RcaStatus;
  rcaDocumentRef: string;
  rcaResponsibleId: string | null;
  rcaResponsibleName: string | null;
  rcaSlaDeadline: string | null;
  rcaReceivedAt: string | null;
  rcaRaisedAt: string | null;
  rcaFollowUpItems: RcaFollowUpItem[];
  ageDays: number;
  slaOverdue: boolean;
  startedAt: string;
  createdAt: string;
}

export interface RcaOverview {
  incidents: RcaIncidentEntry[];
  summary: {
    total: number;
    awaiting: number;
    overdue: number;
    followUp: number;
    closed: number;
  };
}

// ─── Token Review Types ───

export type TokenReviewStatus = "proposed" | "under_review" | "compliance_review" | "approved" | "rejected" | "live";
export type TokenRiskLevel = "low" | "medium" | "high" | "critical";
export type MarketCapTier = "mega" | "large" | "mid" | "small" | "micro" | "unknown";
export type TokenType = "native" | "erc20" | "spl" | "substrate" | "other";
export type DemandSignalType = "client_request" | "market_trend" | "competitor_listed" | "internal_proposal";
export type VendorSupportStatus = "supported" | "partial" | "not_supported" | "unknown";

export interface TokenDemandSignalEntry {
  id: string;
  signalType: DemandSignalType;
  source: string;
  description: string;
  weight: number;
  recordedById: string | null;
  createdAt: string;
}

export interface TokenReviewEntry {
  id: string;
  symbol: string;
  name: string;
  network: string;
  contractAddress: string;
  tokenType: TokenType;
  status: TokenReviewStatus;
  proposedById: string | null;
  proposedByName: string | null;
  proposedAt: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  complianceById: string | null;
  complianceAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  liveAt: string | null;
  rejectionReason: string;
  riskLevel: TokenRiskLevel;
  riskNotes: string;
  regulatoryNotes: string;
  sanctionsCheck: boolean;
  amlRiskAssessed: boolean;
  custodianSupport: string[];
  stakingAvailable: boolean;
  // Third-party vendor support
  chainalysisSupport: VendorSupportStatus;
  notabeneSupport: VendorSupportStatus;
  fireblocksSupport: VendorSupportStatus;
  ledgerSupport: VendorSupportStatus;
  vendorNotes: Record<string, string>;
  // AI research persistence
  aiResearchResult: Record<string, unknown> | null;
  aiResearchedAt: string | null;
  aiRecommendation: string;
  // Other
  demandScore: number;
  demandSignals: TokenDemandSignalEntry[];
  marketCapTier: MarketCapTier;
  notes: string;
  createdAt: string;
}

export interface TokenSuggestion {
  symbol: string;
  name: string;
  network: string;
  tokenType: string;
  marketCapTier: string;
  rationale: string;
  urgency: "high" | "medium" | "low";
  suggestedRiskLevel: string;
  chains: string[];
}

export interface TokenReviewOverview {
  tokens: TokenReviewEntry[];
  summary: {
    total: number;
    proposed: number;
    underReview: number;
    complianceReview: number;
    approved: number;
    rejected: number;
    live: number;
    highRisk: number;
  };
}

// ─── Client Contact Preferences ───

export type PreferredChannel = "email" | "slack" | "phone" | "portal";

export interface ClientContactPreferenceEntry {
  id: string;
  clientName: string;
  displayName: string;
  preferredChannel: PreferredChannel;
  primaryEmail: string;
  secondaryEmail: string;
  slackChannel: string;
  phoneNumber: string;
  timezone: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: string;
  language: string;
  vaspDid: string;
  travelRuleContact: string;
  escalationEmail: string;
  escalationPhone: string;
  notes: string;
  tags: string[];
  active: boolean;
  lastContactedAt: string | null;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface ClientContactSummary {
  total: number;
  active: number;
  byChannel: Record<PreferredChannel, number>;
  withTravelRuleContact: number;
  withEscalation: number;
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

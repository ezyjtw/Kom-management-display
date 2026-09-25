import { z } from "zod";
import { emptyAsUndefined, tokenAmount, usdAmount } from "@/lib/decimal";

// ─── Reusable Schemas ───

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const roleSchema = z.enum(["admin", "lead", "employee"]);
export const teamSchema = z.enum(["Transaction Operations", "Admin Operations", "Data Operations"]);

// ─── Score Schemas ───

export const createScoreSchema = z.object({
  employeeId: z.string().min(1),
  periodId: z.string().min(1),
  category: z.enum(["daily_tasks", "projects", "asset_actions", "quality", "knowledge"]),
  rawIndex: z.number().min(0).max(1),
  evidence: z.array(z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─── Employee Schemas ───

export const createEmployeeSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(255),
  role: z.string().min(1).max(50),
  team: z.string().min(1).max(100),
  region: z.string().max(100).default("Global"),
});

export const updateEmployeeSchema = createEmployeeSchema.partial().extend({
  active: z.boolean().optional(),
});

// ─── User Schemas ───

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(200),
  role: roleSchema,
  password: z.string().min(8).max(128),
  employeeId: z.string().optional(),
});

// ─── Thread Schemas ───

export const createThreadSchema = z.object({
  source: z.enum(["email", "slack", "jira", "manual"]),
  sourceThreadRef: z.string().max(500).default(""),
  subject: z.string().min(1).max(500),
  priority: prioritySchema.default("P2"),
  queue: z.string().max(100).default("Transaction Operations"),
  participants: z.array(z.string()).optional(),
  clientOrPartnerTag: z.string().max(200).optional(),
});

export const updateThreadSchema = z.object({
  priority: prioritySchema.optional(),
  queue: z.string().max(100).optional(),
  status: z.string().max(50).optional(),
  ownerUserId: z.string().optional(),
  secondaryOwnerIds: z.array(z.string()).optional(),
  clientOrPartnerTag: z.string().max(200).optional(),
});

/** PATCH /api/comms/threads/:id. Value rules (allowed queues, closing note) stay in the route. */
export const patchThreadSchema = z.object({
  status: z.string().max(50).optional(),
  ownerUserId: z.string().max(100).nullable().optional(),
  priority: z.string().max(10).optional(),
  queue: z.string().max(100).optional(),
  linkedRecords: z.array(z.unknown()).max(200).optional(),
  handoverNote: z.string().max(5000).optional(),
  reason: z.string().max(2000).optional(),
  lastActionAt: z.string().max(40).optional(),
});

// ─── Incident Schemas ───

export const createIncidentSchema = z.object({
  title: z.string().min(1).max(500),
  provider: z.string().min(1).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  description: z.string().max(5000).default(""),
  impact: z.string().max(5000).default(""),
  linkedThreadIds: z.array(z.string()).max(50).optional(),
  linkedTransactionIds: z.array(z.string()).max(50).optional(),
});

export const updateIncidentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "monitoring", "resolved"]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  impact: z.string().max(5000).optional(),
  update: z.string().max(5000).optional(),
  updateType: z.string().max(50).optional(),
  linkedThreadIds: z.array(z.string()).max(50).optional(),
  linkedTransactionIds: z.array(z.string()).max(50).optional(),
  linkAlertIds: z.array(z.string()).max(50).optional(),
  rcaStatus: z.enum(["not_required", "raised", "awaiting_rca", "rca_received", "follow_up_pending", "closed"]).optional(),
  rcaDocumentRef: z.string().max(500).optional(),
  rcaResponsibleId: z.string().max(200).optional(),
  rcaSlaDeadline: z.string().datetime().optional(),
  rcaFollowUpItems: z.array(z.object({
    title: z.string().min(1).max(500),
    status: z.string().max(50),
    assigneeId: z.string().max(200).optional(),
  })).max(50).optional(),
  externalTicketRef: z.string().max(500).optional(),
  externalTicketUrl: z.string().max(500).optional(),
  externalTicketStatus: z.string().max(100).optional(),
  externalTicketDisputed: z.boolean().optional(),
  externalTicketDisputeReason: z.string().max(2000).optional(),
});

// ─── Screening Schemas ───

export const createScreeningSchema = z.object({
  transactionId: z.string().min(1).max(500),
  txHash: z.string().max(500).default(""),
  asset: z.string().min(1).max(50),
  amount: tokenAmount({ min: "nonNegative" }).default("0"),
  direction: z.enum(["IN", "OUT"]).default("IN"),
  screeningStatus: z.enum(["not_submitted", "submitted", "processing", "completed", "exception"]).default("not_submitted"),
  classification: z.string().max(50).optional(),
  isKnownException: z.boolean().optional(),
  exceptionReason: z.string().max(2000).optional(),
  analyticsAlertId: z.string().max(500).optional(),
  analyticsStatus: z.string().max(50).optional(),
  complianceReviewStatus: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateScreeningSchema = z.object({
  id: z.string().min(1),
  classification: z.string().max(50).optional(),
  screeningStatus: z.enum(["not_submitted", "submitted", "processing", "completed", "exception"]).optional(),
  analyticsStatus: z.string().max(50).optional(),
  complianceReviewStatus: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
  isKnownException: z.boolean().optional(),
  exceptionReason: z.string().max(2000).optional(),
});

// ─── Travel Rule Schemas ───

export const createTravelRuleCaseSchema = z.object({
  transactionId: z.string().min(1).max(500),
  txHash: z.string().max(500).default(""),
  direction: z.enum(["IN", "OUT"]),
  asset: z.string().min(1).max(50),
  amount: tokenAmount({ min: "nonNegative" }),
  matchStatus: z.enum(["unmatched", "missing_originator", "missing_beneficiary"]),
  senderAddress: z.string().max(500).default(""),
  receiverAddress: z.string().max(500).default(""),
});

// ─── Branding Schema ───

export const updateBrandingSchema = z.object({
  appName: z.string().min(1).max(100).optional(),
  subtitle: z.string().max(200).optional(),
  logoData: z.string().max(700_000).optional(), // ~512KB base64
});

// ─── Settlement Schema ───

export const createSettlementSchema = z.object({
  settlementRef: z.string().min(1).max(200),
  venue: z.enum(["exchange", "fireblocks"]).default("exchange"),
  clientName: z.string().min(1).max(200),
  clientAccount: z.string().max(200).default(""),
  asset: z.string().min(1).max(50),
  amount: tokenAmount({ min: "nonNegative" }),
  direction: z.enum(["custody_to_exchange", "exchange_to_custody"]),
  settlementCycle: z.string().max(100).default(""),
  exchangeInstructionId: z.string().max(500).default(""),
  collateralWallet: z.string().max(500).default(""),
  custodyWallet: z.string().max(500).default(""),
});

export const updateSettlementSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["match_tx", "maker_confirm", "checker_approve", "flag_mismatch", "escalate", "update_delegation", "complete"]).optional(),
  onChainTxHash: z.string().max(500).optional(),
  matchStatus: z.string().max(50).optional(),
  matchNote: z.string().max(2000).optional(),
  escalationNote: z.string().max(2000).optional(),
  delegationStatus: z.string().max(100).optional(),
  delegatedAmount: tokenAmount({ min: "nonNegative" }).optional(),
  skipChecker: z.boolean().optional(),
  status: z.string().max(50).optional(),
  fireblockssTxId: z.string().max(500).optional(),
  oesSignerGroup: z.string().max(200).optional(),
});

// ─── Alert Schemas ───

export const updateAlertSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "acknowledged", "resolved"]).optional(),
  destination: z.enum(["slack", "email", "in_app"]).optional(),
});

// ─── Scoring Config Schemas ───

export const createScoringConfigSchema = z.object({
  version: z.string().min(1).max(50),
  config: z.record(z.string(), z.unknown()),
  notes: z.string().max(2000).default(""),
});

export const transitionScoringConfigSchema = z.object({
  id: z.string().min(1),
  targetStatus: z.enum(["draft", "review", "approved", "active", "archived"]),
  notes: z.string().max(2000).default(""),
});

// ─── USDC Ramp Schemas ───

export const createUsdcRampSchema = z.object({
  clientName: z.string().min(1).max(200),
  clientAccount: z.string().max(200).default(""),
  direction: z.enum(["onramp", "offramp"]),
  amount: tokenAmount({ min: "nonNegative" }),
  fiatCurrency: z.string().max(10).default("USD"),
  fiatAmount: emptyAsUndefined(usdAmount({ min: "nonNegative" }).optional()),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  bankReference: z.string().max(500).optional(),
  instructionRef: z.string().max(500).optional(),
  custodyWalletId: z.string().max(500).optional(),
  ssiDetails: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateUsdcRampSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["advance_status", "maker_confirm", "checker_approve", "add_evidence", "update_checks", "flag_buffer", "notify_client", "reject"]).optional(),
  status: z.string().max(50).optional(),
  makerNote: z.string().max(2000).optional(),
  checkerNote: z.string().max(2000).optional(),
  kycAmlOk: z.boolean().optional(),
  ssiVerified: z.boolean().optional(),
  walletWhitelisted: z.boolean().optional(),
  gasWalletOk: z.boolean().optional(),
  expressEnabled: z.boolean().optional(),
  evidenceRef: z.string().max(500).optional(),
  rejectionReason: z.string().max(2000).optional(),
  onChainTxHash: z.string().max(500).optional(),
  issuerConfirmation: z.string().max(500).optional(),
  holdingWalletId: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  bankReference: z.string().max(500).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

// ─── Project Schemas ───

export const createProjectSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().max(5000).default(""),
  team: z.string().min(1).max(100),
  leadId: z.string().min(1),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  startDate: z.string().datetime().optional(),
  targetDate: z.string().datetime().optional(),
});

// ─── Daily Check Schemas ───

export const updateDailyCheckItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "pass", "issues_found", "skipped"]),
  notes: z.string().max(2000).default(""),
});

export const updateDailyCheckPatchSchema = z.union([
  z.object({
    itemId: z.string().min(1),
    status: z.enum(["pending", "pass", "issues_found", "skipped"]).optional(),
    notes: z.string().max(2000).optional(),
    /** Required for `pass` (spec §10.2); validated by the daily-check rules. */
    evidence: z.unknown().optional(),
    /** Required for `skipped`, which only requests the skip. */
    skippedReason: z.string().max(1000).optional(),
  }),
  z.object({
    runId: z.string().min(1),
    jiraSummary: z.string().max(5000).optional(),
  }),
]);

// ─── Transaction Confirmation Schemas ───

export const createTransactionConfirmationSchema = z.object({
  transactionId: z.string().min(1).max(500),
  requestId: z.string().max(500).optional(),
  asset: z.string().min(1).max(50),
  amount: tokenAmount({ min: "nonNegative" }),
  direction: z.string().min(1).max(20),
  account: z.string().max(500).default(""),
  workspace: z.string().max(500).default(""),
});

export const transactionConfirmationPostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    transactionId: z.string().min(1).max(500),
    requestId: z.string().max(500).optional(),
    asset: z.string().min(1).max(50),
    amount: tokenAmount({ min: "nonNegative" }),
    direction: z.string().min(1).max(20),
    account: z.string().max(500).default(""),
    workspace: z.string().max(500).default(""),
    riskLevel: z.enum(["low", "medium", "high", "critical", "unknown"]).optional(),
  }),
  z.object({
    action: z.literal("take_ownership"),
    confirmationId: z.string().min(1),
  }),
  z.object({
    action: z.literal("add_note"),
    confirmationId: z.string().min(1),
    note: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("link_ticket"),
    confirmationId: z.string().min(1),
    ticketRef: z.string().trim().min(1).max(200),
  }),
]);

// ─── Feature Flag Schemas ───

export const upsertFeatureFlagSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_.]+$/, "Key must be lowercase alphanumeric with underscores or dots"),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  enabled: z.boolean().default(false),
  roles: z.array(z.string().max(50)).default([]),
  teams: z.array(z.string().max(100)).default([]),
  percentage: z.number().int().min(0).max(100).default(100),
});

// ─── Session Schemas ───

export const revokeSessionSchema = z.object({
  action: z.enum(["revoke", "revoke_all"]),
  sessionToken: z.string().min(1).max(500).optional(),
});

// ─── Background Job Schemas ───

const jobTypeSchema = z.enum([
  "sync_jira", "check_staking", "check_confirmations", "cleanup_sessions",
  "sync_slack", "sync_slack_replies", "slack_event",
  "classify_thread", "draft_client_comms", "poll_status_pages", "score_vendor_reliability",
  "custody_poll_requests", "custody_poll_transactions", "custody_poll_collateral",
  "custody_poll_audit_logs", "custody_poll_eod_balances", "custody_poll_staking", "custody_poll_stakes",
  "sync_mail", "graph_teams_sync",
  "report_unticketed", "reconcile_tickets", "incident_log_overdue", "evaluate_alerts", "alert_digest", "poll_risk_signals",
  "generate_daily_checks", "collect_check_evidence", "mtd_autoclose", "poll_client_ticket_comments", "morning_handover", "platform_sprint_intake",
]);

export const enqueueJobSchema = z.object({
  type: jobTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const jobsPostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register_defaults") }),
  z.object({
    action: z.literal("enqueue"),
    type: jobTypeSchema,
    payload: z.record(z.string(), z.unknown()).default({}),
    runAt: z.string().datetime().optional(),
  }),
  z.object({ action: z.literal("trigger"), type: jobTypeSchema }),
  z.object({ action: z.literal("process_next") }),
]);

// ─── Search Schema ───

export const searchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Report Schema ───

export const reportQuerySchema = z.object({
  type: z.enum(["daily_digest", "weekly_report", "incident_report", "compliance_summary"]),
  format: z.enum(["html", "json"]).default("json"),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ─── Query Parameter Schemas ───

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// ─── Activity Schemas ───

export const createActivitySchema = z.object({
  employeeId: z.string().min(1),
  activity: z.enum(["project", "bau", "queue_monitoring", "lunch", "break", "meeting", "admin", "training"]),
  detail: z.string().max(500).default(""),
});

export const endActivitySchema = z.object({
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
}).refine((d) => d.id || d.employeeId, { message: "id or employeeId required" });

// ─── Comms Alert Schema ───

export const updateCommsAlertSchema = z.object({
  alertId: z.string().min(1),
  action: z.enum(["acknowledge", "resolve"]),
});

// ─── Thread Note Schema ───

export const createThreadNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

// ─── Thread Status Schema ───

export const updateThreadStatusSchema = z.object({
  status: z.string().min(1).max(50),
  reason: z.string().max(2000).optional(),
});

// ─── Thread Take Schema ───

export const takeThreadSchema = z.object({
  note: z.string().max(2000).optional(),
});

// ─── Thread Transfer Schema ───

export const transferThreadSchema = z.object({
  toUserId: z.string().min(1),
  reason: z.string().max(2000).optional(),
  handoverNote: z.string().max(2000).optional(),
});

// ─── Thread Secondaries Schema ───

export const updateSecondariesSchema = z.object({
  action: z.enum(["add", "remove"]),
  userId: z.string().min(1),
});

// ─── Token Review Schemas ───

export const createTokenSchema = z.object({
  action: z.literal("create"),
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  network: z.string().max(100).default(""),
  contractAddress: z.string().max(500).default(""),
  tokenType: z.string().max(50).default("native"),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  marketCapTier: z.string().max(50).default("unknown"),
  notes: z.string().max(5000).default(""),
  custodianSupport: z.array(z.string()).optional(),
  stakingAvailable: z.boolean().default(false),
  fireblocksSupport: z.boolean().optional(),
  ledgerSupport: z.boolean().optional(),
  notabeneSupport: z.boolean().optional(),
  jiraTicket: z.string().max(500).optional(),
  complianceDoc: z.string().max(500).optional(),
  launchDate: z.string().max(100).optional(),
  founders: z.string().max(1000).optional(),
  website: z.string().max(500).optional(),
  supportedNetworks: z.array(z.string()).optional(),
  whitepaper: z.string().max(500).optional(),
  explorer: z.string().max(500).optional(),
  blockchainAnalytics: z.string().max(100).optional(),
  travelRuleNotabene: z.boolean().optional(),
  priceFeedCoingecko: z.boolean().optional(),
  consensusMechanism: z.string().max(200).optional(),
  privacyToken: z.boolean().optional(),
  smartContractReview: z.boolean().optional(),
  smartContractReviewNotes: z.string().max(5000).optional(),
  jurisdictionStatus: z.record(z.string(), z.unknown()).optional(),
});

export const updateTokenStatusSchema = z.object({
  action: z.literal("update_status"),
  tokenId: z.string().min(1),
  newStatus: z.enum(["proposed", "under_review", "compliance_review", "approved", "rejected", "live"]),
  reason: z.string().max(2000).optional(),
});

export const addTokenSignalSchema = z.object({
  action: z.literal("add_signal"),
  tokenId: z.string().min(1),
  signalType: z.string().min(1).max(100),
  source: z.string().max(500).default(""),
  description: z.string().max(2000).default(""),
  weight: z.number().min(0).max(100).default(1),
});

export const updateTokenSchema = z.object({
  action: z.literal("update"),
  tokenId: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  riskNotes: z.string().max(5000).optional(),
  regulatoryNotes: z.string().max(5000).optional(),
  sanctionsCheck: z.boolean().optional(),
  amlRiskAssessed: z.boolean().optional(),
  stakingAvailable: z.boolean().optional(),
  marketCapTier: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
  network: z.string().max(100).optional(),
  contractAddress: z.string().max(500).optional(),
  chainalysisSupport: z.boolean().optional(),
  notabeneSupport: z.boolean().optional(),
  fireblocksSupport: z.boolean().optional(),
  ledgerSupport: z.boolean().optional(),
  custodianSupport: z.array(z.string()).optional(),
  vendorNotes: z.record(z.string(), z.string()).optional(),
  supportedNetworks: z.array(z.string()).optional(),
  jurisdictionStatus: z.record(z.string(), z.unknown()).optional(),
  jiraTicket: z.string().max(500).optional(),
  complianceDoc: z.string().max(500).optional(),
  launchDate: z.string().max(100).optional(),
  founders: z.string().max(1000).optional(),
  website: z.string().max(500).optional(),
  whitepaper: z.string().max(500).optional(),
  explorer: z.string().max(500).optional(),
  blockchainAnalytics: z.string().max(100).optional(),
  travelRuleNotabene: z.boolean().optional(),
  priceFeedCoingecko: z.boolean().optional(),
  consensusMechanism: z.string().max(200).optional(),
  privacyToken: z.boolean().optional(),
  smartContractReview: z.boolean().optional(),
  smartContractReviewNotes: z.string().max(5000).optional(),
});

export const saveTokenResearchSchema = z.object({
  action: z.literal("save_research"),
  tokenId: z.string().min(1),
  researchResult: z.record(z.string(), z.unknown()),
  recommendation: z.string().max(500).optional(),
});

export const tokenActionSchema = z.discriminatedUnion("action", [
  createTokenSchema,
  updateTokenStatusSchema,
  addTokenSignalSchema,
  updateTokenSchema,
  saveTokenResearchSchema,
]);

// ─── Travel Rule Case Schemas ───

export const updateTravelRuleCaseSchema = z.object({
  status: z.string().max(50).optional(),
  counterpartyVasp: z.string().max(500).optional(),
  emailSentTo: z.string().max(500).optional(),
  emailSentAt: z.string().datetime().optional(),
  notes: z.string().max(5000).optional(),
  assignedTo: z.string().max(200).optional(),
  ownerUserId: z.string().max(200).optional().nullable(),
  action: z.enum(["send_email"]).optional(),
  recipientEmail: z.string().email().max(255).optional(),
  recipientName: z.string().max(200).optional(),
  resolutionType: z.string().max(100).optional(),
  resolutionNote: z.string().max(5000).optional(),
  updatedAt: z.string().datetime().optional(),
});

export const createTravelRuleCaseNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

// ─── Staking Schemas ───

export const createStakingWalletSchema = z.object({
  action: z.literal("create").optional(),
  asset: z.string().min(1).max(50),
  network: z.string().min(1).max(100),
  walletAddress: z.string().min(1).max(500),
  rewardModel: z.string().min(1).max(100),
  validatorName: z.string().max(200).default(""),
  stakedAmount: tokenAmount({ min: "nonNegative" }).default("0"),
  expectedRewardFrequencyHours: z.number().min(0).default(24),
  minimumThreshold: z.number().min(0).default(0),
  isColdStaking: z.boolean().default(false),
  isTestWallet: z.boolean().default(false),
  clientName: z.string().max(200).optional(),
  stakeDate: z.string().datetime().optional().nullable(),
  expectedFirstRewardDate: z.string().datetime().optional().nullable(),
  expectedNextRewardAt: z.string().datetime().optional().nullable(),
  onChainBalance: tokenAmount({ min: "nonNegative" }).optional().nullable(),
  platformBalance: tokenAmount({ min: "nonNegative" }).optional().nullable(),
  varianceThreshold: tokenAmount({ min: "nonNegative" }).default("0.01"),
  tags: z.array(z.string().max(100)).max(50).default([]),
  notes: z.string().max(5000).default(""),
});

export const updateStakingWalletSchema = z.object({
  action: z.literal("update"),
  walletId: z.string().min(1),
  stakedAmount: tokenAmount({ min: "nonNegative" }).optional(),
  onChainBalance: tokenAmount({ min: "nonNegative" }).optional(),
  platformBalance: tokenAmount({ min: "nonNegative" }).optional(),
  validatorName: z.string().max(200).optional(),
  rewardStatus: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateStakingPatchSchema = z.object({
  id: z.string().min(1),
  validator: z.string().max(200).optional(),
  stakedAmount: tokenAmount({ min: "nonNegative" }).optional(),
  clientName: z.string().max(200).optional(),
  isColdStaking: z.boolean().optional(),
  isTestWallet: z.boolean().optional(),
  lastRewardAt: z.string().max(100).nullable().optional(),
  expectedNextRewardAt: z.string().max(100).nullable().optional(),
  actualFirstRewardDate: z.string().max(100).nullable().optional(),
  onChainBalance: tokenAmount({ min: "nonNegative" }).nullable().optional(),
  platformBalance: tokenAmount({ min: "nonNegative" }).nullable().optional(),
  varianceThreshold: tokenAmount({ min: "nonNegative" }).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  notes: z.string().max(5000).optional(),
  status: z.string().max(50).optional(),
});

// ─── AI Assist Schema ───

export const aiAssistSchema = z.object({
  action: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()).optional(),
});

// ─── Compliance Bot Schema ───

export const complianceBotSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(10000),
  })).min(1).max(50),
});

// ─── Schedule Schemas ───

export const createOnCallSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  notes: z.string().max(2000).default(""),
});

export const createPtoSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  type: z.string().max(50).default("annual_leave"),
  notes: z.string().max(2000).default(""),
});

export const createRotaSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  shift: z.string().min(1).max(50),
  notes: z.string().max(2000).default(""),
});

export const createHolidaySchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().min(1),
  region: z.string().max(100).default("Global"),
});

// ─── Project Update Schema ───

export const createProjectUpdateSchema = z.object({
  message: z.string().min(1).max(5000),
  status: z.string().max(50).optional(),
});

// ─── Project Member Schema ───

export const projectMemberSchema = z.object({
  action: z.enum(["add", "remove"]),
  employeeId: z.string().min(1),
  role: z.string().max(50).default("member"),
});

// ─── Email Sync Schema ───

export const emailSyncSchema = z.object({
  queue: z.string().max(100).optional(),
});

// ─── VASP Directory Schema ───

export const createVaspSchema = z.object({
  name: z.string().min(1).max(200),
  did: z.string().max(500).default(""),
  country: z.string().max(100).default(""),
  website: z.string().max(500).default(""),
  contactEmail: z.string().max(255).default(""),
  notes: z.string().max(2000).default(""),
});

// ─── RCA Ticket Schema ───

export const createRcaTicketSchema = z.object({
  incidentId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).default(""),
  assignedTo: z.string().max(200).default(""),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

// ─── Helper ───

/**
 * Validate request body against a Zod schema.
 * Returns parsed data on success, or { error, status } on failure.
 */
/** Generic caps on any request body before schema validation (spec §17.4). */
export const INPUT_LIMITS = { maxDepth: 10, maxArrayLength: 1000, maxStringLength: 100_000, maxKeys: 500 } as const;

export function inputShapeIssue(value: unknown, depth = 0): string | null {
  if (depth > INPUT_LIMITS.maxDepth) return `Input nested deeper than ${INPUT_LIMITS.maxDepth} levels`;
  if (typeof value === "string") return value.length > INPUT_LIMITS.maxStringLength ? `A text value is longer than ${INPUT_LIMITS.maxStringLength} characters` : null;
  if (Array.isArray(value)) {
    if (value.length > INPUT_LIMITS.maxArrayLength) return `A list has more than ${INPUT_LIMITS.maxArrayLength} items`;
    for (const v of value) {
      const issue = inputShapeIssue(v, depth + 1);
      if (issue) return issue;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > INPUT_LIMITS.maxKeys) return `An object has more than ${INPUT_LIMITS.maxKeys} fields`;
    for (const [, v] of entries) {
      const issue = inputShapeIssue(v, depth + 1);
      if (issue) return issue;
    }
  }
  return null;
}

/**
 * Validate a request body. Unknown fields are stripped by Zod and never reach
 * the database (no mass assignment); depth, list, text and field-count caps
 * apply to every body.
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string; status: 400 } {
  const shape = inputShapeIssue(data);
  if (shape) return { success: false, error: shape, status: 400 };
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const message = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: message, status: 400 };
}

/**
 * Validate URL search params against a Zod schema.
 */
export function validateQuery<T>(
  schema: z.ZodSchema<T>,
  searchParams: URLSearchParams,
): { success: true; data: T } | { success: false; error: string; status: 400 } {
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return validateBody(schema, params);
}

// ─── Core data model admin (spec §7) ───

const slackChannelRef = z.string().regex(/^[CG][A-Z0-9]{8,12}$/, "Slack channel ID, e.g. C01234ABCDE");
const emailDomainRef = z.string().toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, "Email domain, e.g. example.com (no @)");
const teamsChannelRef = z.string().min(3).max(300);

export const clientChannelSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slack"), ref: slackChannelRef }),
  // Individual Slack users who belong to the client (spec §9.2 rule 2)
  z.object({ kind: z.literal("slack_user"), ref: z.string().regex(/^[UW][A-Z0-9]{6,15}$/, "Slack user ID, e.g. U01234ABCDE") }),
  z.object({ kind: z.literal("email_domain"), ref: emailDomainRef }),
  z.object({ kind: z.literal("teams"), ref: teamsChannelRef }),
]);

const clientFields = {
  displayName: z.string().trim().min(1).max(200),
  custodyOrgId: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  custodyAccountNos: z.array(z.string().trim().min(1).max(100)).max(200).default([]),
  jsmOrganizationId: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  jurisdiction: z.enum(["", "UK", "JE", "AE", "EU"]).default(""),
  isActive: z.boolean().default(true),
  channels: z.array(clientChannelSchema).max(100).default([]),
  /** Spec §12 CHK-05: client-attested inbound threshold and its last review. */
  inboundThresholdUsd: usdAmount({ min: "positive" }).nullable().optional(),
  thresholdReviewedAt: z.string().datetime({ offset: true }).nullable().optional().transform((v) => (v ? new Date(v) : v)),
};

export const createClientSchema = z.object(clientFields);
export const updateClientSchema = z.object(clientFields).partial();

const optionalMins = z.number().int().min(1).max(60 * 24 * 90).nullable();

export const updateSlaPolicySchema = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  ownershipMins: optionalMins.optional(),
  firstRespMins: optionalMins.optional(),
  resolveMins: optionalMins.optional(),
  resolveRule: z.enum(["next_business_day_eod"]).nullable().optional(),
  calendar: z.string().regex(/^(24x7|business_[a-z]+)$/).optional(),
  warnAtPct: z.number().int().min(1).max(99).optional(),
  breachEscalationRole: z.enum(["lead", "admin"]).optional(),
  isActive: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, "No changes");

export const updateAlertRuleSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  route: z.object({
    businessHours: z.array(z.string().min(1).max(200)).max(20),
    outOfHours: z.array(z.string().min(1).max(200)).max(20),
    /** Jira/JSM project that alerts of this rule are ticketed in (spec §10.1). */
    ticketProject: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
  }).optional(),
}).refine((v) => Object.keys(v).length > 0, "No changes");

// ─── Client intake (spec §9) ───

export const NOT_A_QUESTION_REASONS = ["acknowledgement", "social", "duplicate", "other"] as const;

export const notAQuestionSchema = z
  .object({
    reason: z.enum(NOT_A_QUESTION_REASONS),
    text: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.reason !== "other" || (v.text && v.text.length >= 3), { message: "Reason 'other' needs a short explanation", path: ["text"] });

export const changePrioritySchema = z.object({
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  reason: z.string().trim().max(500).optional(),
});

// ─── Tickets by default (spec §10) ───

/** Shape only; the root-cause list, risk-score scale and buckets are checked by closure-rules (422). */
export const closeWorkItemSchema = z.object({
  resolutionNote: z.string().max(5000).default(""),
  rootCause: z.string().max(60).default(""),
  riskScore: z.string().max(40).default(""),
  timeLogBucketMins: z.number().int().optional(),
  target: z.enum(["resolved", "closed"]).optional(),
  transitionName: z.string().max(100).optional(),
  clientResolutionMessage: z.string().max(2000).optional(),
  uat: z.object({
    outcome: z.enum(["pass", "fail", "not_applicable", "blocked"]),
    evidence: z.string().trim().max(2000),
    defectKey: z.string().trim().max(30).optional(),
  }).optional(),
});

export const dailyCheckExceptionsSchema = z.object({
  exceptions: z.array(z.object({
    summary: z.string().trim().min(5).max(200),
    breakType: z.string().trim().max(60).optional(),
    detail: z.string().trim().max(4000).optional(),
    reference: z.string().trim().max(200).optional(),
    clientId: z.string().max(100).optional(),
  })).min(1).max(50),
});

/** Local routing config for a Jira/JSM project; never changes Jira itself. */
export const updateJiraProjectSchema = z.object({
  enabled: z.boolean().optional(),
  syncInbound: z.boolean().optional(),
  /** Name of a discovered issue type used when KOMmand Centre creates tickets. */
  defaultIssueType: z.string().min(1).max(100).optional(),
  serviceDeskId: z.string().regex(/^\d*$/).max(20).optional(),
}).refine((v) => Object.keys(v).length > 0, "No changes");

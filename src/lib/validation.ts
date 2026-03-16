import { z } from "zod";

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

// ─── Incident Schemas ───

export const createIncidentSchema = z.object({
  title: z.string().min(1).max(500),
  provider: z.string().min(1).max(200),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  description: z.string().max(5000).default(""),
  impact: z.string().max(5000).default(""),
});

// ─── Screening Schemas ───

export const createScreeningSchema = z.object({
  transactionId: z.string().min(1).max(500),
  txHash: z.string().max(500).default(""),
  asset: z.string().min(1).max(50),
  amount: z.number().min(0).default(0),
  direction: z.enum(["IN", "OUT"]).default("IN"),
  screeningStatus: z.enum(["not_submitted", "submitted", "processing", "completed", "exception"]).default("not_submitted"),
});

// ─── Travel Rule Schemas ───

export const createTravelRuleCaseSchema = z.object({
  transactionId: z.string().min(1).max(500),
  txHash: z.string().max(500).default(""),
  direction: z.enum(["IN", "OUT"]),
  asset: z.string().min(1).max(50),
  amount: z.number().min(0),
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
  venue: z.enum(["okx", "fireblocks"]).default("okx"),
  clientName: z.string().min(1).max(200),
  clientAccount: z.string().max(200).default(""),
  asset: z.string().min(1).max(50),
  amount: z.number().min(0),
  direction: z.enum(["custody_to_exchange", "exchange_to_custody"]),
  settlementCycle: z.string().max(100).default(""),
  exchangeInstructionId: z.string().max(500).default(""),
  collateralWallet: z.string().max(500).default(""),
  custodyWallet: z.string().max(500).default(""),
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
  amount: z.number().min(0),
  fiatCurrency: z.string().max(10).default("USD"),
  fiatAmount: z.number().min(0).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
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

// ─── Transaction Confirmation Schemas ───

export const createTransactionConfirmationSchema = z.object({
  transactionId: z.string().min(1).max(500),
  requestId: z.string().max(500).optional(),
  asset: z.string().min(1).max(50),
  amount: z.number().min(0),
  direction: z.string().min(1).max(20),
  account: z.string().max(500).default(""),
  workspace: z.string().max(500).default(""),
});

export const confirmationActionSchema = z.object({
  action: z.enum(["acknowledge", "sign_off", "escalate"]),
  confirmationId: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

// ─── Feature Flag Schemas ───

export const upsertFeatureFlagSchema = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, "Key must be lowercase alphanumeric with underscores"),
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

export const enqueueJobSchema = z.object({
  type: z.enum([
    "sync_slack", "sync_email", "sync_jira", "check_sla",
    "check_staking", "poll_custody", "check_confirmations", "cleanup_sessions",
    "classify_thread", "draft_client_comms", "poll_status_pages", "score_vendor_reliability",
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

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
});

export const createTravelRuleCaseNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

export const approveCustodySchema = z.object({
  requestId: z.string().min(1).max(500).optional(),
  action: z.enum(["check_status"]).optional(),
});

// ─── Staking Schemas ───

export const createStakingWalletSchema = z.object({
  action: z.literal("create"),
  asset: z.string().min(1).max(50),
  network: z.string().min(1).max(100),
  walletAddress: z.string().max(500).default(""),
  validatorName: z.string().max(200).default(""),
  stakedAmount: z.number().min(0).default(0),
  rewardModel: z.string().max(100).default(""),
  expectedRewardFrequencyHours: z.number().min(0).default(24),
  minimumThreshold: z.number().min(0).default(0),
  isColdStaking: z.boolean().default(false),
  isTestWallet: z.boolean().default(false),
});

export const updateStakingWalletSchema = z.object({
  action: z.literal("update"),
  walletId: z.string().min(1),
  stakedAmount: z.number().min(0).optional(),
  onChainBalance: z.number().min(0).optional(),
  platformBalance: z.number().min(0).optional(),
  validatorName: z.string().max(200).optional(),
  rewardStatus: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
});

// ─── Approval Schemas ───

export const approvalActionSchema = z.object({
  action: z.enum(["approve", "reject", "reassign"]),
  requestId: z.string().min(1),
  reason: z.string().max(2000).optional(),
  assignTo: z.string().max(200).optional(),
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
  })).min(1),
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
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string; status: 400 } {
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

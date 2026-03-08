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
    "check_staking", "poll_komainu", "check_confirmations", "cleanup_sessions",
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

/**
 * Every recurring check and task in spec §12, one definition each. Synced
 * into DailyCheckDefinition (insert-only: admin edits are never overwritten).
 *
 * - dueByLocal is Europe/London. TODO(CONFIRM-DUE-TIMES): 09:05 (the morning
 *   call in Task Distribution) is used where no due time is documented.
 * - confluenceUrl starts as a CONFIRM placeholder naming the exact procedure-space
 *   title to search for; an admin replaces it with the page URL. No
 *   procedure text is copied into code.
 * - TODO(CONFIRM-CHECK-GAPS): confirm the numbering gaps in the team checklist.
 * - knownIssues is deployment data (the firm's own findings register). The
 *   product ships none; an admin records them against each definition.
 */

export type Team = "Team 1" | "Team 2" | "Team 3" | "All";
export type Frequency = "daily" | "weekly" | "per_cycle" | "event" | "continuous";

export interface KnownIssue {
  id: string; // the deploying firm's findings register id
  text: string;
}

export interface CheckDefinitionSpec {
  code: string;
  name: string;
  team: Team;
  kind: "check" | "task";
  frequency: Frequency;
  /** "HH:MM" London; "per_window" / "event" / "continuous" for non-daily tasks. */
  dueByLocal: string;
  /** Weekly checks: ISO weekday (1 = Monday). */
  weekday?: number;
  evidenceSpec: { requiredFields: string[]; freshnessMinutes?: number; notes?: string };
  ticketProject: string;
  confluenceTitle: string;
  /** Has an automated data pull (src/modules/daily-checks/collectors.ts). */
  collector?: boolean;
  requiredFlag?: string;
  restricted?: boolean;
  knownIssues?: KnownIssue[];
}

const MORNING = "09:05";

export const DEFINITIONS: readonly CheckDefinitionSpec[] = [
  // ── Team 1 ──
  {
    code: "CHK-01", name: "Stuck Transactions", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["stuckCount"], freshnessMinutes: 120, notes: "recordCount = transactions scanned" },
    ticketProject: "OPS", confluenceTitle: "Stuck Transactions", collector: true,
    knownIssues: [],
  },
  {
    code: "CHK-09K", name: "RLS, asset realisation and return of assets", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = open RLS items reviewed" },
    ticketProject: "RLS", confluenceTitle: "RLS Asset Realisation and Return of Assets", collector: true, restricted: true,
    knownIssues: [],
  },
  {
    code: "CHK-10", name: "OES collateral settlement monitoring", team: "Team 1", kind: "check", frequency: "per_cycle", dueByLocal: "per_window",
    evidenceSpec: { requiredFields: ["portfoliosExpected", "settlementsSeen", "completed", "failed", "inProgress"], freshnessMinutes: 60 },
    ticketProject: "OPS", confluenceTitle: "FB OES Collateral Settlement Monitoring", collector: true,
    knownIssues: [],
  },
  {
    code: "CHK-11", name: "Production Issues", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = open production issues reviewed" },
    ticketProject: "PDEF", confluenceTitle: "Production Issues", collector: true,
  },
  {
    code: "CHK-12", name: "Outstanding RCA Requests", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["overdueCount"], notes: "recordCount = open RCAs" },
    ticketProject: "VND", confluenceTitle: "Outstanding RCA Requests", collector: true,
  },
  {
    code: "CHK-17", name: "Cold Staking Ops (T-1) Flagged Correctly", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["flaggedCorrectlyCount"], notes: "recordCount = T-1 cold staking operations" },
    ticketProject: "OPS", confluenceTitle: "Cold Staking Ops (T-1) Flagged Correctly",
  },
  {
    code: "CHK-08", name: "Weekly Validator Checks", team: "Team 1", kind: "check", frequency: "weekly", weekday: 1, dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], freshnessMinutes: 7 * 24 * 60, notes: "recordCount = validators checked (manual)" },
    ticketProject: "OPS", confluenceTitle: "Weekly Validator Checks",
    knownIssues: [],
  },
  {
    code: "TASK-BANK", name: "Bank repo (MVP0): instruction register and settlement log", team: "Team 1", kind: "task", frequency: "event", dueByLocal: "event",
    evidenceSpec: { requiredFields: [] }, ticketProject: "BANK", confluenceTitle: "BANK MVP0 Settlement Process", requiredFlag: "module.bank",
    knownIssues: [{ id: "BANK-MVP0", text: "Process page is draft, not operational; the outbound maker role is unresolved." }],
  },
  {
    code: "TASK-BANK-REPORT", name: "Daily report to BANK sent", team: "Team 1", kind: "task", frequency: "daily", dueByLocal: "17:00",
    evidenceSpec: { requiredFields: ["reportSentAt"] }, ticketProject: "BANK", confluenceTitle: "BANK MVP0 Settlement Process", requiredFlag: "module.bank",
  },

  // ── Team 2 ──
  {
    code: "CHK-02", name: "Daily MTD Variances (client assets)", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["reportDataDate"], notes: "recordCount = variance rows reviewed" },
    ticketProject: "OTC", confluenceTitle: "Daily MTD Variances",
    knownIssues: [],
  },
  {
    code: "CHK-03", name: "Outstanding Requests in Platform", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["byType", "byAgeBand"], freshnessMinutes: 60, notes: "Read-only (H1)" },
    ticketProject: "OPS", confluenceTitle: "Outstanding Requests in Platform", collector: true,
  },
  {
    code: "TASK-OTC", name: "OTC Ticket Check", team: "Team 2", kind: "task", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["unassignedCount", "overdueCount"], notes: "recordCount = open OTC tickets reviewed" },
    ticketProject: "OTC", confluenceTitle: "OTC Ticket Check", collector: true,
  },
  {
    code: "CHK-06", name: "Scam and Dust", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["scamCount", "dustCount", "legitimateCount"], notes: "recordCount = new candidates reviewed" },
    ticketProject: "OPS", confluenceTitle: "Scam and Dust", collector: true,
    knownIssues: [],
  },
  {
    code: "CHK-07", name: "NFTs Pending Approval (review only)", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = NFTs pending (manual, CONFIRM-NFT-SOURCE)" },
    ticketProject: "OPS", confluenceTitle: "NFTs Pending Approval",
  },
  {
    code: "CHK-13", name: "Outstanding Coin Reviews", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["overdueCount"], notes: "recordCount = open reviews" },
    ticketProject: "TOKENS", confluenceTitle: "Outstanding Coin Reviews", collector: true,
  },

  // ── Team 3 ──
  {
    code: "CHK-02-DEV", name: "Weekly MTD Variances (dev assets)", team: "Team 3", kind: "check", frequency: "weekly", weekday: 1, dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["reportDataDate"], freshnessMinutes: 7 * 24 * 60, notes: "recordCount = variance rows reviewed" },
    ticketProject: "OTC", confluenceTitle: "Daily MTD Variances",
  },
  {
    code: "CHK-09", name: "Travel Rule Check", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["matchedCount", "unmatchedCount"], notes: "recordCount = transactions in scope" },
    ticketProject: "OPS", confluenceTitle: "Travel Rule Check", collector: true,
    knownIssues: [],
  },
  {
    code: "CHK-05", name: "Inbound Transaction Reporting", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "Positive evidence mandatory: record count and data date of the extract; blank is not a pass" },
    ticketProject: "OPS", confluenceTitle: "Inbound Transaction Reporting",
    knownIssues: [],
  },
  {
    code: "CHK-04", name: "Transaction Screening (Chainalysis)", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["alertsCount", "unscreenableCount", "stakingExcludedCount"], notes: "recordCount = transactions screened" },
    ticketProject: "OPS", confluenceTitle: "Transaction Screening", collector: true,
    knownIssues: [],
  },
  {
    code: "CHK-16", name: "Staking Rec and Partner Confirmations", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["variancesCount", "positionViolations", "confirmationsReceived", "confirmationsExpected"], notes: "recordCount = wallets reconciled" },
    ticketProject: "OPS", confluenceTitle: "Staking Rec and Partner Confirmations", collector: true,
    knownIssues: [],
  },
  {
    code: "CHK-21", name: "Staking Rewards Paid as Expected", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["rewardsSeen", "overdueCount"], notes: "recordCount = wallets expected" },
    ticketProject: "OPS", confluenceTitle: "Staking Rewards Paid as Expected", collector: true,
  },
  {
    code: "CHK-22", name: "Newly Staked Accounts", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = new stakes since the previous day" },
    ticketProject: "OPS", confluenceTitle: "Newly Staked Accounts", collector: true,
  },
  {
    code: "CHK-15", name: "Tatum Check", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["exceptionCount"], notes: "Report received and data date (CONFIRM-TATUM)" },
    ticketProject: "OPS", confluenceTitle: "Tatum Check",
  },
  {
    code: "TASK-CLIENT-REPORT", name: "Client daily balance report and third-party custody intents", team: "Team 3", kind: "task", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["reportSentAt", "recipientListRef"], notes: "No attachment storage. Third-party custody intents: review status only; approvals stay on that platform (H1)." },
    ticketProject: "OPS", confluenceTitle: "Third-party custody operations procedure",
  },

  // ── All teams ──
  { code: "TASK-CLIENTQ", name: "Client questions", team: "All", kind: "task", frequency: "continuous", dueByLocal: "continuous", evidenceSpec: { requiredFields: [] }, ticketProject: "JSM", confluenceTitle: "Transaction Operations Task Distribution" },
  { code: "TASK-VENDOR", name: "Vendor tickets", team: "All", kind: "task", frequency: "continuous", dueByLocal: "continuous", evidenceSpec: { requiredFields: [] }, ticketProject: "VND", confluenceTitle: "Transaction Operations Task Distribution" },
  { code: "TASK-BILL", name: "Billing and fee approvals (visibility only)", team: "All", kind: "task", frequency: "event", dueByLocal: "event", evidenceSpec: { requiredFields: [] }, ticketProject: "FIN", confluenceTitle: "Billing Reports – Client Trading Position and Fees Approvals" },
  { code: "TASK-RISKVIEW", name: "Risk-flagged transactions awaiting a human (read-only)", team: "All", kind: "task", frequency: "continuous", dueByLocal: "continuous", evidenceSpec: { requiredFields: [] }, ticketProject: "OPS", confluenceTitle: "Transaction Operations Task Distribution" },
  { code: "TASK-MORNING", name: "Morning call and handover", team: "All", kind: "task", frequency: "daily", dueByLocal: MORNING, evidenceSpec: { requiredFields: [] }, ticketProject: "OPS", confluenceTitle: "Transaction Operations Task Distribution" },
];

export const DEFINITION_BY_CODE: Record<string, CheckDefinitionSpec> = Object.fromEntries(DEFINITIONS.map((d) => [d.code, d]));

export const CONFLUENCE_PLACEHOLDER_PREFIX = "CONFIRM-CONFLUENCE-URL:";

export function confluencePlaceholder(title: string): string {
  return `${CONFLUENCE_PLACEHOLDER_PREFIX} search the TOP space for "${title}"`;
}

/**
 * Every recurring check and task in spec §12, one definition each. Synced
 * into DailyCheckDefinition (insert-only: admin edits are never overwritten).
 *
 * - dueByLocal is Europe/London. TODO(CONFIRM-DUE-TIMES): 09:05 (the morning
 *   call in Task Distribution) is used where no due time is documented.
 * - confluenceUrl starts as a CONFIRM placeholder naming the exact TOP-space
 *   title to search for; an admin replaces it with the page URL. No
 *   procedure text is copied into code.
 * - TODO(CONFIRM-CHECK-GAPS): TOP has checks 1-13, 15-17, 21 and 22; numbers
 *   14 and 18-20 were not found.
 */

export type Team = "Team 1" | "Team 2" | "Team 3" | "All";
export type Frequency = "daily" | "weekly" | "per_cycle" | "event" | "continuous";

export interface KnownIssue {
  id: string; // findings register id, e.g. "CF-16"
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
    ticketProject: "TOPS", confluenceTitle: "Stuck Transactions", collector: true,
    knownIssues: [
      { id: "CF-16", text: "No documented escalation clock; set in AssetThreshold / rule params." },
      { id: "CF-26", text: "No degraded or sunset asset list; maintain Admin → Asset Status." },
    ],
  },
  {
    code: "CHK-09K", name: "KPS, K4 realisation and K3 return of assets", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = open KPR items reviewed" },
    ticketProject: "KPR", confluenceTitle: "KPS K4 Realisation and K3 Return of Assets", collector: true, restricted: true,
    knownIssues: [{ id: "CF-03", text: "KPS VTHO transactions are excluded from screening without recorded rationale." }],
  },
  {
    code: "CHK-10", name: "OES and OKX collateral settlement monitoring", team: "Team 1", kind: "check", frequency: "per_cycle", dueByLocal: "per_window",
    evidenceSpec: { requiredFields: ["portfoliosExpected", "settlementsSeen", "completed", "failed", "inProgress"], freshnessMinutes: 60 },
    ticketProject: "TOPS", confluenceTitle: "FB OES Collateral Settlement Monitoring", collector: true,
    knownIssues: [
      { id: "CF-37", text: "No minimum settlement threshold for skipped instructions; that check stays disabled." },
      { id: "CF-41", text: "Skipped-instruction threshold not defined." },
      { id: "CF-38", text: "No position if OKX misses its 2-hour remediation; escalation ends at the Head of Transaction Operations." },
      { id: "CF-39", text: "Client template uses the same wording for all exposure sizes." },
    ],
  },
  {
    code: "CHK-11", name: "Production Issues", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = open production issues reviewed" },
    ticketProject: "GXS", confluenceTitle: "Production Issues", collector: true,
  },
  {
    code: "CHK-12", name: "Outstanding RCA Requests", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["overdueCount"], notes: "recordCount = open RCAs" },
    ticketProject: "VSR", confluenceTitle: "Outstanding RCA Requests", collector: true,
  },
  {
    code: "CHK-17", name: "Cold Staking Ops (T-1) Flagged Correctly", team: "Team 1", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["flaggedCorrectlyCount"], notes: "recordCount = T-1 cold staking operations" },
    ticketProject: "TOPS", confluenceTitle: "Cold Staking Ops (T-1) Flagged Correctly",
  },
  {
    code: "CHK-08", name: "Weekly Validator Checks", team: "Team 1", kind: "check", frequency: "weekly", weekday: 1, dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], freshnessMinutes: 7 * 24 * 60, notes: "recordCount = validators checked (manual)" },
    ticketProject: "TOPS", confluenceTitle: "Weekly Validator Checks",
    knownIssues: [
      { id: "CF-10", text: "No approved validator set is documented." },
      { id: "CF-24", text: "Control 5.1 cannot be evidenced until Admin → Approved Validators is populated." },
    ],
  },
  {
    code: "TASK-FAB", name: "FAB ICS repo (MVP0): instruction register and settlement log", team: "Team 1", kind: "task", frequency: "event", dueByLocal: "event",
    evidenceSpec: { requiredFields: [] }, ticketProject: "FAB", confluenceTitle: "FAB MVP0 Settlement Process", requiredFlag: "module.fab",
    knownIssues: [{ id: "FAB-MVP0", text: "Process page is draft, not operational; the outbound maker role is unresolved." }],
  },
  {
    code: "TASK-FAB-REPORT", name: "Daily report to FAB sent", team: "Team 1", kind: "task", frequency: "daily", dueByLocal: "17:00",
    evidenceSpec: { requiredFields: ["reportSentAt"] }, ticketProject: "FAB", confluenceTitle: "FAB MVP0 Settlement Process", requiredFlag: "module.fab",
  },

  // ── Team 2 ──
  {
    code: "CHK-02", name: "Daily MTD Variances (client assets)", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["reportDataDate"], notes: "recordCount = variance rows reviewed" },
    ticketProject: "OTC", confluenceTitle: "Daily MTD Variances",
    knownIssues: [{ id: "CF-18", text: "GX transaction status can be wrong versus the chain: GX status vs chain unverified." }],
  },
  {
    code: "CHK-03", name: "Outstanding Requests in GX", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["byType", "byAgeBand"], freshnessMinutes: 60, notes: "Read-only (H1)" },
    ticketProject: "TOPS", confluenceTitle: "Outstanding Requests in GX", collector: true,
  },
  {
    code: "TASK-OTC", name: "OTC Ticket Check", team: "Team 2", kind: "task", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["unassignedCount", "overdueCount"], notes: "recordCount = open OTC tickets reviewed" },
    ticketProject: "OTC", confluenceTitle: "OTC Ticket Check", collector: true,
  },
  {
    code: "CHK-06", name: "Scam and Dust", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["scamCount", "dustCount", "legitimateCount"], notes: "recordCount = new candidates reviewed" },
    ticketProject: "TOPS", confluenceTitle: "Scam and Dust", collector: true,
    knownIssues: [
      { id: "CF-34", text: "GX auto-blacklists dust senders with no documented reversal path." },
      { id: "CF-35", text: "Client overrides of Komainu's scam assessment need the client decision attached." },
    ],
  },
  {
    code: "CHK-07", name: "NFTs Pending Approval (review only)", team: "Team 2", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = NFTs pending (manual, CONFIRM-NFT-SOURCE)" },
    ticketProject: "TOPS", confluenceTitle: "NFTs Pending Approval",
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
    ticketProject: "TOPS", confluenceTitle: "Travel Rule Check", collector: true,
    knownIssues: [
      { id: "CF-05", text: "\"Failed – Unresponsive VASP\" terminal state has no risk acceptance." },
      { id: "CF-06", text: "OKX collateral settlements are a recurring unresponsive counterparty." },
      { id: "CF-07", text: "Local reporting thresholds are undocumented." },
      { id: "CF-22", text: "The macro fails silently on a filename mismatch; imports reject mismatched names or dates." },
    ],
  },
  {
    code: "CHK-05", name: "Inbound Transaction Reporting", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "Positive evidence mandatory: record count and data date of the extract; blank is not a pass (CF-32)" },
    ticketProject: "TOPS", confluenceTitle: "Inbound Transaction Reporting",
    knownIssues: [
      { id: "CF-30", text: "Control 4.2 and this check describe different mechanisms." },
      { id: "CF-31", text: "Client thresholds have no review cadence." },
      { id: "CF-32", text: "A blank result is not a pass." },
    ],
  },
  {
    code: "CHK-04", name: "Transaction Screening (Chainalysis)", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["alertsCount", "unscreenableCount", "stakingExcludedCount"], notes: "recordCount = transactions screened" },
    ticketProject: "TOPS", confluenceTitle: "Transaction Screening",
    knownIssues: [
      { id: "CF-04", text: "Zero-value or no-hash transactions cannot be screened: counted separately." },
      { id: "CF-01", text: "Staking is excluded from screening: exclusion count shown." },
    ],
  },
  {
    code: "CHK-16", name: "Staking Rec and Partner Confirmations", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["variancesCount", "positionViolations", "confirmationsReceived", "confirmationsExpected"], notes: "recordCount = wallets reconciled" },
    ticketProject: "TOPS", confluenceTitle: "Staking Rec and Partner Confirmations", collector: true,
    knownIssues: [
      { id: "CF-09", text: "The control reconciles activity, not position: position check staked ≤ total added." },
      { id: "CF-17", text: "ADA staked balance exceeds total on three wallets." },
      { id: "CF-19", text: "Duplicate matched balance records." },
    ],
  },
  {
    code: "CHK-21", name: "Staking Rewards Paid as Expected", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["rewardsSeen", "overdueCount"], notes: "recordCount = wallets expected" },
    ticketProject: "TOPS", confluenceTitle: "Staking Rewards Paid as Expected", collector: true,
  },
  {
    code: "CHK-22", name: "Newly Staked Accounts", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: [], notes: "recordCount = new stakes since the previous day" },
    ticketProject: "TOPS", confluenceTitle: "Newly Staked Accounts", collector: true,
  },
  {
    code: "CHK-15", name: "Tatum Check", team: "Team 3", kind: "check", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["exceptionCount"], notes: "Report received and data date (CONFIRM-TATUM)" },
    ticketProject: "TOPS", confluenceTitle: "Tatum Check",
  },
  {
    code: "TASK-AVIVA", name: "Aviva daily balance report and Ripple Custody intents", team: "Team 3", kind: "task", frequency: "daily", dueByLocal: MORNING,
    evidenceSpec: { requiredFields: ["reportSentAt", "recipientListRef"], notes: "No attachment storage. Ripple intents: review status only; approvals stay in Ripple (H1)." },
    ticketProject: "TOPS", confluenceTitle: "Ripple Custody Transaction Operations SOP",
  },

  // ── All teams ──
  { code: "TASK-CLIENTQ", name: "Client questions", team: "All", kind: "task", frequency: "continuous", dueByLocal: "continuous", evidenceSpec: { requiredFields: [] }, ticketProject: "JSM", confluenceTitle: "Transaction Operations Task Distribution" },
  { code: "TASK-VENDOR", name: "Vendor tickets", team: "All", kind: "task", frequency: "continuous", dueByLocal: "continuous", evidenceSpec: { requiredFields: [] }, ticketProject: "VSR", confluenceTitle: "Transaction Operations Task Distribution" },
  { code: "TASK-BILL", name: "Billing and fee approvals (visibility only)", team: "All", kind: "task", frequency: "event", dueByLocal: "event", evidenceSpec: { requiredFields: [] }, ticketProject: "FOA", confluenceTitle: "Billing Reports – Client Trading Position and Fees Approvals" },
  { code: "TASK-RISKVIEW", name: "Risk-flagged transactions awaiting a human (read-only)", team: "All", kind: "task", frequency: "continuous", dueByLocal: "continuous", evidenceSpec: { requiredFields: [] }, ticketProject: "TOPS", confluenceTitle: "Transaction Operations Task Distribution" },
  { code: "TASK-MORNING", name: "Morning call and handover", team: "All", kind: "task", frequency: "daily", dueByLocal: MORNING, evidenceSpec: { requiredFields: [] }, ticketProject: "TOPS", confluenceTitle: "Transaction Operations Task Distribution" },
];

export const DEFINITION_BY_CODE: Record<string, CheckDefinitionSpec> = Object.fromEntries(DEFINITIONS.map((d) => [d.code, d]));

export const CONFLUENCE_PLACEHOLDER_PREFIX = "CONFIRM-CONFLUENCE-URL:";

export function confluencePlaceholder(title: string): string {
  return `${CONFLUENCE_PLACEHOLDER_PREFIX} search the TOP space for "${title}"`;
}

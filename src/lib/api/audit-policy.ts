/**
 * Audit policy for state-changing API routes (spec §17.7, review remediation).
 *
 * Every mutation route has a category. Fail-closed categories must write their
 * audit trail through auditedAction (or auditedResponse / workAction /
 * handoverAction, which use it): no audit record, no action. Normal and
 * low-value routes may use the fail-open createAuditEntry.
 *
 * AUDIT_GAPS lists fail-closed routes not yet converted, each with a reason.
 * The test `control-mutations-fail-closed` fails when a new mutation route is
 * unclassified, when a fail-closed route does not use a fail-closed helper
 * and is not a listed gap, and when a listed gap has been fixed (so the list
 * only shrinks).
 */

export type AuditCategory =
  | "CONTROL_CRITICAL"
  | "SECURITY_CRITICAL"
  | "FINANCIAL"
  | "CONFIGURATION"
  | "ADMINISTRATION"
  | "NORMAL_OPERATIONAL"
  | "LOW_VALUE";

export const FAIL_CLOSED: ReadonlySet<AuditCategory> = new Set([
  "CONTROL_CRITICAL",
  "SECURITY_CRITICAL",
  "FINANCIAL",
  "CONFIGURATION",
  "ADMINISTRATION",
]);

/** Longest prefix wins. Paths are /api/... without the trailing route.ts. */
export const ROUTE_AUDIT_CATEGORY: ReadonlyArray<{ prefix: string; category: AuditCategory; note?: string }> = [
  // Security
  { prefix: "/api/sessions", category: "SECURITY_CRITICAL" },
  { prefix: "/api/users", category: "SECURITY_CRITICAL" },
  { prefix: "/api/feature-flags", category: "SECURITY_CRITICAL" },
  // Configuration and administration
  { prefix: "/api/admin", category: "CONFIGURATION" },
  { prefix: "/api/admin/seed", category: "LOW_VALUE", note: "Refused outside development (ALLOW_SEED); seeds fixtures only." },
  { prefix: "/api/scoring-config", category: "CONFIGURATION" },
  { prefix: "/api/scores", category: "CONFIGURATION", note: "Staff scoring stays off (H4); audited in case it is ever enabled." },
  { prefix: "/api/integrations", category: "CONFIGURATION" },
  { prefix: "/api/integrations/email", category: "NORMAL_OPERATIONAL", note: "Queues a mailbox poll; nothing is configured." },
  { prefix: "/api/branding", category: "CONFIGURATION" },
  { prefix: "/api/client-preferences", category: "CONFIGURATION" },
  { prefix: "/api/employees", category: "ADMINISTRATION" },
  { prefix: "/api/jobs", category: "ADMINISTRATION" },
  { prefix: "/api/schedule", category: "CONTROL_CRITICAL", note: "Rota, on-call, PTO and holidays drive alert routing, cover and SLA clocks." },
  { prefix: "/api/schedule/daily-tasks", category: "NORMAL_OPERATIONAL" },
  // Controls and client-visible content
  { prefix: "/api/work-items", category: "CONTROL_CRITICAL" },
  { prefix: "/api/alerts", category: "CONTROL_CRITICAL" },
  { prefix: "/api/alerts/generate", category: "NORMAL_OPERATIONAL", note: "Cron trigger for evaluation; alerts raised are themselves recorded." },
  { prefix: "/api/comms/alerts", category: "CONTROL_CRITICAL" },
  { prefix: "/api/daily-checks", category: "CONTROL_CRITICAL" },
  { prefix: "/api/morning", category: "CONTROL_CRITICAL" },
  { prefix: "/api/client-incidents", category: "CONTROL_CRITICAL" },
  { prefix: "/api/client-comms", category: "CONTROL_CRITICAL" },
  { prefix: "/api/iai-drafts", category: "CONTROL_CRITICAL" },
  { prefix: "/api/gx-sprints", category: "CONTROL_CRITICAL" },
  { prefix: "/api/incidents", category: "CONTROL_CRITICAL" },
  { prefix: "/api/rca", category: "CONTROL_CRITICAL" },
  // Financial records
  { prefix: "/api/fab", category: "FINANCIAL" },
  { prefix: "/api/travel-rule", category: "FINANCIAL" },
  { prefix: "/api/travel-rule/cases/[id]/preview-email", category: "LOW_VALUE", note: "Renders a preview; writes nothing." },
  { prefix: "/api/screening", category: "FINANCIAL" },
  { prefix: "/api/staking", category: "FINANCIAL" },
  { prefix: "/api/usdc-ramp", category: "FINANCIAL" },
  { prefix: "/api/transaction-confirmations", category: "FINANCIAL" },
  { prefix: "/api/settlements", category: "FINANCIAL" },
  { prefix: "/api/tokens", category: "FINANCIAL" },
  // Normal operational work (fail-open audit is acceptable)
  { prefix: "/api/comms/threads", category: "NORMAL_OPERATIONAL", note: "Inbox triage (take, transfer, status, notes, classify)." },
  { prefix: "/api/projects", category: "NORMAL_OPERATIONAL" },
  { prefix: "/api/notifications", category: "LOW_VALUE" },
  { prefix: "/api/events", category: "LOW_VALUE", note: "SSE connection bookkeeping." },
  { prefix: "/api/activity", category: "LOW_VALUE", note: "Activity tracking stays off (H4)." },
  { prefix: "/api/ai", category: "LOW_VALUE", note: "AI stays off (H3)." },
  { prefix: "/api/compliance-bot", category: "LOW_VALUE", note: "AI stays off (H3)." },
  { prefix: "/api/webhooks", category: "NORMAL_OPERATIONAL", note: "Signed inbound events; the effects are recorded by the modules." },
];

/**
 * Fail-closed routes not yet converted. Each entry is a tracked gap for the
 * next release gate (review remediation), not an exception.
 */
export const AUDIT_GAPS: Readonly<Record<string, string>> = {
  "/api/admin/imports": "No write path yet: every upload is refused until its template exists (CONFIRM-IMPORT-FILENAMES). Convert with the first parser.",
  "/api/admin/jira-projects/[key]/discover": "Reads Jira metadata into the discovery cache only; convert with the Jira config review.",
  "/api/incidents": "Legacy incident log (fail-open audit today); superseded by client-incidents, convert or retire.",
  "/api/rca/tickets": "Creates an RCA ticket through the work item module; convert with the incident retirement.",
  "/api/travel-rule/cases": "Legacy travel-rule case records: convert at the next gate.",
  "/api/travel-rule/cases/[id]": "Legacy travel-rule case records: convert at the next gate.",
  "/api/travel-rule/cases/[id]/notes": "Legacy travel-rule case records: convert at the next gate.",
  "/api/travel-rule/cases/[id]/recheck": "Legacy travel-rule case records: convert at the next gate.",
  "/api/travel-rule/cases/bulk": "Legacy travel-rule case records: convert at the next gate.",
  "/api/travel-rule/vasp-directory": "Legacy travel-rule reference data: convert at the next gate.",
  "/api/screening": "Legacy screening records: convert at the next gate.",
  "/api/staking": "Legacy staking records: convert at the next gate.",
  "/api/usdc-ramp": "Module off by default (module.usdc_ramp); convert before enabling.",
  "/api/transaction-confirmations": "Legacy confirmation records: convert at the next gate.",
  "/api/settlements/notes": "Legacy settlement notes: convert at the next gate.",
  "/api/tokens": "Token review records (AI-assisted path off): convert at the next gate.",
};

export function auditCategoryFor(routePath: string): { category: AuditCategory; note?: string } | null {
  let best: { prefix: string; category: AuditCategory; note?: string } | null = null;
  for (const r of ROUTE_AUDIT_CATEGORY) {
    if ((routePath === r.prefix || routePath.startsWith(`${r.prefix}/`)) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return best ? { category: best.category, note: best.note } : null;
}

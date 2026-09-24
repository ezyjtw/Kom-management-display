/**
 * Typed runtime settings (AppSetting). Every key has a schema and a default;
 * a missing or invalid row falls back to the default, which is always the
 * safe/off value.
 */

import { z } from "zod";

export const PRIORITY_KEYWORDS_DEFAULT = [
  "urgent", "stuck", "not received", "failed", "withdraw", "settlement", "compromised", "phishing", "unauthorised",
];

export const SETTINGS = {
  /** Spec §9.1: only one Slack intake route may be active. */
  "intake.slack.route": { schema: z.enum(["off", "jsm_native", "kommand"]), default: "off" as const, label: "Slack intake route" },
  /** Evidence that docs/phase1/jsm-slack-verification.md was completed (required for jsm_native). */
  "intake.slack.jsmNativeVerification": {
    schema: z.object({ completedBy: z.string().min(1).max(200), completedAt: z.string().datetime(), evidenceUrl: z.string().url().max(500) }).nullable(),
    default: null,
    label: "JSM native Slack verification record",
  },
  /** Komainu's own Slack workspace (team) id; messages from other teams are external. */
  "intake.slack.komainuTeamId": { schema: z.string().regex(/^(T[A-Z0-9]{6,}|)$/), default: "", label: "Komainu Slack workspace id" },
  "intake.email.enabled": { schema: z.boolean(), default: false, label: "Email intake (custody inbox)" },
  "intake.teams.enabled": { schema: z.boolean(), default: false, label: "Teams intake (client channels)" },
  /** Komainu's Entra tenant id; Teams messages from other tenants are external. */
  "intake.teams.komainuTenantId": { schema: z.string().max(100), default: "", label: "Komainu Entra tenant id (Teams)" },
  /** Email domains that belong to Komainu staff. */
  "intake.internalEmailDomains": { schema: z.array(z.string().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(50), default: [] as string[], label: "Internal email domains" },
  /** Spec §9.2 rule 3: burst-merge window. */
  "intake.burstMergeSeconds": { schema: z.number().int().min(0).max(3600), default: 120, label: "Burst merge window (seconds)" },
  /** Spec §9.4: P1 keywords (seed list for review). */
  "intake.priorityKeywords": { schema: z.array(z.string().trim().toLowerCase().min(1).max(60)).max(100), default: PRIORITY_KEYWORDS_DEFAULT, label: "P1 priority keywords" },
  "intake.jsm.serviceDeskId": { schema: z.string().regex(/^\d*$/), default: "", label: "JSM service desk id" },
  "intake.jsm.requestTypeId": { schema: z.string().regex(/^\d*$/), default: "", label: "JSM request type id (client question)" },
  /** Custom field id of JSM "Organizations" on the request type, discovered by an admin. */
  "intake.jsm.organizationFieldId": { schema: z.string().regex(/^(customfield_\d+|)$/), default: "", label: "JSM Organizations field id" },
  /** Spec §10.2 root-cause list (seed; admin-editable). */
  "workItem.rootCauses": {
    schema: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1).max(50),
    default: ["client_error", "vendor_issue", "gx_defect", "data_issue", "process_gap", "configuration", "network_or_chain", "no_action_required", "duplicate", "other"],
    label: "Root causes (closure)",
  },
  /** CONFIRM-RISK-SCORE-SCALE: the team's ticket risk-score values. Empty = any non-empty value is accepted until confirmed. */
  "workItem.riskScoreScale": { schema: z.array(z.string().trim().min(1).max(40)).max(20), default: [] as string[], label: "Risk score scale (closure)" },
  /** Jira project for exceptions of daily checks without a definition. */
  "dailyChecks.defaultTicketProject": { schema: z.string().regex(/^[A-Z][A-Z0-9_]+$/), default: "TOPS", label: "Default ticket project for daily check exceptions" },
  /** Default freshness limit for daily check evidence when the definition sets none. */
  "dailyChecks.defaultFreshnessMinutes": { schema: z.number().int().min(1).max(7 * 24 * 60), default: 24 * 60, label: "Default evidence freshness (minutes)" },
  /** Ticket project for alerts whose rule route names none (spec §10.1). Empty = such alerts stay unticketed and appear in the daily report. */
  "alerts.defaultTicketProject": { schema: z.string().regex(/^([A-Z][A-Z0-9_]+|)$/), default: "", label: "Default ticket project for alerts" },
  /** Business hours for "business_uk" routing and SLA clocks (TODO(CONFIRM-BUSINESS-HOURS)). */
  "alerting.businessHours": {
    schema: z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).refine((v) => v.start < v.end, "start must be before end"),
    default: { start: "08:00", end: "18:00" },
    label: "Business hours (Europe/London)",
  },
  /** Spec §11.3: out of hours, a critical alert not acknowledged within this many minutes goes to the on-call secondary and the lead. */
  "alerting.oohAckMins": { schema: z.number().int().min(1).max(240), default: 15, label: "Out-of-hours acknowledgement window (minutes, critical)" },
  /** Spec §11.3 quiet rule: the same alert never re-notifies within this window. */
  "alerting.quietMins": { schema: z.number().int().min(1).max(240), default: 15, label: "Re-notification quiet window (minutes)" },
  /** Spec §12 CHK-09K: named users (user ids) allowed kps:view, in addition to admins. */
  "kps.viewerUserIds": { schema: z.array(z.string().min(1).max(100)).max(50), default: [] as string[], label: "KPS viewers (user ids)" },
  /** Incident severities that open an IAI draft (spec §12 CHK-11, TODO(CONFIRM-IAI-INCIDENT-CRITERIA)). Empty = none. */
  "incidents.iaiSeverities": { schema: z.array(z.enum(["low", "medium", "high", "critical"])).max(4), default: [] as string[], label: "Incident severities that open an IAI draft" },
  /** FAB instruction tickets (CONFIRM-FAB-PROJECT). Empty = instructions stay unticketed and appear in the daily report. */
  "fab.ticketProject": { schema: z.string().regex(/^([A-Z][A-Z0-9_]+|)$/), default: "", label: "FAB instruction ticket project" },
  /** Exposure bands for ALR-OES-06 client comms (CF-39). Empty = free text until the bands are agreed (CONFIRM-EXPOSURE-BANDS). */
  "oes.exposureBands": { schema: z.array(z.string().trim().min(1).max(60)).max(10), default: [] as string[], label: "OES client exposure bands" },
  /** CHK-02: risk score used when the daily TOPS MTD ticket closes automatically. Empty = comment only; the lead closes it. */
  "mtd.autoCloseRiskScore": { schema: z.string().trim().max(40), default: "", label: "Risk score for the automatic daily MTD close" },
  /** CHK-06: Jira project for "possible false positive" tickets to Tech (TODO(CONFIRM-TECH-PROJECT)). Empty = unticketed and reported. */
  "scamDust.techProject": { schema: z.string().regex(/^([A-Z][A-Z0-9_]+|)$/), default: "", label: "Tech project for scam/dust false positives" },
  /** Spec §12 CF-22: expected import filename per template (regex with a named group `date`). Missing = uploads refused (CONFIRM-IMPORT-FILENAMES). */
  "imports.filenamePatterns": {
    schema: z.record(z.string().regex(/^[a-z_]{2,40}$/), z.string().min(3).max(300).refine((v) => { try { return new RegExp(v).source.includes("?<date>"); } catch { return false; } }, "Must be a valid regex with a (?<date>...) group")),
    default: {} as Record<string, string>,
    label: "Import filename patterns",
  },
  // ── Spec §9.7 client incidents and risks ──
  /** Internal Jira project for incident and risk entries (TODO(CONFIRM-INCIDENT-PROJECT)). */
  "clientIncidents.internalProject": { schema: z.string().regex(/^[A-Z][A-Z0-9_]+$/), default: "TOPS", label: "Internal project for client incidents/risks" },
  /** JSM request type for client incident/risk notifications (TODO(CONFIRM-JSM-INCIDENT-REQUEST-TYPE)). Empty blocks client requests. */
  "clientIncidents.jsmRequestTypeId": { schema: z.string().regex(/^\d*$/), default: "", label: "JSM request type id (client incident/risk)" },
  /** JSM transition name that moves the client request into each of the four client-visible statuses (TODO(CONFIRM-JSM-INCIDENT-REQUEST-TYPE)). */
  "clientIncidents.statusNames": {
    schema: z.object({ Received: z.string().min(1).max(60), Investigating: z.string().min(1).max(60), "Update provided": z.string().min(1).max(60), Resolved: z.string().min(1).max(60) }),
    default: { Received: "Received", Investigating: "Investigating", "Update provided": "Update provided", Resolved: "Resolved" },
    label: "JSM transition per client-visible status",
  },
  /** Four-eyes on client-visible updates by severity (spec §9.7). */
  "clientUpdates.requireSecondApprover": { schema: z.array(z.enum(["P0", "P1", "P2", "P3"])).max(4), default: ["P0", "P1"] as string[], label: "Severities whose client updates need a second approver" },
  /** Categories that meet the IAI incident criteria (spec §10.4). Empty = none. */
  "clientIncidents.iaiCategories": { schema: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(50), default: [] as string[], label: "Categories that open an IAI draft" },
  /** Template for the human-sent message telling the client where to follow the ticket. */
  "clientIncidents.notifyTemplate": {
    schema: z.string().min(10).max(1000).refine((v) => v.includes("{key}") && v.includes("{link}"), "Must contain {key} and {link}"),
    default: "We've logged this as {key}. You can follow progress here: {link}",
    label: "Client notification template",
  },
  /** Email replies need the Graph Mail.Send permission (TODO(CONFIRM-GRAPH-MAIL-SEND)). Off: the operator sends from Outlook and marks it sent. */
  "clientIncidents.emailReplyEnabled": { schema: z.boolean(), default: false, label: "Send client email replies through Graph" },
  /** Spec §14.4 first-response quick action: human-sent; templates allowed, AI is not. {ticket} is replaced with the ticket key. */
  "workItem.firstResponseTemplates": {
    schema: z.array(z.string().min(5).max(1000)).max(20),
    default: [
      "Thanks, we have received your request and are looking into it. Our reference is {ticket}.",
      "Thanks for flagging this. We are checking now and will update you shortly. Reference: {ticket}.",
    ] as string[],
    label: "First-response templates",
  },
  /** Transition used for the one-click "not a question" close. */
  "intake.jsm.nonQuestionTransition": { schema: z.string().max(100), default: "", label: "JSM transition name for 'not a question'" },
} satisfies Record<string, { schema: z.ZodTypeAny; default: unknown; label: string }>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

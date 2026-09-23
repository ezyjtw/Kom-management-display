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
  /** Transition used for the one-click "not a question" close. */
  "intake.jsm.nonQuestionTransition": { schema: z.string().max(100), default: "", label: "JSM transition name for 'not a question'" },
} satisfies Record<string, { schema: z.ZodTypeAny; default: unknown; label: string }>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

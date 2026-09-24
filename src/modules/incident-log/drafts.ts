/**
 * INC drafts (spec §10.4). Behind `incident_log.drafts.enabled` (default off;
 * TODO(CONFIRM-INCIDENT-LOG-OWNER): the INC log is shared with other departments and
 * needs its owner's agreement). A draft is a pre-filled INC Jira issue in its
 * initial state, due within 24 hours; ALR-INCLOG-01 fires when it is overdue.
 */

import type { IncidentLogDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { createIssue, browseUrl } from "@/lib/integrations/atlassian/client";

export const INCIDENT_LOG_PROJECT_KEY = "INC";
export const INCIDENT_LOG_DUE_MS = 24 * 3_600_000;

/** Alerts that open an INC draft as soon as they fire. ALR-OES-06 covers "ALR-OES-01 unresolved at end of day". */
export const INCIDENT_LOG_ALERT_TRIGGERS = ["ALR-OES-06", "ALR-RSK-06", "ALR-CFG-01", "ALR-RLS-01", "ALR-BANK-05"] as const;
/** Trigger code for a P0/P1 SLA breach on a client request (raised by the SLA engine). */
export const INCIDENT_LOG_TRIGGER_CLIENT_SLA_BREACH = "SLA-CLIENT-P0P1";

/**
 * Create a draft for a WorkItem (once per trigger). Returns null when the flag
 * is off. The INC issue is created first; if that fails the draft is still
 * recorded (without jiraKey) so it is tracked and can be retried.
 */
export async function createIncidentLogDraft(workItemId: string, triggerCode: string, now = new Date()): Promise<IncidentLogDraft | null> {
  if (!(await isFeatureEnabled("incident_log.drafts.enabled"))) return null;

  const existing = await prisma.incidentLogDraft.findFirst({ where: { workItemId, triggerCode } });
  if (existing) return existing;

  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item) return null;

  let jiraKey: string | null = null;
  try {
    const project = await prisma.jiraProjectConfig.findUnique({ where: { key: INCIDENT_LOG_PROJECT_KEY } });
    const types = (project?.issueTypeIds ?? {}) as Record<string, string>;
    if (!project?.enabled || !types._default) throw new Error("INC project is not enabled or has no default issue type");
    const created = await createIssue({
      projectKey: INCIDENT_LOG_PROJECT_KEY,
      issueTypeId: types._default,
      summary: `[DRAFT] ${item.title}`,
      description: [
        "Draft raised automatically by KOMmand Centre. Complete within 24 hours.",
        `Trigger: ${triggerCode}`,
        `Work item ticket: ${item.ticketKey ?? "none"}${item.ticketKey && browseUrl(item.ticketKey) ? ` (${browseUrl(item.ticketKey)})` : ""}`,
        `Priority: ${item.priority}`,
        `Started: ${item.clockStartedAt.toISOString()}`,
        item.exposureUsd !== null ? `Exposure (USD): ${item.exposureUsd}` : "",
      ].filter(Boolean).join("\n"),
      labels: ["incident-log-draft", `trigger-${triggerCode.toLowerCase()}`],
    });
    jiraKey = created.key;
  } catch (error) {
    logger.warn("INC issue could not be created; draft recorded without a key", { workItemId, triggerCode, error: error instanceof Error ? error.message : String(error) });
  }

  return prisma.incidentLogDraft.create({ data: { workItemId, triggerCode, jiraKey, dueAt: new Date(now.getTime() + INCIDENT_LOG_DUE_MS) } });
}

/** Called for every newly raised alert. Never throws. */
export async function maybeCreateIncidentLogDraftForAlert(alertId: string): Promise<void> {
  try {
    const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { ruleCode: true, workItemId: true } });
    if (!alert?.workItemId || !(INCIDENT_LOG_ALERT_TRIGGERS as readonly string[]).includes(alert.ruleCode)) return;
    await createIncidentLogDraft(alert.workItemId, alert.ruleCode);
  } catch (error) {
    logger.error("INC draft creation failed", { alertId, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function completeIncidentLogDraft(id: string, now = new Date()): Promise<IncidentLogDraft | null> {
  const draft = await prisma.incidentLogDraft.findUnique({ where: { id } });
  if (!draft) return null;
  if (draft.completedAt) return draft;
  return prisma.incidentLogDraft.update({ where: { id }, data: { completedAt: now } });
}

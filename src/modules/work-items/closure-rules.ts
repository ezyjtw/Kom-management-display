/**
 * Closure write-up rules (spec §10.2). Shared by the close API and by
 * changeState, so the same validation runs before any Jira/JSM transition.
 */

import type { WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/modules/settings/settings";

export const MIN_RESOLUTION_NOTE_CHARS = 20;
/** Spec §7.7 time-log buckets (minutes). */
export const TIME_LOG_BUCKETS = [15, 30, 60, 120, 240] as const;

export interface WriteUp {
  resolutionNote: string;
  rootCause: string;
  riskScore: string;
  /** Required for client requests unless a time log already exists. */
  timeLogBucketMins?: number;
  /** Spec §9.7: final client-facing resolution message (human-written) for entries with a client request. */
  clientResolutionMessage?: string;
}

/**
 * How a close is justified: a full write-up, or the one-click "not a question"
 * close (spec §9.2 rule 7), which records its own controlled reason.
 */
export type ClosureBasis = { writeUp: WriteUp } | { nonActionable: { reason: string } };

export class ClosureValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`The work item cannot be closed: ${issues.join(" ")}`);
    this.name = "ClosureValidationError";
  }
}

/** Returns the list of problems (empty when the write-up is complete). */
export async function closureIssues(item: Pick<WorkItem, "id" | "kind"> & { metadata?: WorkItem["metadata"]; clientTicketKey?: string | null }, basis: ClosureBasis | undefined): Promise<string[]> {
  if (!basis) return ["A closure write-up (resolution note, root cause and risk score) is required."];
  if ("nonActionable" in basis) {
    return item.kind === "client_request" && basis.nonActionable.reason
      ? []
      : ["Only client requests can be closed as non-actionable, and a reason is required."];
  }

  const { resolutionNote, rootCause, riskScore, timeLogBucketMins } = basis.writeUp;
  const cfg = await getSettings(["workItem.rootCauses", "workItem.riskScoreScale"] as const);
  const issues: string[] = [];

  if ((resolutionNote ?? "").trim().length < MIN_RESOLUTION_NOTE_CHARS) {
    issues.push(`Resolution note must be at least ${MIN_RESOLUTION_NOTE_CHARS} characters.`);
  }
  if (!cfg["workItem.rootCauses"].includes(rootCause)) {
    issues.push(`Root cause must be one of: ${cfg["workItem.rootCauses"].join(", ")}.`);
  }
  const scale = cfg["workItem.riskScoreScale"];
  // TODO(CONFIRM-RISK-SCORE-SCALE): until the scale is configured any non-empty value is accepted.
  if (!riskScore?.trim()) {
    issues.push("A risk score is required.");
  } else if (scale.length && !scale.includes(riskScore.trim())) {
    issues.push(`Risk score must be one of: ${scale.join(", ")}.`);
  }

  // Spec §12 CHK-10: after ALR-OES-06 the client exposure band must be chosen (CF-39).
  if (item.kind === "oes_settlement" && (await prisma.alert.count({ where: { workItemId: item.id, ruleCode: "ALR-OES-06" } })) > 0) {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.exposureBand !== "string" || !meta.exposureBand) issues.push("Choose the client exposure band (ALR-OES-06) before closing.");
  }

  // Spec §12 CHK-06: the client advisory is recorded; a client override of Komainu's scam assessment needs the client decision attached (CF-35).
  if (item.kind === "scam_dust_case") {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.clientAdvisory !== "string" || !meta.clientAdvisory) issues.push("Record the client advisory before closing.");
    if (meta.clientOverride === true && (typeof meta.clientDecisionUrl !== "string" || !meta.clientDecisionUrl)) {
      issues.push("The client overrode Komainu's scam assessment: attach the client decision before closing (CF-35).");
    }
  }

  // Spec §9.7: a client incident/risk with a client request closes with a human-written resolution message for the client.
  if ((item.kind === "client_incident" || item.kind === "client_risk") && item.clientTicketKey) {
    if ((basis.writeUp.clientResolutionMessage ?? "").trim().length < 10) {
      issues.push("Write the client-facing resolution message (at least 10 characters); it is posted to the client request.");
    }
  }

  if (item.kind === "client_request") {
    if (timeLogBucketMins !== undefined) {
      if (!(TIME_LOG_BUCKETS as readonly number[]).includes(timeLogBucketMins)) {
        issues.push(`Time spent must be one of ${TIME_LOG_BUCKETS.join(", ")} minutes.`);
      }
    } else if ((await prisma.timeLog.count({ where: { workItemId: item.id } })) === 0) {
      issues.push("Closing a client request requires time spent (15, 30, 60, 120 or 240 minutes).");
    }
  }
  return issues;
}

export async function assertClosable(item: Pick<WorkItem, "id" | "kind"> & { metadata?: WorkItem["metadata"]; clientTicketKey?: string | null }, basis: ClosureBasis | undefined): Promise<void> {
  const issues = await closureIssues(item, basis);
  if (issues.length) throw new ClosureValidationError(issues);
}

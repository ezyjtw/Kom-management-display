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
export async function closureIssues(item: Pick<WorkItem, "id" | "kind">, basis: ClosureBasis | undefined): Promise<string[]> {
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

export async function assertClosable(item: Pick<WorkItem, "id" | "kind">, basis: ClosureBasis | undefined): Promise<void> {
  const issues = await closureIssues(item, basis);
  if (issues.length) throw new ClosureValidationError(issues);
}

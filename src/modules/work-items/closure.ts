/**
 * Close a WorkItem with its write-up (spec §10.2). The write-up is validated
 * first, then the ticket is transitioned (write-first), then the WorkItem and
 * time log are saved.
 */

import type { WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { changeState, TicketWriteError } from "@/modules/work-items/ticket-writeback";
import { assertClosable, type WriteUp } from "@/modules/work-items/closure-rules";

export interface CloseInput extends WriteUp {
  target?: "resolved" | "closed";
  transitionName?: string;
}

export class WorkItemStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkItemStateError";
  }
}

/** `loggedById` must be an Employee id (users without one log as "system"). */
export async function closeWorkItem(workItemId: string, input: CloseInput, loggedById: string): Promise<WorkItem> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item) throw new TicketWriteError("Work item not found");
  if (item.state === "closed") throw new WorkItemStateError("Work item is already closed.");

  const writeUp: WriteUp = {
    resolutionNote: input.resolutionNote.trim(),
    rootCause: input.rootCause,
    riskScore: input.riskScore.trim(),
    timeLogBucketMins: input.timeLogBucketMins,
  };
  await assertClosable(item, { writeUp });

  await changeState(workItemId, input.target ?? "closed", { transitionName: input.transitionName, closure: { writeUp } });

  const [updated] = await prisma.$transaction([
    prisma.workItem.update({
      where: { id: workItemId },
      data: { resolutionNote: writeUp.resolutionNote, rootCause: writeUp.rootCause, riskScore: writeUp.riskScore },
    }),
    ...(writeUp.timeLogBucketMins !== undefined
      ? [prisma.timeLog.create({ data: { workItemId, clientId: item.clientId, bucketMins: writeUp.timeLogBucketMins, loggedById } })]
      : []),
  ]);
  return updated;
}

/**
 * Write-first semantics (spec §8.2): owner and status changes made in
 * KOMmand Centre go to Jira/JSM first; the WorkItem is updated only after the
 * ticket accepted the change. On failure the error is thrown and local state
 * is unchanged.
 */

import type { WorkItem, WorkItemState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  addComment,
  addRequestComment,
  assignIssue,
  findAccountIdByEmail,
  getTransitions,
  transitionIssue,
} from "@/lib/integrations/atlassian/client";

export class TicketWriteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TicketWriteError";
  }
}

async function load(workItemId: string): Promise<WorkItem> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item) throw new TicketWriteError("Work item not found");
  return item;
}

async function tryRemote<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new TicketWriteError(`${what} failed in the ticketing system; nothing was changed locally.`, error);
  }
}

/** Assign (or unassign with null) in Jira, then locally. */
export async function assignOwner(workItemId: string, employeeId: string | null): Promise<WorkItem> {
  const item = await load(workItemId);

  if (item.ticketKey) {
    let accountId: string | null = null;
    if (employeeId) {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { email: true } });
      if (!emp) throw new TicketWriteError("Employee not found");
      accountId = await tryRemote("Assignee lookup", () => findAccountIdByEmail(emp.email));
      if (!accountId) throw new TicketWriteError(`No unique Jira user for ${emp.email}`);
    }
    await tryRemote("Assign", () => assignIssue(item.ticketKey!, accountId));
  }

  return prisma.workItem.update({
    where: { id: workItemId },
    data: {
      ownerEmployeeId: employeeId,
      ownedAt: employeeId ? item.ownedAt ?? new Date() : item.ownedAt,
      state: employeeId && item.state === "open" ? "owned" : item.state,
    },
  });
}

const CATEGORY_FOR_STATE: Record<WorkItemState, string> = {
  open: "new",
  owned: "indeterminate",
  waiting_client: "indeterminate",
  waiting_vendor: "indeterminate",
  waiting_internal: "indeterminate",
  resolved: "done",
  closed: "done",
};

/**
 * Move the ticket to a status in the matching category (transition ids are
 * looked up at runtime), then update the WorkItem. When several transitions
 * lead into the category, `transitionName` must say which.
 * Closing validation (write-up, root cause, risk score) is added in Phase 5.
 */
export async function changeState(workItemId: string, target: WorkItemState, opts: { transitionName?: string } = {}): Promise<WorkItem> {
  const item = await load(workItemId);

  if (item.ticketKey) {
    const transitions = await tryRemote("Transition lookup", () => getTransitions(item.ticketKey!));
    const category = CATEGORY_FOR_STATE[target];
    let candidates = transitions.filter((t) => t.to.statusCategory?.key === category);
    if (opts.transitionName) candidates = candidates.filter((t) => t.name === opts.transitionName);
    if (candidates.length !== 1) {
      throw new TicketWriteError(
        candidates.length === 0
          ? `Ticket ${item.ticketKey} has no transition into "${category}" from its current status`
          : `Several transitions lead to "${category}" (${candidates.map((c) => c.name).join(", ")}); choose one`,
      );
    }
    await tryRemote("Transition", () => transitionIssue(item.ticketKey!, candidates[0].id));
  }

  const now = new Date();
  return prisma.workItem.update({
    where: { id: workItemId },
    data: {
      state: target,
      resolvedAt: target === "resolved" || target === "closed" ? item.resolvedAt ?? now : item.resolvedAt,
    },
  });
}

/** Internal comment on the linked ticket. */
export async function commentInternal(workItemId: string, text: string): Promise<void> {
  const item = await load(workItemId);
  if (!item.ticketKey) throw new TicketWriteError("Work item has no linked ticket");
  await tryRemote("Comment", () =>
    item.ticketSystem === "jsm" ? addRequestComment(item.ticketKey!, text, { public: false }) : addComment(item.ticketKey!, text),
  );
}

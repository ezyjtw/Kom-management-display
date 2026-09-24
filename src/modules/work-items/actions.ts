/**
 * Work item actions (spec §14.2): take ownership, reassign, change state,
 * internal note, log time and link a related ticket. Ticket-side changes are
 * written first (spec §8.2). There are no transaction actions of any kind
 * (H1): these only touch tickets and WorkItems.
 */

import { z } from "zod";
import type { Prisma, WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { browseUrl, getIssue, isAtlassianConfigured, linkIssues } from "@/lib/integrations/atlassian/client";
import { emitWorkItemUpdate } from "@/lib/sse";
import { assignOwner, changeState, commentInternal, TicketWriteError } from "@/modules/work-items/ticket-writeback";
import { TIME_LOG_BUCKETS } from "@/modules/work-items/closure-rules";

export class WorkActionError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "WorkActionError";
  }
}

export interface Actor {
  userId: string;
  employeeId: string | null;
  role: string;
}

const isLead = (a: Actor) => a.role === "admin" || a.role === "lead";

async function load(id: string): Promise<WorkItem> {
  const item = await prisma.workItem.findUnique({ where: { id } });
  if (!item) throw new WorkActionError("Work item not found", 404);
  return item;
}

function notify(item: WorkItem, change: string) {
  emitWorkItemUpdate({ workItemId: item.id, team: item.team, change, priority: item.priority, kind: item.kind });
}

export const ownershipSchema = z.object({ employeeId: z.union([z.literal("me"), z.string().min(1).max(100), z.null()]) });

/** Take ownership ("me"), reassign (lead, admin or the current owner) or unassign (null). */
export async function setOwner(id: string, target: "me" | string | null, actor: Actor): Promise<WorkItem> {
  const item = await load(id);
  if (item.state === "closed" || item.state === "resolved") throw new WorkActionError("Closed or resolved items cannot be reassigned.", 409);
  const employeeId = target === "me" ? actor.employeeId : target;
  if (target === "me" && !employeeId) throw new WorkActionError("Your user has no employee record, so you cannot own work items.");
  const self = employeeId !== null && employeeId === actor.employeeId;
  if (!self && !isLead(actor) && item.ownerEmployeeId !== actor.employeeId) {
    throw new WorkActionError("Only a lead, an admin or the current owner can reassign this item.", 403);
  }
  if (employeeId) {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { active: true } });
    if (!emp?.active) throw new WorkActionError("That employee does not exist or is inactive.");
  }
  const updated = await assignOwner(id, employeeId);
  notify(updated, "owner");
  return updated;
}

const WAITING = ["waiting_client", "waiting_vendor", "waiting_internal"] as const;

export const stateSchema = z.object({
  state: z.enum(["open", "owned", ...WAITING]),
  reason: z.string().trim().max(500).optional(),
  transitionName: z.string().trim().min(1).max(100).optional(),
});

/**
 * Non-closing state changes (resolve and close go through the write-up, spec
 * §10.2). A waiting state needs a reason; it shows as the blocker on the
 * morning board (spec §14.3).
 */
export async function setState(id: string, input: z.infer<typeof stateSchema>): Promise<WorkItem> {
  const item = await load(id);
  if (item.state === "closed") throw new WorkActionError("The item is closed.", 409);
  const waiting = (WAITING as readonly string[]).includes(input.state);
  if (waiting && (input.reason ?? "").length < 5) throw new WorkActionError("Say what the item is waiting for (at least 5 characters).");
  await changeState(id, input.state, { transitionName: input.transitionName });
  const current = await load(id);
  const meta = { ...((current.metadata ?? {}) as Record<string, unknown>) };
  if (waiting) {
    meta.waitingReason = input.reason;
    meta.waitingSince = new Date().toISOString();
  } else {
    delete meta.waitingReason;
    delete meta.waitingSince;
  }
  const updated = await prisma.workItem.update({ where: { id }, data: { metadata: meta as Prisma.InputJsonValue } });
  notify(updated, "state");
  return updated;
}

export const noteSchema = z.object({ text: z.string().trim().min(2).max(5000) });

/** Internal note: posted as an internal (non-client-visible) comment on the ticket. */
export async function addNote(id: string, text: string): Promise<void> {
  const item = await load(id);
  if (!item.ticketKey) throw new WorkActionError("This item has no ticket to comment on.", 409);
  await commentInternal(id, text);
  notify(item, "note");
}

export const timeSchema = z.object({ bucketMins: z.number().int().refine((v) => (TIME_LOG_BUCKETS as readonly number[]).includes(v), { message: `bucketMins must be one of ${TIME_LOG_BUCKETS.join(", ")}` }) });

export async function logTime(id: string, bucketMins: number, loggedById: string) {
  const item = await load(id);
  const log = await prisma.timeLog.create({ data: { workItemId: id, clientId: item.clientId, bucketMins, loggedById } });
  notify(item, "time");
  return log;
}

export const linkSchema = z.object({ key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,9}-\d{1,7}$/, "Enter a ticket key like OPS-123") });

/** Link a related Jira ticket: checked to exist, linked in Jira first when the item has its own ticket, then recorded. */
export async function linkTicket(id: string, key: string) {
  const item = await load(id);
  if (key === item.ticketKey || key === item.clientTicketKey) throw new WorkActionError("That is this item's own ticket.", 409);
  if (isAtlassianConfigured()) {
    try {
      await getIssue(key, ["summary"]);
    } catch {
      throw new WorkActionError(`Ticket ${key} could not be found in Jira.`, 422);
    }
    if (item.ticketKey) {
      try {
        await linkIssues(item.ticketKey, key);
      } catch (error) {
        throw new TicketWriteError("Linking in Jira failed; nothing was changed locally.", error);
      }
    }
  }
  const url = browseUrl(key) ?? "";
  const link = await prisma.ticketLink.upsert({
    where: { system_key_workItemId: { system: "jira", key, workItemId: id } },
    update: { role: "related" },
    create: { workItemId: id, system: "jira", key, url, role: "related" },
  });
  notify(item, "link");
  return link;
}

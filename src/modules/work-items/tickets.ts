/**
 * Tickets by default (spec §10.1). Tickets are created in Jira/JSM first; the
 * WorkItem records the key only after the ticketing system accepted it. When
 * creation fails the WorkItem keeps `metadata.writebackError`, which the daily
 * unticketed-work report lists (spec §10.3).
 */

import { Prisma, type WorkItem, type WorkItemKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitWorkItemUpdate } from "@/lib/sse";
import { logger } from "@/lib/logger";
import { browseUrl, createIssue } from "@/lib/integrations/atlassian/client";
import { commentInternal } from "@/modules/work-items/ticket-writeback";
import { getSetting } from "@/modules/settings/settings";

export interface TicketSpec {
  projectKey: string;
  summary: string;
  description: string;
  labels?: string[];
  /** Issue type name in JiraProjectConfig.issueTypeIds; falls back to `_default`. */
  issueType?: string;
  /** Jira due date, YYYY-MM-DD. */
  dueDate?: string;
}

export class TicketConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketConfigError";
  }
}

function meta(item: Pick<WorkItem, "metadata">): Record<string, unknown> {
  return item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? (item.metadata as Record<string, unknown>) : {};
}

/** Create the ticket in Jira/JSM. Throws TicketConfigError when the project is not set up. */
async function createRemote(spec: TicketSpec): Promise<{ key: string; system: "jira" | "jsm"; url: string | null }> {
  const project = await prisma.jiraProjectConfig.findUnique({ where: { key: spec.projectKey } });
  if (!project) throw new TicketConfigError(`Ticket project ${spec.projectKey} is not configured.`);
  if (!project.enabled) throw new TicketConfigError(`Ticket project ${spec.projectKey} is not enabled.`);
  const types = (project.issueTypeIds && typeof project.issueTypeIds === "object" ? project.issueTypeIds : {}) as Record<string, string>;
  const issueTypeId = (spec.issueType && types[spec.issueType]) || types._default;
  if (!issueTypeId) throw new TicketConfigError(`Ticket project ${spec.projectKey} has no default issue type; discover issue types in Admin → Jira projects.`);

  const created = await createIssue({
    projectKey: spec.projectKey,
    issueTypeId,
    summary: spec.summary,
    description: spec.description,
    labels: ["kommand-centre", ...(spec.labels ?? [])],
    dueDate: spec.dueDate,
  });
  return { key: created.key, system: project.kind === "jsm" ? "jsm" : "jira", url: browseUrl(created.key) };
}

async function recordError(workItemId: string, error: unknown): Promise<void> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId }, select: { metadata: true } });
  if (!item) return;
  const message = error instanceof Error ? error.message : String(error);
  await prisma.workItem.update({
    where: { id: workItemId },
    data: { metadata: { ...meta(item), writebackError: { message: message.slice(0, 500), at: new Date().toISOString() } } as Prisma.InputJsonValue },
  });
}

/**
 * Give an existing WorkItem its ticket. Returns the ticket key, or null when
 * it could not be created (the reason is kept in metadata.writebackError).
 */
export async function createTicketForWorkItem(workItemId: string, spec: TicketSpec): Promise<string | null> {
  const item = await prisma.workItem.findUnique({ where: { id: workItemId } });
  if (!item) throw new Error("Work item not found");
  if (item.ticketKey) return item.ticketKey;

  let remote: Awaited<ReturnType<typeof createRemote>>;
  try {
    remote = await createRemote(spec);
  } catch (error) {
    logger.warn("Ticket creation failed; work item left unticketed", { workItemId, projectKey: spec.projectKey, error: error instanceof Error ? error.message : String(error) });
    await recordError(workItemId, error);
    return null;
  }

  const { writebackError: _cleared, ...rest } = meta(item);
  void _cleared;
  await prisma.$transaction([
    prisma.workItem.update({
      where: { id: workItemId },
      data: { ticketKey: remote.key, ticketSystem: remote.system, ticketUrl: remote.url, metadata: rest as Prisma.InputJsonValue },
    }),
    ...(remote.url
      ? [prisma.ticketLink.create({ data: { workItemId, system: remote.system, key: remote.key, url: remote.url, role: "primary" } })]
      : []),
  ]);
  return remote.key;
}

export interface NewTicketedWorkItem {
  kind: WorkItemKind;
  title: string;
  team?: string;
  taskCode: string;
  sourceSystem: string;
  sourceId: string;
  clockStartedAt: Date;
  priority?: string;
  clientId?: string | null;
  metadata?: Record<string, unknown>;
  /** SlaPolicy.code to attach (e.g. "MTD-BREAK"). */
  slaPolicyCode?: string;
  ticket: TicketSpec | null;
}

/** Upsert the WorkItem for (sourceSystem, sourceId), then make sure it has a ticket. */
export async function ensureTicketedWorkItem(input: NewTicketedWorkItem): Promise<WorkItem> {
  const sla = input.slaPolicyCode ? await prisma.slaPolicy.findUnique({ where: { code: input.slaPolicyCode }, select: { id: true } }) : null;
  const existed = await prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: input.sourceSystem, sourceId: input.sourceId } }, select: { id: true } });
  const item = await prisma.workItem.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: input.sourceSystem, sourceId: input.sourceId } },
    update: {},
    create: {
      kind: input.kind,
      title: input.title.slice(0, 255),
      team: input.team ?? "All",
      taskCode: input.taskCode,
      sourceSystem: input.sourceSystem,
      sourceId: input.sourceId,
      clockStartedAt: input.clockStartedAt,
      priority: input.priority ?? "P2",
      clientId: input.clientId ?? null,
      slaPolicyId: sla?.id ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  // Spec §14.4: queues refresh; browsers that opted in notify on new P1 client requests.
  if (!existed) emitWorkItemUpdate({ workItemId: item.id, team: item.team, change: "created", priority: item.priority, kind: item.kind });
  if (item.ticketKey) return item;
  if (!input.ticket) {
    await recordError(item.id, new TicketConfigError("No ticket project is configured for this work item."));
  } else {
    await createTicketForWorkItem(item.id, input.ticket);
  }
  return (await prisma.workItem.findUnique({ where: { id: item.id } })) ?? item;
}

/** Project for an alert rule: AlertRule.route.ticketProject, else the admin default. */
async function alertTicketProject(route: unknown): Promise<string | null> {
  const fromRoute = route && typeof route === "object" && !Array.isArray(route) ? (route as Record<string, unknown>).ticketProject : undefined;
  if (typeof fromRoute === "string" && fromRoute) return fromRoute;
  return (await getSetting("alerts.defaultTicketProject")) || null;
}

/**
 * Spec §10.1: every alert that fires has a WorkItem and ticket. The first
 * firing creates them; repeat firings add a comment to the same ticket.
 * Never throws: alerting must not fail because Jira is unavailable.
 */
export async function ensureAlertTicket(
  alertId: string,
  opts: { repeat: boolean; seed?: { kind?: WorkItemKind; team?: string; taskCode?: string; clientId?: string | null; priority?: string } },
): Promise<void> {
  try {
    const alert = await prisma.alert.findUnique({ where: { id: alertId }, include: { workItem: true } });
    if (!alert) return;

    if (alert.workItem?.ticketKey) {
      if (opts.repeat) {
        await commentInternal(alert.workItem.id, `Alert ${alert.ruleCode} fired again (${alert.fireCount} times; last at ${alert.lastFiredAt.toISOString()}).`);
      }
      return;
    }

    const rule = await prisma.alertRule.findUnique({ where: { code: alert.ruleCode }, select: { route: true } });
    const projectKey = await alertTicketProject(rule?.route);
    const ticket: TicketSpec | null = projectKey
      ? {
          projectKey,
          summary: `[${alert.ruleCode}] ${alert.message}`,
          description: `Raised automatically by KOMmand Centre.\nRule: ${alert.ruleCode}\nSeverity: ${alert.severity}\nFirst fired: ${alert.firstFiredAt.toISOString()}\n\n${alert.message}${alert.detail ? `\n\n${alert.detail}` : ""}`,
          labels: [`alert-${alert.ruleCode.toLowerCase()}`],
        }
      : null;

    if (alert.workItem) {
      if (ticket) await createTicketForWorkItem(alert.workItem.id, ticket);
      return;
    }

    const item = await ensureTicketedWorkItem({
      kind: opts.seed?.kind ?? "alert",
      title: `[${alert.ruleCode}] ${alert.message}`,
      team: opts.seed?.team,
      taskCode: opts.seed?.taskCode ?? alert.ruleCode,
      sourceSystem: "alert",
      sourceId: `${alert.ruleCode}:${alert.dedupeKey}:${alert.id}`,
      clockStartedAt: alert.firstFiredAt,
      priority: opts.seed?.priority ?? alert.priority,
      clientId: opts.seed?.clientId ?? null,
      metadata: { alertId: alert.id, ruleCode: alert.ruleCode, dedupeKey: alert.dedupeKey },
      ticket,
    });
    await prisma.alert.update({ where: { id: alert.id }, data: { workItemId: item.id } });
  } catch (error) {
    logger.error("Could not ticket alert", { alertId, error: error instanceof Error ? error.message : String(error) });
  }
}

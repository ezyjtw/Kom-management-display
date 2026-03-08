/**
 * Incident Domain Service
 *
 * Manages the lifecycle of third-party provider incidents, RCA workflow
 * tracking, external ticket integration, and dispute management for
 * premature closures by providers.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { RcaStatus, RcaFollowUpItem } from "@/types";

// ─── Types ───

export type IncidentStatus = "active" | "monitoring" | "resolved";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentUpdateType = "update" | "escalation" | "resolution";

export interface CreateIncidentInput {
  title: string;
  provider: string;
  severity?: string;
  description?: string;
  impact?: string;
  reportedById: string;
  linkedThreadIds?: string[];
  linkedTransactionIds?: string[];
  externalTicketRef?: string;
  externalTicketUrl?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  severity?: string;
  description?: string;
  impact?: string;
  status?: IncidentStatus;
  resolvedById?: string;
  linkedThreadIds?: string[];
  linkedTransactionIds?: string[];
}

export interface IncidentRecord {
  id: string;
  title: string;
  provider: string;
  severity: string;
  status: string;
  description: string;
  impact: string;
  startedAt: Date;
  resolvedAt: Date | null;
  reportedById: string;
  resolvedById: string | null;
  linkedThreadIds: string;
  linkedTransactionIds: string;
  rcaStatus: string;
  rcaDocumentRef: string;
  rcaResponsibleId: string | null;
  rcaSlaDeadline: Date | null;
  rcaReceivedAt: Date | null;
  rcaFollowUpItems: string;
  rcaRaisedAt: Date | null;
  externalTicketRef: string;
  externalTicketUrl: string;
  externalTicketStatus: string;
  externalTicketLastSyncAt: Date | null;
  externalTicketDisputed: boolean;
  externalTicketDisputeReason: string;
  createdAt: Date;
  updatedAt: Date;
  updates?: Array<{
    id: string;
    content: string;
    type: string;
    authorId: string;
    createdAt: Date;
  }>;
  alerts?: Array<{
    id: string;
    type: string;
    status: string;
    message: string;
  }>;
}

export interface IncidentFilters {
  status?: IncidentStatus | IncidentStatus[];
  severity?: IncidentSeverity | IncidentSeverity[];
  provider?: string;
  rcaStatus?: RcaStatus;
  hasExternalTicket?: boolean;
  isDisputed?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface IncidentPagination {
  page?: number;
  pageSize?: number;
  orderBy?: "createdAt" | "severity" | "status" | "provider";
  order?: "asc" | "desc";
}

export interface RcaTransitionInput {
  incidentId: string;
  targetStatus: RcaStatus;
  performedById: string;
  documentRef?: string;
  responsibleId?: string;
  slaDeadline?: Date;
  note?: string;
}

export interface RcaUpdateInput {
  rcaStatus: string;
  rcaDocumentRef?: string;
  rcaResponsibleId?: string;
  rcaSlaDeadline?: Date;
  rcaFollowUpItems?: Array<{ title: string; status: string; assigneeId?: string }>;
}

export interface DisputeInput {
  incidentId: string;
  reason: string;
  performedById: string;
  requestReopen?: boolean;
}

// ─── Valid transitions ───

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  active: ["monitoring", "resolved"],
  monitoring: ["active", "resolved"],
  resolved: ["active"], // Can reopen
};

const VALID_RCA_TRANSITIONS: Record<string, string[]> = {
  none: ["raised"],
  raised: ["awaiting_rca"],
  awaiting_rca: ["rca_received", "follow_up_pending"],
  rca_received: ["follow_up_pending", "closed"],
  follow_up_pending: ["closed"],
  closed: ["raised"], // Can re-open
};

// ─── Service ───

export const incidentService = {
  // ──────────────────────────────
  // Incident CRUD
  // ──────────────────────────────

  /**
   * List incidents with filtering and pagination.
   */
  async getIncidents(
    filters: IncidentFilters = {},
    pagination: IncidentPagination = {},
  ): Promise<{ incidents: IncidentRecord[]; total: number }> {
    const where = buildIncidentWhere(filters);
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 25));

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where,
        include: {
          updates: { orderBy: { createdAt: "desc" }, take: 3 },
          alerts: {
            where: { status: { in: ["active", "acknowledged"] } },
            select: { id: true, type: true, status: true, message: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [pagination.orderBy ?? "createdAt"]: pagination.order ?? "desc" },
      }),
      prisma.incident.count({ where }),
    ]);

    return { incidents: incidents as unknown as IncidentRecord[], total };
  },

  /**
   * Get a single incident with full detail including timeline.
   */
  async getIncidentById(id: string): Promise<IncidentRecord | null> {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        updates: { orderBy: { createdAt: "asc" } },
        alerts: { orderBy: { createdAt: "desc" } },
        ticketEvents: { orderBy: { createdAt: "asc" } },
        reportedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
        rcaResponsible: { select: { id: true, name: true } },
      },
    });
    return incident as unknown as IncidentRecord | null;
  },

  /**
   * Create a new incident.
   */
  async createIncident(input: CreateIncidentInput): Promise<IncidentRecord> {
    const incident = await prisma.incident.create({
      data: {
        title: input.title,
        provider: input.provider,
        severity: (input.severity ?? "medium") as unknown as import("@prisma/client").IncidentSeverity,
        description: input.description ?? "",
        impact: input.impact ?? "",
        reportedById: input.reportedById,
        linkedThreadIds: JSON.stringify(input.linkedThreadIds ?? []),
        linkedTransactionIds: JSON.stringify(input.linkedTransactionIds ?? []),
        externalTicketRef: input.externalTicketRef ?? "",
        externalTicketUrl: input.externalTicketUrl ?? "",
      },
      include: {
        reportedBy: { select: { name: true } },
      },
    });

    await writeAuditLog("incident_created", "incident", incident.id, input.reportedById, {
      title: input.title,
      provider: input.provider,
      severity: input.severity ?? "medium",
    });

    logger.info("incidentService.createIncident", {
      id: incident.id,
      provider: input.provider,
      severity: input.severity,
    });

    return incident as unknown as IncidentRecord;
  },

  /**
   * Update an existing incident with status transition validation.
   */
  async updateIncident(
    id: string,
    input: UpdateIncidentInput,
    performedById: string,
  ): Promise<IncidentRecord> {
    const existing = await prisma.incident.findUnique({ where: { id } });
    if (!existing) throw new Error("Incident not found");

    // Validate status transition
    if (input.status && input.status !== existing.status) {
      const allowed = VALID_STATUS_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(input.status)) {
        throw new Error(
          `Invalid status transition: ${existing.status} -> ${input.status}. Allowed: ${allowed.join(", ")}`,
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.title !== undefined) updateData.title = input.title;
    if (input.severity !== undefined) updateData.severity = input.severity;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.impact !== undefined) updateData.impact = input.impact;
    if (input.linkedThreadIds !== undefined) {
      updateData.linkedThreadIds = JSON.stringify(input.linkedThreadIds);
    }
    if (input.linkedTransactionIds !== undefined) {
      updateData.linkedTransactionIds = JSON.stringify(input.linkedTransactionIds);
    }

    if (input.status !== undefined) {
      updateData.status = input.status;
      if (input.status === "resolved") {
        updateData.resolvedAt = new Date();
        updateData.resolvedById = input.resolvedById ?? performedById;
      }
    }

    const updated = await prisma.incident.update({ where: { id }, data: updateData });

    await writeAuditLog(
      input.status === "resolved" ? "incident_resolved" : "incident_update",
      "incident",
      id,
      performedById,
      {
        previousStatus: existing.status,
        newStatus: updated.status,
        fields: Object.keys(input),
      },
    );

    logger.info("incidentService.updateIncident", { id, fields: Object.keys(input) });
    return updated as unknown as IncidentRecord;
  },

  /**
   * Add an update to an incident timeline.
   */
  async addUpdate(
    incidentId: string,
    authorId: string,
    content: string,
    type: IncidentUpdateType = "update",
  ): Promise<void> {
    await prisma.incidentUpdate.create({
      data: { incidentId, authorId, content, type },
    });
    logger.debug("incidentService.addUpdate", { incidentId, type });
  },

  // ──────────────────────────────
  // Incident lifecycle management
  // ──────────────────────────────

  /**
   * Resolve an incident with an optional resolution note.
   */
  async resolveIncident(
    id: string,
    resolvedById: string,
    resolutionNote?: string,
  ): Promise<IncidentRecord> {
    const incident = await this.updateIncident(
      id,
      { status: "resolved", resolvedById },
      resolvedById,
    );

    if (resolutionNote) {
      await this.addUpdate(id, resolvedById, resolutionNote, "resolution");
    }

    return incident;
  },

  // ──────────────────────────────
  // RCA workflow tracking
  // ──────────────────────────────

  /**
   * Transition the RCA status of an incident through the workflow.
   *
   * Valid transitions:
   *   none -> raised
   *   raised -> awaiting_rca
   *   awaiting_rca -> rca_received | follow_up_pending
   *   rca_received -> follow_up_pending | closed
   *   follow_up_pending -> closed
   *   closed -> raised (re-open)
   */
  async transitionRca(input: RcaTransitionInput): Promise<{
    success: boolean;
    incident: IncidentRecord;
    error?: string;
  }> {
    const incident = await prisma.incident.findUnique({ where: { id: input.incidentId } });
    if (!incident) throw new Error(`Incident ${input.incidentId} not found`);

    const currentStatus = incident.rcaStatus;
    const validTargets = VALID_RCA_TRANSITIONS[currentStatus] || [];

    if (!validTargets.includes(input.targetStatus)) {
      return {
        success: false,
        incident: incident as unknown as IncidentRecord,
        error: `Invalid RCA transition: ${currentStatus} -> ${input.targetStatus}. Valid: ${validTargets.join(", ") || "none"}`,
      };
    }

    const updateData: Record<string, unknown> = {
      rcaStatus: input.targetStatus,
    };

    if (input.targetStatus === "raised") {
      updateData.rcaRaisedAt = new Date();
      if (input.responsibleId) updateData.rcaResponsibleId = input.responsibleId;
      if (input.slaDeadline) updateData.rcaSlaDeadline = input.slaDeadline;
    }

    if (input.targetStatus === "rca_received") {
      updateData.rcaReceivedAt = new Date();
      if (input.documentRef) updateData.rcaDocumentRef = input.documentRef;
    }

    const updated = await prisma.incident.update({
      where: { id: input.incidentId },
      data: updateData,
    });

    if (input.note) {
      await this.addUpdate(
        input.incidentId,
        input.performedById,
        `[RCA: ${currentStatus} -> ${input.targetStatus}] ${input.note}`,
      );
    }

    await writeAuditLog("rca_transition", "incident", input.incidentId, input.performedById, {
      from: currentStatus,
      to: input.targetStatus,
    });

    logger.info("incidentService.transitionRca", {
      incidentId: input.incidentId,
      from: currentStatus,
      to: input.targetStatus,
    });

    return { success: true, incident: updated as unknown as IncidentRecord };
  },

  /**
   * Update RCA details using the legacy input format (for backward compatibility).
   */
  async updateRca(
    incidentId: string,
    input: RcaUpdateInput,
    userId: string,
  ): Promise<IncidentRecord> {
    const existing = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!existing) throw new Error("Incident not found");

    const allowed = VALID_RCA_TRANSITIONS[existing.rcaStatus] || [];
    if (!allowed.includes(input.rcaStatus)) {
      throw new Error(
        `Invalid RCA transition: ${existing.rcaStatus} -> ${input.rcaStatus}. Allowed: ${allowed.join(", ")}`,
      );
    }

    const data: Record<string, unknown> = { rcaStatus: input.rcaStatus };
    if (input.rcaDocumentRef !== undefined) data.rcaDocumentRef = input.rcaDocumentRef;
    if (input.rcaResponsibleId) data.rcaResponsibleId = input.rcaResponsibleId;
    if (input.rcaSlaDeadline) data.rcaSlaDeadline = input.rcaSlaDeadline;
    if (input.rcaFollowUpItems) data.rcaFollowUpItems = JSON.stringify(input.rcaFollowUpItems);
    if (input.rcaStatus === "raised") data.rcaRaisedAt = new Date();
    if (input.rcaStatus === "rca_received") data.rcaReceivedAt = new Date();

    const updated = await prisma.incident.update({ where: { id: incidentId }, data });

    await writeAuditLog("rca_update", "incident", incidentId, userId, {
      from: existing.rcaStatus,
      to: input.rcaStatus,
    });

    return updated as unknown as IncidentRecord;
  },

  /**
   * Update follow-up items for an RCA.
   */
  async updateRcaFollowUpItems(
    incidentId: string,
    items: RcaFollowUpItem[],
    performedById: string,
  ): Promise<IncidentRecord> {
    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: { rcaFollowUpItems: JSON.stringify(items) },
    });

    await writeAuditLog("rca_followup_updated", "incident", incidentId, performedById, {
      itemCount: items.length,
      completedCount: items.filter((i) => i.status === "done").length,
    });

    return updated as unknown as IncidentRecord;
  },

  // ──────────────────────────────
  // External ticket integration
  // ──────────────────────────────

  /**
   * Link or update the external ticket reference for an incident.
   */
  async linkExternalTicket(
    incidentId: string,
    ticketRef: string,
    ticketUrl: string,
    ticketStatus: string,
    performedById: string,
  ): Promise<IncidentRecord> {
    const incident = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        externalTicketRef: ticketRef,
        externalTicketUrl: ticketUrl,
        externalTicketStatus: ticketStatus,
        externalTicketLastSyncAt: new Date(),
      },
    });

    await prisma.externalTicketEvent.create({
      data: {
        incidentId,
        event: "status_changed",
        toStatus: ticketStatus,
        performedBy: performedById,
      },
    });

    logger.info("incidentService.linkExternalTicket", {
      incidentId,
      ticketRef,
      ticketStatus,
    });

    return incident as unknown as IncidentRecord;
  },

  /**
   * Sync the external ticket status. Called by automated sync jobs
   * or manual refresh. Auto-detects premature closure.
   */
  async syncExternalTicketStatus(
    incidentId: string,
    newStatus: string,
  ): Promise<IncidentRecord> {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    const previousStatus = incident.externalTicketStatus;

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        externalTicketStatus: newStatus,
        externalTicketLastSyncAt: new Date(),
      },
    });

    if (previousStatus !== newStatus) {
      await prisma.externalTicketEvent.create({
        data: {
          incidentId,
          event: "status_changed",
          fromStatus: previousStatus,
          toStatus: newStatus,
          performedBy: "jira_sync",
        },
      });

      // Auto-detect premature closure
      if (isClosedStatus(newStatus) && incident.status === "active") {
        await prisma.externalTicketEvent.create({
          data: {
            incidentId,
            event: "provider_closed",
            fromStatus: previousStatus,
            toStatus: newStatus,
            performedBy: "jira_sync",
            reason: "Provider closed ticket while internal incident is still active",
          },
        });

        logger.warn("incidentService.syncExternalTicketStatus: premature closure detected", {
          incidentId,
          ticketRef: incident.externalTicketRef,
          newStatus,
        });
      }
    }

    return updated as unknown as IncidentRecord;
  },

  // ──────────────────────────────
  // Dispute management
  // ──────────────────────────────

  /**
   * Dispute a provider's ticket closure. Marks the ticket as disputed
   * and optionally requests a reopen.
   */
  async disputeTicketClosure(input: DisputeInput): Promise<IncidentRecord> {
    const incident = await prisma.incident.findUnique({ where: { id: input.incidentId } });
    if (!incident) throw new Error(`Incident ${input.incidentId} not found`);

    const updated = await prisma.incident.update({
      where: { id: input.incidentId },
      data: {
        externalTicketDisputed: true,
        externalTicketDisputeReason: input.reason,
      },
    });

    await prisma.externalTicketEvent.create({
      data: {
        incidentId: input.incidentId,
        event: "disputed",
        fromStatus: incident.externalTicketStatus,
        toStatus: incident.externalTicketStatus,
        performedBy: input.performedById,
        reason: input.reason,
      },
    });

    if (input.requestReopen) {
      await prisma.externalTicketEvent.create({
        data: {
          incidentId: input.incidentId,
          event: "reopen_requested",
          fromStatus: incident.externalTicketStatus,
          performedBy: input.performedById,
          reason: `Reopen requested: ${input.reason}`,
        },
      });
    }

    await this.addUpdate(
      input.incidentId,
      input.performedById,
      `[DISPUTE] Provider ticket ${incident.externalTicketRef} closure disputed. Reason: ${input.reason}${input.requestReopen ? ". Reopen requested." : ""}`,
      "escalation",
    );

    await writeAuditLog("ticket_disputed", "incident", input.incidentId, input.performedById, {
      ticketRef: incident.externalTicketRef,
      reason: input.reason,
      requestReopen: input.requestReopen ?? false,
    });

    logger.info("incidentService.disputeTicketClosure", {
      incidentId: input.incidentId,
      ticketRef: incident.externalTicketRef,
      requestReopen: input.requestReopen,
    });

    return updated as unknown as IncidentRecord;
  },

  /**
   * Get the full event log for an external ticket linked to an incident.
   */
  async getTicketEventLog(
    incidentId: string,
  ): Promise<
    Array<{
      id: string;
      event: string;
      fromStatus: string;
      toStatus: string;
      performedBy: string;
      reason: string;
      createdAt: Date;
    }>
  > {
    return prisma.externalTicketEvent.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
    });
  },

  /**
   * Get incident with unified timeline combining updates, ticket events,
   * and alerts.
   */
  async getIncidentWithTimeline(id: string) {
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        reportedBy: { select: { name: true, email: true } },
        resolvedBy: { select: { name: true, email: true } },
        rcaResponsible: { select: { name: true, email: true } },
        updates: { orderBy: { createdAt: "asc" } },
        alerts: { orderBy: { createdAt: "desc" } },
        ticketEvents: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!incident) return null;

    const timeline: Array<{
      type: string;
      timestamp: Date;
      actor: string;
      content: string;
      metadata?: Record<string, unknown>;
    }> = [];

    for (const update of incident.updates) {
      timeline.push({
        type: update.type,
        timestamp: update.createdAt,
        actor: update.authorId,
        content: update.content,
      });
    }

    for (const event of incident.ticketEvents) {
      timeline.push({
        type: `ticket_${event.event}`,
        timestamp: event.createdAt,
        actor: event.performedBy || "system",
        content: event.reason || `Status: ${event.fromStatus} -> ${event.toStatus}`,
        metadata: { fromStatus: event.fromStatus, toStatus: event.toStatus },
      });
    }

    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return { ...incident, timeline };
  },
};

// ─── Internal Helpers ───

function isClosedStatus(status: string): boolean {
  const closedStatuses = ["closed", "resolved", "done", "cancelled", "won't fix", "wontfix"];
  return closedStatuses.includes(status.toLowerCase());
}

function buildIncidentWhere(filters: IncidentFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
  }
  if (filters.severity) {
    where.severity = Array.isArray(filters.severity) ? { in: filters.severity } : filters.severity;
  }
  if (filters.provider) where.provider = filters.provider;
  if (filters.rcaStatus) where.rcaStatus = filters.rcaStatus;
  if (filters.hasExternalTicket) {
    where.externalTicketRef = { not: "" };
  }
  if (filters.isDisputed) {
    where.externalTicketDisputed = true;
  }

  if (filters.createdAfter || filters.createdBefore) {
    const createdAt: Record<string, Date> = {};
    if (filters.createdAfter) createdAt.gte = filters.createdAfter;
    if (filters.createdBefore) createdAt.lte = filters.createdBefore;
    where.createdAt = createdAt;
  }

  return where;
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId,
        details: JSON.stringify(details),
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", {
      action,
      entityType,
      entityId,
      error: String(err),
    });
  }
}

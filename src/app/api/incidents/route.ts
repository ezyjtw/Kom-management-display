import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { incidentService } from "@/modules/incidents/services/incident-service";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import type { IncidentFilters } from "@/modules/incidents/services/incident-service";

/**
 * GET /api/incidents
 *
 * List incidents with optional filters: ?status=active&provider=Fireblocks
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "incident", "view");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const provider = searchParams.get("provider");

    const filters: IncidentFilters = {};
    if (status) filters.status = status as never;
    if (provider) filters.provider = provider;

    const { incidents } = await incidentService.getIncidents(filters);

    // Fetch linked thread subjects for display
    const allThreadIds = incidents.flatMap((i) => {
      try { return JSON.parse(i.linkedThreadIds) as string[]; } catch { return []; }
    });
    const threads = allThreadIds.length > 0
      ? await prisma.commsThread.findMany({
          where: { id: { in: allThreadIds } },
          select: { id: true, subject: true, status: true, priority: true, clientOrPartnerTag: true },
        })
      : [];
    const threadMap = Object.fromEntries(threads.map((t) => [t.id, t]));

    const data = incidents.map((inc) => {
      let linkedThreads: string[] = [];
      let linkedTransactions: string[] = [];
      try { linkedThreads = JSON.parse(inc.linkedThreadIds); } catch { /* */ }
      try { linkedTransactions = JSON.parse(inc.linkedTransactionIds); } catch { /* */ }

      return {
        ...inc,
        linkedThreads: linkedThreads.map((id) => threadMap[id] || { id, subject: "Unknown thread", status: "Unknown", priority: "P3" }),
        linkedTransactionIds: linkedTransactions,
      };
    });

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "GET /api/incidents");
  }
}

/**
 * POST /api/incidents
 *
 * Create a new 3rd party incident.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "incident", "create");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const body = await request.json();
    const { title, provider, severity, description, impact, linkedThreadIds, linkedTransactionIds } = body;

    if (!title || !provider) {
      return apiValidationError("title and provider are required");
    }

    const validSeverities = ["low", "medium", "high", "critical"];
    if (severity && !validSeverities.includes(severity)) {
      return apiValidationError(`Invalid severity. Must be one of: ${validSeverities.join(", ")}`);
    }
    if (linkedThreadIds && !Array.isArray(linkedThreadIds)) {
      return apiValidationError("linkedThreadIds must be an array");
    }
    if (linkedTransactionIds && !Array.isArray(linkedTransactionIds)) {
      return apiValidationError("linkedTransactionIds must be an array");
    }

    const actorId = auth.employeeId || auth.id;

    const incident = await incidentService.createIncident({
      title,
      provider,
      severity,
      description,
      impact,
      reportedById: actorId,
      linkedThreadIds,
      linkedTransactionIds,
    });

    return apiSuccess(incident, undefined, 201);
  } catch (error) {
    return handleApiError(error, "POST /api/incidents");
  }
}

/**
 * PATCH /api/incidents
 *
 * Update an incident: change status, add update note, link alerts/threads,
 * or resolve.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "incident", "update");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const body = await request.json();
    const {
      id, status, severity, impact, update, updateType,
      linkedThreadIds, linkedTransactionIds, linkAlertIds,
      rcaStatus, rcaDocumentRef, rcaResponsibleId, rcaSlaDeadline,
      rcaFollowUpItems,
      externalTicketRef, externalTicketUrl, externalTicketStatus,
      externalTicketDisputed, externalTicketDisputeReason,
    } = body;

    if (!id) {
      return apiValidationError("id is required");
    }

    const actorId = auth.employeeId || auth.id;

    // Validate enum fields
    const validStatuses = ["active", "monitoring", "resolved"];
    if (status && !validStatuses.includes(status)) {
      return apiValidationError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }
    const validSeverities = ["low", "medium", "high", "critical"];
    if (severity && !validSeverities.includes(severity)) {
      return apiValidationError(`Invalid severity. Must be one of: ${validSeverities.join(", ")}`);
    }
    const validRcaStatuses = ["not_required", "raised", "awaiting_rca", "rca_received", "follow_up_pending", "closed"];
    if (rcaStatus !== undefined && !validRcaStatuses.includes(rcaStatus)) {
      return apiValidationError(`Invalid rcaStatus. Must be one of: ${validRcaStatuses.join(", ")}`);
    }
    if (linkedThreadIds && !Array.isArray(linkedThreadIds)) {
      return apiValidationError("linkedThreadIds must be an array");
    }
    if (linkedTransactionIds && !Array.isArray(linkedTransactionIds)) {
      return apiValidationError("linkedTransactionIds must be an array");
    }

    // Use service for core update (status, severity, impact, linked items)
    const incident = await incidentService.updateIncident(
      id,
      { status, severity, impact, linkedThreadIds, linkedTransactionIds },
      actorId,
    );

    // RCA updates via service
    if (rcaStatus !== undefined) {
      await incidentService.updateRca(id, {
        rcaStatus,
        rcaDocumentRef,
        rcaResponsibleId,
        rcaSlaDeadline: rcaSlaDeadline ? new Date(rcaSlaDeadline) : undefined,
        rcaFollowUpItems,
      }, actorId);
    }

    // External ticket fields (direct update for fields not covered by service methods)
    const ticketFields: Record<string, unknown> = {};
    if (externalTicketRef !== undefined) ticketFields.externalTicketRef = externalTicketRef;
    if (externalTicketUrl !== undefined) ticketFields.externalTicketUrl = externalTicketUrl;
    if (externalTicketStatus !== undefined) ticketFields.externalTicketStatus = externalTicketStatus;
    if (externalTicketDisputed !== undefined) ticketFields.externalTicketDisputed = externalTicketDisputed;
    if (externalTicketDisputeReason !== undefined) ticketFields.externalTicketDisputeReason = externalTicketDisputeReason;
    if (Object.keys(ticketFields).length > 0) {
      await prisma.incident.update({ where: { id }, data: ticketFields });
    }

    // Add update note if provided
    if (update) {
      await incidentService.addUpdate(id, actorId, update, updateType || "update");
    }

    // Link existing alerts to this incident
    if (linkAlertIds && Array.isArray(linkAlertIds) && linkAlertIds.length > 0) {
      await prisma.$transaction(
        linkAlertIds.map((alertId: string) =>
          prisma.alert.update({
            where: { id: alertId },
            data: { incidentId: id },
          }),
        ),
      );
    }

    // Re-fetch for complete response
    const updated = await incidentService.getIncidentById(id);
    return apiSuccess(updated ?? incident);
  } catch (error) {
    return handleApiError(error, "PATCH /api/incidents");
  }
}

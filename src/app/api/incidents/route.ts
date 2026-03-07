import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/incidents
 *
 * List incidents with optional filters: ?status=active&provider=Fireblocks
 * Returns incidents with their updates, linked alerts, and reporter info.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const provider = searchParams.get("provider");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (provider) where.provider = provider;

    const incidents = await prisma.incident.findMany({
      where,
      include: {
        reportedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
        updates: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
        alerts: {
          select: {
            id: true,
            type: true,
            priority: true,
            message: true,
            status: true,
            createdAt: true,
            thread: { select: { id: true, subject: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    });

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

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/incidents
 *
 * Create a new 3rd party incident.
 * Body: { title, provider, severity?, description?, impact?, linkedThreadIds?, linkedTransactionIds? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { title, provider, severity, description, impact, linkedThreadIds, linkedTransactionIds } = body;

    if (!title || !provider) {
      return NextResponse.json(
        { success: false, error: "title and provider are required" },
        { status: 400 },
      );
    }

    const validSeverities = ["low", "medium", "high", "critical"];
    if (severity && !validSeverities.includes(severity)) {
      return NextResponse.json(
        { success: false, error: `Invalid severity. Must be one of: ${validSeverities.join(", ")}` },
        { status: 400 },
      );
    }

    if (linkedThreadIds && !Array.isArray(linkedThreadIds)) {
      return NextResponse.json(
        { success: false, error: "linkedThreadIds must be an array" },
        { status: 400 },
      );
    }

    if (linkedTransactionIds && !Array.isArray(linkedTransactionIds)) {
      return NextResponse.json(
        { success: false, error: "linkedTransactionIds must be an array" },
        { status: 400 },
      );
    }

    const actorId = auth.employeeId || auth.id;

    const incident = await prisma.incident.create({
      data: {
        title,
        provider,
        severity: severity || "medium",
        description: description || "",
        impact: impact || "",
        reportedById: actorId,
        linkedThreadIds: JSON.stringify(linkedThreadIds || []),
        linkedTransactionIds: JSON.stringify(linkedTransactionIds || []),
      },
      include: {
        reportedBy: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "incident_created",
        entityType: "incident",
        entityId: incident.id,
        userId: actorId,
        details: JSON.stringify({ title, provider, severity: severity || "medium" }),
      },
    });

    return NextResponse.json({ success: true, data: incident }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/incidents
 *
 * Update an incident: change status, add update note, link alerts/threads,
 * or resolve.
 *
 * Body: {
 *   id: string,
 *   status?: string,
 *   severity?: string,
 *   impact?: string,
 *   update?: string,        // adds an IncidentUpdate entry
 *   updateType?: string,    // update, escalation, resolution
 *   linkedThreadIds?: string[],
 *   linkedTransactionIds?: string[],
 *   linkAlertIds?: string[],   // link existing alerts to this incident
 * }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, status, severity, impact, update, updateType, linkedThreadIds, linkedTransactionIds, linkAlertIds,
      rcaStatus, rcaDocumentRef, rcaResponsibleId, rcaSlaDeadline, rcaReceivedAt, rcaFollowUpItems, rcaRaisedAt,
      externalTicketRef, externalTicketUrl, externalTicketStatus, externalTicketDisputed, externalTicketDisputeReason } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 },
      );
    }

    const actorId = auth.employeeId || auth.id;

    // Validate enum fields
    const validStatuses = ["active", "monitoring", "resolved"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    const validSeverities = ["low", "medium", "high", "critical"];
    if (severity && !validSeverities.includes(severity)) {
      return NextResponse.json(
        { success: false, error: `Invalid severity. Must be one of: ${validSeverities.join(", ")}` },
        { status: 400 },
      );
    }

    const validRcaStatuses = ["not_required", "raised", "awaiting_rca", "rca_received", "follow_up_pending", "closed"];
    if (rcaStatus !== undefined && !validRcaStatuses.includes(rcaStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid rcaStatus. Must be one of: ${validRcaStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    if (linkedThreadIds && !Array.isArray(linkedThreadIds)) {
      return NextResponse.json(
        { success: false, error: "linkedThreadIds must be an array" },
        { status: 400 },
      );
    }

    if (linkedTransactionIds && !Array.isArray(linkedTransactionIds)) {
      return NextResponse.json(
        { success: false, error: "linkedTransactionIds must be an array" },
        { status: 400 },
      );
    }

    // Build update payload
    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (severity) updateData.severity = severity;
    if (impact !== undefined) updateData.impact = impact;
    if (linkedThreadIds) updateData.linkedThreadIds = JSON.stringify(linkedThreadIds);
    if (linkedTransactionIds) updateData.linkedTransactionIds = JSON.stringify(linkedTransactionIds);

    // RCA tracker fields
    if (rcaStatus !== undefined) updateData.rcaStatus = rcaStatus;
    if (rcaDocumentRef !== undefined) updateData.rcaDocumentRef = rcaDocumentRef;
    if (rcaResponsibleId !== undefined) updateData.rcaResponsibleId = rcaResponsibleId || null;
    if (rcaSlaDeadline !== undefined) updateData.rcaSlaDeadline = rcaSlaDeadline ? new Date(rcaSlaDeadline) : null;
    if (rcaReceivedAt !== undefined) updateData.rcaReceivedAt = rcaReceivedAt ? new Date(rcaReceivedAt) : null;
    if (rcaFollowUpItems !== undefined) updateData.rcaFollowUpItems = JSON.stringify(rcaFollowUpItems);
    if (rcaRaisedAt !== undefined) updateData.rcaRaisedAt = rcaRaisedAt ? new Date(rcaRaisedAt) : null;

    // External ticket fields
    if (externalTicketRef !== undefined) updateData.externalTicketRef = externalTicketRef;
    if (externalTicketUrl !== undefined) updateData.externalTicketUrl = externalTicketUrl;
    if (externalTicketStatus !== undefined) updateData.externalTicketStatus = externalTicketStatus;
    if (externalTicketDisputed !== undefined) updateData.externalTicketDisputed = externalTicketDisputed;
    if (externalTicketDisputeReason !== undefined) updateData.externalTicketDisputeReason = externalTicketDisputeReason;

    // Auto-set resolvedAt and resolvedById when resolving
    if (status === "resolved") {
      updateData.resolvedAt = new Date();
      updateData.resolvedById = actorId;
    }

    const incident = await prisma.incident.update({
      where: { id },
      data: updateData,
      include: {
        reportedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    // Add an update note if provided
    if (update) {
      await prisma.incidentUpdate.create({
        data: {
          incidentId: id,
          authorId: actorId,
          content: update,
          type: updateType || "update",
        },
      });
    }

    // Link existing alerts to this incident
    if (linkAlertIds && Array.isArray(linkAlertIds) && linkAlertIds.length > 0) {
      await prisma.$transaction(
        linkAlertIds.map((alertId: string) =>
          prisma.alert.update({
            where: { id: alertId },
            data: { incidentId: id },
          })
        )
      );
    }

    await prisma.auditLog.create({
      data: {
        action: status === "resolved" ? "incident_resolved" : "incident_updated",
        entityType: "incident",
        entityId: id,
        userId: actorId,
        details: JSON.stringify({
          status,
          severity,
          hasUpdate: !!update,
          linkedAlerts: linkAlertIds?.length || 0,
        }),
      },
    });

    return NextResponse.json({ success: true, data: incident });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

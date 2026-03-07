import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/rca
 * List incidents with RCA tracking (rcaStatus != 'none').
 * Includes external ticket status and dispute history.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const rcaStatus = searchParams.get("rcaStatus");

    const where: Record<string, unknown> = {
      rcaStatus: rcaStatus ? rcaStatus : { not: "none" },
    };

    const incidents = await prisma.incident.findMany({
      where,
      include: {
        reportedBy: { select: { id: true, name: true } },
        rcaResponsible: { select: { id: true, name: true } },
        updates: { orderBy: { createdAt: "desc" }, take: 5 },
        ticketEvents: { orderBy: { createdAt: "desc" }, take: 20 },
      },
      orderBy: { updatedAt: "desc" },
    });

    const now = new Date();
    const data = incidents.map((inc) => {
      let followUpItems: Array<{ title: string; status: string; assigneeId?: string }> = [];
      try { followUpItems = JSON.parse(inc.rcaFollowUpItems); } catch { /* */ }

      const rcaRaisedAt = inc.rcaRaisedAt || inc.createdAt;
      const ageDays = Math.round((now.getTime() - rcaRaisedAt.getTime()) / 86400000);
      const slaOverdue = inc.rcaSlaDeadline ? now > inc.rcaSlaDeadline : false;

      // Count premature closures from ticket events
      const prematureClosures = inc.ticketEvents.filter((e) => e.event === "provider_closed").length;
      const disputeCount = inc.ticketEvents.filter((e) => e.event === "disputed" || e.event === "reopen_requested").length;

      return {
        id: inc.id,
        title: inc.title,
        provider: inc.provider,
        severity: inc.severity,
        status: inc.status,
        description: inc.description,
        impact: inc.impact,
        rcaStatus: inc.rcaStatus,
        rcaDocumentRef: inc.rcaDocumentRef,
        rcaResponsibleId: inc.rcaResponsibleId,
        rcaResponsibleName: inc.rcaResponsible?.name || null,
        rcaSlaDeadline: inc.rcaSlaDeadline,
        rcaReceivedAt: inc.rcaReceivedAt,
        rcaRaisedAt: inc.rcaRaisedAt,
        rcaFollowUpItems: followUpItems,
        ageDays,
        slaOverdue,
        startedAt: inc.startedAt,
        resolvedAt: inc.resolvedAt,
        createdAt: inc.createdAt,
        reportedByName: inc.reportedBy?.name || null,
        updatesCount: inc.updates.length,
        // External ticket tracking
        externalTicketRef: inc.externalTicketRef,
        externalTicketUrl: inc.externalTicketUrl,
        externalTicketStatus: inc.externalTicketStatus,
        externalTicketLastSyncAt: inc.externalTicketLastSyncAt,
        externalTicketDisputed: inc.externalTicketDisputed,
        externalTicketDisputeReason: inc.externalTicketDisputeReason,
        ticketEvents: inc.ticketEvents.map((e) => ({
          id: e.id,
          event: e.event,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          performedBy: e.performedBy,
          reason: e.reason,
          createdAt: e.createdAt,
        })),
        prematureClosures,
        disputeCount,
      };
    });

    const summary = {
      total: data.length,
      awaiting: data.filter((d) => d.rcaStatus === "awaiting_rca").length,
      overdue: data.filter((d) => d.slaOverdue && d.rcaStatus === "awaiting_rca").length,
      followUp: data.filter((d) => d.rcaStatus === "follow_up_pending").length,
      closed: data.filter((d) => d.rcaStatus === "closed").length,
      disputed: data.filter((d) => d.externalTicketDisputed).length,
    };

    return NextResponse.json({ success: true, data: { incidents: data, summary } });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

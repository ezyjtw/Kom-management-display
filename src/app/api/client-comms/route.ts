/**
 * GET /api/client-comms — List client comms drafts
 *
 * Auth: requireAuth + checkAuthorization(client_comms, view)
 * Query params: status (draft|sent|dismissed|all), incidentId
 */
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Auth
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

    const authzResult = requireAuthorization(authResult, "client_comms", "view");
    if (authzResult instanceof NextResponse) return authzResult;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "draft";
    const incidentId = searchParams.get("incidentId");

    const where: Record<string, unknown> = {};
    if (status !== "all") {
      where.status = status;
    }
    if (incidentId) {
      where.incidentId = incidentId;
    }

    const drafts = await prisma.clientCommsDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Group by incident
    const incidentIds = [...new Set(drafts.map((d) => d.incidentId))];
    const incidents = await prisma.incident.findMany({
      where: { id: { in: incidentIds } },
      select: {
        id: true,
        title: true,
        provider: true,
        severity: true,
        status: true,
      },
    });

    const incidentMap = new Map(incidents.map((i) => [i.id, i]));

    const grouped = incidentIds.map((iid) => ({
      incident: incidentMap.get(iid) || { id: iid, title: "Unknown", provider: "", severity: "", status: "" },
      drafts: drafts.filter((d) => d.incidentId === iid),
    }));

    return apiSuccess(grouped);
  } catch (error) {
    return handleApiError(error, "GET /api/client-comms");
  }
}

/**
 * POST /api/client-comms/[id]/dismiss — Dismiss a client comms draft
 *
 * Auth: requireAuth + checkAuthorization(client_comms, update)
 * Body: { reason?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { createAuditEntry } from "@/lib/api/audit";

const dismissSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

    const authzResult = requireAuthorization(authResult, "client_comms", "update");
    if (authzResult instanceof NextResponse) return authzResult;

    const { id } = await params;
    const body = await request.json();

    // Validate
    const validation = validateBody(dismissSchema, body);
    if (!validation.success) {
      return apiValidationError(validation.error);
    }

    // Check draft exists
    const draft = await prisma.clientCommsDraft.findUnique({ where: { id } });
    if (!draft) {
      return apiNotFoundError("Client comms draft");
    }

    // Dismiss
    const updated = await prisma.clientCommsDraft.update({
      where: { id },
      data: { status: "dismissed" },
    });

    // Audit
    await createAuditEntry({
      action: "client_comms_dismissed",
      entityType: "client_comms_draft",
      entityId: id,
      userId: authResult.id,
      summary: `Dismissed client comms draft for ${draft.clientName}`,
      metadata: {
        reason: validation.data.reason,
        incidentId: draft.incidentId,
        clientName: draft.clientName,
      },
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "POST /api/client-comms/[id]/dismiss");
  }
}

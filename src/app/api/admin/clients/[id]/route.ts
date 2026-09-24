import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, updateClientSchema } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";

/**
 * PATCH /api/admin/clients/:id — update a client (admin). When `channels` is
 * given it replaces the client's channel list. Clients are deactivated
 * (isActive=false), never deleted, so work-item history keeps its client.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "client", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const { id } = await params;
    const parsed = validateBody(updateClientSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const { channels, ...fields } = parsed.data;

    const before = await prisma.client.findUnique({ where: { id }, include: { channels: true } });
    if (!before) return apiNotFoundError("Client");

    const actor = auditActor(auth);
    const client = await auditedAction(
      {
        action: "client_updated",
        entityType: "client",
        entityId: id,
        userId: actor.userId,
        summary: `Update client: ${before.displayName}`,
        before: {
          displayName: before.displayName,
          isActive: before.isActive,
          jurisdiction: before.jurisdiction,
          channels: before.channels.map((c) => `${c.kind}:${c.ref}`),
        },
        metadata: actor.metadata,
      },
      async () => prisma.$transaction(async (tx) => {
        if (channels) {
          await tx.clientChannel.deleteMany({ where: { clientId: id } });
          await tx.clientChannel.createMany({ data: channels.map((c) => ({ ...c, clientId: id })) });
        }
        return tx.client.update({ where: { id }, data: fields, include: { channels: true } });
      }),
      (r) => ({
        displayName: r.displayName,
        isActive: r.isActive,
        jurisdiction: r.jurisdiction,
        inboundThresholdUsd: r.inboundThresholdUsd,
        thresholdReviewedAt: r.thresholdReviewedAt,
        channels: r.channels.map((c) => `${c.kind}:${c.ref}`),
      }),
    );

    return apiSuccess(client);
  } catch (error) {
    return handleApiError(error, "admin client PATCH");
  }
}

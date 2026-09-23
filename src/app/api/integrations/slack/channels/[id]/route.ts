import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, apiNotFoundError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { createAuditEntry } from "@/lib/api/audit";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import * as slackChannelRepo from "@/modules/slack/repositories/slack-channel-repository";

// ─── Validation Schema ───

const updateChannelSchema = z.object({
  channelType: z.enum(["client", "service_provider", "internal"]).optional(),
  linkedEntityId: z.string().max(200).nullable().optional(),
  purpose: z.enum(["client", "gx_notifications", "vendor", "internal_ops", "alerts_out"]).optional(),
  clientId: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * PATCH /api/integrations/slack/channels/[id]
 * Update a registered Slack channel. Admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "update");
  if (authz instanceof NextResponse) return authz;

  if (auth.role !== "admin") {
    return apiForbiddenError();
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const validation = validateBody(updateChannelSchema, body);
    if (!validation.success) {
      return apiValidationError(validation.error);
    }

    const existing = await slackChannelRepo.findById(id);
    if (!existing) {
      return apiNotFoundError("Slack channel");
    }

    const before = {
      channelType: existing.channelType,
      linkedEntityId: existing.linkedEntityId,
      isActive: existing.isActive,
      purpose: existing.purpose,
      clientId: existing.clientId,
    };

    const updated = await slackChannelRepo.updateChannel(id, validation.data);

    await createAuditEntry({
      action: "slack_channel_update",
      entityType: "slack_channel",
      entityId: id,
      userId: auth.employeeId ?? "system",
      summary: `Updated Slack channel #${existing.channelName}`,
      before,
      after: {
        channelType: updated.channelType,
        linkedEntityId: updated.linkedEntityId,
        isActive: updated.isActive,
        purpose: updated.purpose,
        clientId: updated.clientId,
      },
      metadata: { actorUserId: auth.id },
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "update slack channel");
  }
}

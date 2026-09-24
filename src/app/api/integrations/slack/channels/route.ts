import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { auditedAction } from "@/lib/api/audit";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import * as slackChannelRepo from "@/modules/slack/repositories/slack-channel-repository";
import { auditActor } from "@/modules/core-data/audit-actor";

// ─── Validation Schemas ───

const registerChannelSchema = z.object({
  channelId: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9]+$/, "channelId must be an uppercase alphanumeric Slack channel ID"),
  channelName: z.string().min(1).max(200),
  channelType: z.enum(["client", "service_provider", "internal"]),
  linkedEntityId: z.string().max(200).optional(),
  purpose: z.enum(["client", "platform_notifications", "vendor", "internal_ops", "alerts_out"]).optional(),
  clientId: z.string().max(100).optional(),
});

/**
 * GET /api/integrations/slack/channels
 * List all registered Slack channels. Admin only.
 */
export async function GET(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "view");
  if (authz instanceof NextResponse) return authz;

  // Only admins can see all registered channels
  if (auth.role !== "admin") {
    return apiForbiddenError();
  }

  try {
    const channels = await slackChannelRepo.findAll();
    return apiSuccess(channels);
  } catch (error) {
    return handleApiError(error, "list slack channels");
  }
}

/**
 * POST /api/integrations/slack/channels
 * Register a new Slack channel. Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "create");
  if (authz instanceof NextResponse) return authz;

  if (auth.role !== "admin") {
    return apiForbiddenError();
  }

  try {
    const body = await request.json();
    const validation = validateBody(registerChannelSchema, body);
    if (!validation.success) {
      return apiValidationError(validation.error);
    }

    const { channelId, channelName, channelType, linkedEntityId, purpose, clientId } = validation.data;

    // Channel-to-client mapping is privileged configuration: fail-closed audit (spec §17.7).
    const actor = auditActor(auth);
    const channel = await auditedAction(
      {
        action: "slack_channel_register",
        entityType: "slack_channel",
        entityId: channelId,
        userId: actor.userId,
        summary: `Register Slack channel #${channelName} (${channelId})`,
        after: { channelId, channelName, channelType, linkedEntityId, purpose, clientId: clientId ?? null },
        metadata: actor.metadata,
      },
      () => slackChannelRepo.upsertChannel({
        channelId,
        channelName,
        channelType,
        linkedEntityId: linkedEntityId ?? null,
        purpose,
        clientId: clientId ?? null,
      }),
      (r) => ({ id: r.id, purpose: r.purpose, clientId: r.clientId }),
    );

    return apiSuccess(channel, undefined, 201);
  } catch (error) {
    return handleApiError(error, "register slack channel");
  }
}

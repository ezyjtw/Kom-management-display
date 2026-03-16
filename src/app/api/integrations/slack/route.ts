import { NextRequest, NextResponse } from "next/server";
import { syncSlackChannel } from "@/lib/integrations/slack";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { z } from "zod";
import { env } from "@/lib/env";

/**
 * POST /api/integrations/slack
 * Trigger a sync of a Slack channel. Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const body = await request.json();
    const _parsed = z.object({}).passthrough().safeParse(body);
    if (!_parsed.success) return apiValidationError(_parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { channelId, queue } = body;

    if (!channelId) {
      return apiValidationError("channelId is required");
    }

    const result = await syncSlackChannel(channelId, queue);

    // Audit: log integration sync
    await prisma.auditLog.create({
      data: {
        action: "integration_sync",
        entityType: "slack_channel",
        entityId: channelId,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          channelId,
          queue: queue || "Transaction Operations",
          threadsSynced: result.threadsSynced,
        }),
      },
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "slack sync");
  }
}

/**
 * GET /api/integrations/slack
 * Get current Slack integration status. Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const configured = !!env("SLACK_BOT_TOKEN");

  return apiSuccess({
    configured,
    channels: env("SLACK_CHANNELS")
      ? env("SLACK_CHANNELS")!.split(",").map((ch) => ch.trim())
      : [],
  });
}

import { NextRequest, NextResponse } from "next/server";
import { syncSlackChannel } from "@/lib/integrations/slack";
import { requireRole, safeErrorMessage } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/integrations/slack
 * Trigger a sync of a Slack channel. Admin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { channelId, queue } = body;

    if (!channelId) {
      return NextResponse.json(
        { success: false, error: "channelId is required" },
        { status: 400 }
      );
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
          queue: queue || "Ops",
          threadsSynced: result.threadsSynced,
        }),
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/slack
 * Get current Slack integration status. Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const configured = !!process.env.SLACK_BOT_TOKEN;

  return NextResponse.json({
    success: true,
    data: {
      configured,
      channels: process.env.SLACK_CHANNELS
        ? process.env.SLACK_CHANNELS.split(",").map((ch) => ch.trim())
        : [],
    },
  });
}

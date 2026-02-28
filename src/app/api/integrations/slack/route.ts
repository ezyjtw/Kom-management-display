import { NextRequest, NextResponse } from "next/server";
import { syncSlackChannel, sendSlackNotification } from "@/lib/integrations/slack";

/**
 * POST /api/integrations/slack
 * Trigger a sync of a Slack channel.
 *
 * Body: { channelId: string, queue?: string }
 */
export async function POST(request: NextRequest) {
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

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/slack
 * Get current Slack integration status.
 */
export async function GET() {
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

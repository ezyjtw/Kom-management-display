/**
 * POST /api/webhooks/slack/interactivity — the Slack message shortcut "Raise
 * incident/risk in KOMmand Centre" (spec §9.7). It only replies with a private
 * deep link to the form; it takes no action in Slack or anywhere else. Every
 * other interaction is ignored (no action buttons exist, H1).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySlackWebhook } from "@/lib/webhook-verify";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getSlackClient } from "@/lib/integrations/slack";

const RAISE_CALLBACK_ID = "raise_incident_risk";

const shortcutSchema = z.object({
  type: z.literal("message_action"),
  callback_id: z.string(),
  channel: z.object({ id: z.string().regex(/^[CGD][A-Z0-9]{6,15}$/) }),
  user: z.object({ id: z.string().regex(/^[UW][A-Z0-9]{6,15}$/) }),
  message: z.object({ ts: z.string().regex(/^\d{9,11}\.\d{1,6}$/) }).passthrough(),
});

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  const ok = await verifySlackWebhook(raw, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"));
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "");
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = shortcutSchema.safeParse(payload);
  if (!parsed.success || parsed.data.callback_id !== RAISE_CALLBACK_ID) return new NextResponse(null, { status: 200 });

  const { channel, user, message } = parsed.data;
  const base = (env("NEXTAUTH_URL") ?? "").replace(/\/+$/, "");
  const link = `${base}/client-incidents/new?kind=slack&channelId=${encodeURIComponent(channel.id)}&ts=${encodeURIComponent(message.ts)}`;
  try {
    await getSlackClient()?.chat.postEphemeral({ channel: channel.id, user: user.id, text: `Open the form in KOMmand Centre to raise an incident or risk from this message: ${link}` });
  } catch (error) {
    logger.warn("Could not post the deep link for the raise shortcut", { error: error instanceof Error ? error.message : String(error) });
  }
  return new NextResponse(null, { status: 200 });
}

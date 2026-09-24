/**
 * POST /api/webhooks/slack — Slack Events API (spec §8.4). Signature verified
 * with the signing secret; events are queued for the worker so Slack gets a
 * fast 200. Push is optional, behind flag slack.events_push (default off):
 * polling every 5 minutes, 24/7, is the required mechanism and the
 * completeness guarantee.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySlackWebhook } from "@/lib/webhook-verify";
import { enqueueJob } from "@/lib/background-jobs";
import { logger } from "@/lib/logger";
import { isFeatureEnabled } from "@/lib/feature-flags";

const envelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url_verification"), challenge: z.string().max(500) }),
  z.object({
    type: z.literal("event_callback"),
    event_id: z.string().max(100),
    event: z.object({
      type: z.string(),
      channel: z.string().max(50).optional(),
      ts: z.string().max(50).optional(),
    }).passthrough(),
  }),
]);

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });

  const ok = await verifySlackWebhook(
    raw,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
  );
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });

  let parsed: z.infer<typeof envelopeSchema>;
  try {
    const result = envelopeSchema.safeParse(JSON.parse(raw));
    if (!result.success) return NextResponse.json({ ok: true, ignored: true });
    parsed = result.data;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (parsed.type === "url_verification") {
    return NextResponse.json({ challenge: parsed.challenge });
  }

  if (!(await isFeatureEnabled("slack.events_push"))) {
    return NextResponse.json({ ok: true, ignored: "push disabled; polling covers this message" });
  }

  if (parsed.event.type !== "message" || !parsed.event.channel || !parsed.event.ts) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await enqueueJob("slack_event", { eventId: parsed.event_id, event: parsed.event }, { deduplicationKey: `slack_event_${parsed.event_id}` });
  } catch (error) {
    logger.error("Failed to queue Slack event", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

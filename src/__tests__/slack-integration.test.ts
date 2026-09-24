/**
 * Slack Events API, purpose routing and outbound alert posts (spec §8.4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

const envVars = vi.hoisted(() => ({ SLACK_SIGNING_SECRET: "test-signing-secret", NODE_ENV: "test" } as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));

const prismaMock = vi.hoisted(() => ({
  sourceRecord: { upsert: vi.fn() },
  backgroundJob: { findFirst: vi.fn(), create: vi.fn() },
  commsThread: { upsert: vi.fn(), findUnique: vi.fn() },
  commsMessage: { upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
// Push delivery is behind slack.events_push (default off); these tests cover it switched on.
const push = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => k === "slack.events_push" && push.on) }));

import { POST } from "@/app/api/webhooks/slack/route";
import { ingestChannelMessage } from "@/modules/slack/services/slack-ingestion-service";
import { buildAlertBlocks } from "@/modules/integrations/slack/alerts-out";

function signedRequest(body: string, secret = "test-signing-secret", ts = Math.floor(Date.now() / 1000)) {
  const sig = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/slack", {
    method: "POST",
    body,
    headers: { "x-slack-request-timestamp": String(ts), "x-slack-signature": sig },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.backgroundJob.findFirst.mockResolvedValue(null);
  prismaMock.backgroundJob.create.mockResolvedValue({ id: "job-1" });
});

describe("Events API endpoint", () => {
  it("answers the URL verification challenge", async () => {
    const res = await POST(signedRequest(JSON.stringify({ type: "url_verification", challenge: "abc" })));
    expect(await res.json()).toEqual({ challenge: "abc" });
  });

  it("rejects a bad signature", async () => {
    const res = await POST(signedRequest(JSON.stringify({ type: "url_verification", challenge: "abc" }), "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp (replay)", async () => {
    const res = await POST(signedRequest("{}", "test-signing-secret", Math.floor(Date.now() / 1000) - 3600));
    expect(res.status).toBe(401);
  });

  it("queues message events for the worker, deduplicated by event id", async () => {
    const body = JSON.stringify({ type: "event_callback", event_id: "Ev1", event: { type: "message", channel: "C0000000001", ts: "1700000000.0001", text: "hi" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(200);
    const job = prismaMock.backgroundJob.create.mock.calls[0][0].data;
    expect(job).toMatchObject({ type: "slack_event", deduplicationKey: "slack_event_Ev1" });
  });

  it("queues nothing while slack.events_push is off (polling covers every message)", async () => {
    push.on = false;
    try {
      const body = JSON.stringify({ type: "event_callback", event_id: "Ev3", event: { type: "message", channel: "C0000000001", ts: "1700000000.0002", text: "hi" } });
      expect(await (await POST(signedRequest(body))).json()).toMatchObject({ ok: true, ignored: "push disabled; polling covers this message" });
      expect(prismaMock.backgroundJob.create).not.toHaveBeenCalled();
    } finally {
      push.on = true;
    }
  });

  it("ignores non-message events", async () => {
    const body = JSON.stringify({ type: "event_callback", event_id: "Ev2", event: { type: "reaction_added" } });
    expect(await (await POST(signedRequest(body))).json()).toMatchObject({ ignored: true });
    expect(prismaMock.backgroundJob.create).not.toHaveBeenCalled();
  });
});

describe("purpose routing", () => {
  const channel = (purpose: string) => ({ id: "sc1", channelId: "C0000000001", channelName: "chan", purpose, clientId: null });

  it("keeps bot messages in gx_notifications channels as raw risk signals", async () => {
    const out = await ingestChannelMessage(channel("gx_notifications"), { ts: "1700000000.1", subtype: "bot_message", bot_id: "B1", text: "Risk: High" });
    expect(out).toBe("risk_signal");
    expect(prismaMock.sourceRecord.upsert.mock.calls[0][0].create).toMatchObject({ source: "slack", kind: "risk_signal_raw" });
  });

  it("still skips channel_join everywhere", async () => {
    expect(await ingestChannelMessage(channel("gx_notifications"), { ts: "1.1", subtype: "channel_join" })).toBe("skipped");
    expect(await ingestChannelMessage(channel("client"), { ts: "1.1", subtype: "channel_join" })).toBe("skipped");
  });

  it("skips bot messages in other channels and never ingests alerts_out", async () => {
    expect(await ingestChannelMessage(channel("client"), { ts: "1.1", subtype: "bot_message" })).toBe("skipped");
    expect(await ingestChannelMessage(channel("alerts_out"), { ts: "1.1", text: "ALR-OES-01" })).toBe("skipped");
    expect(prismaMock.commsThread.upsert).not.toHaveBeenCalled();
  });
});

describe("outbound alert posts", () => {
  it("contain the rule code, work item link and ticket key, and only link buttons", () => {
    const { blocks, text } = buildAlertBlocks(
      { ruleCode: "ALR-OES-01", severity: "critical", message: "Settlement failed", workItemId: "wi-1", ticketKey: "TOPS-9", ticketUrl: "https://komainu.atlassian.net/browse/TOPS-9" },
      "https://kommand.example",
    );
    expect(text).toContain("ALR-OES-01");
    const section = JSON.stringify(blocks[0]);
    expect(section).toContain("TOPS-9");
    const actions = blocks.find((b) => b.type === "actions") as { elements: Array<Record<string, unknown>> };
    expect(actions.elements.map((e) => (e.text as { text: string }).text)).toEqual(["Open in KOMmand Centre", "Open ticket"]);
    for (const el of actions.elements) {
      expect(el.type).toBe("button");
      expect(typeof el.url).toBe("string");
      expect(el).not.toHaveProperty("action_id");
      expect(el).not.toHaveProperty("value");
    }
    expect(JSON.stringify(blocks)).not.toMatch(/approve|reject/i);
  });
});

/**
 * Microsoft Graph mail/Teams (spec §8.5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const envVars = vi.hoisted(() => ({
  GRAPH_TENANT_ID: "tenant-1",
  GRAPH_CLIENT_ID: "client",
  GRAPH_CLIENT_SECRET: "secret",
  GRAPH_MAILBOXES: JSON.stringify([{ label: "custody", address: "custody@example.com", purpose: "custody" }]),
} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
vi.mock("@/lib/http/allowed-hosts", () => ({ getAllowedHosts: () => new Set(["graph.microsoft.com", "login.microsoftonline.com"]) }));

const prismaMock = vi.hoisted(() => ({
  sourceRecord: { count: vi.fn(), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
  appSetting: { findUnique: vi.fn().mockResolvedValue(null) },
  sourceHeartbeat: { findUnique: vi.fn(), upsert: vi.fn() },
  commsThread: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  commsMessage: { create: vi.fn() },
  workItem: { findFirst: vi.fn(), upsert: vi.fn() },
  syncCursor: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { CircuitBreaker } from "@/lib/circuit-breaker";
import { assertGraphPermitted, GraphForbiddenError, getMailboxes } from "@/lib/integrations/graph/client";
import { parseVendorEmail, type VendorParser } from "@/modules/integrations/graph/vendor-parsers";
import { syncMailbox } from "@/modules/integrations/graph/sync";

beforeEach(() => {
  vi.clearAllMocks();
  CircuitBreaker.resetAll();
  prismaMock.sourceRecord.findMany.mockResolvedValue([]);
  prismaMock.appSetting.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("read-only allowlist", () => {
  it("permits only GET on listed paths on graph.microsoft.com", () => {
    expect(() => assertGraphPermitted("GET", "/v1.0/users/a%40b.com/mailFolders/inbox/messages")).not.toThrow();
    for (const [m, p] of [
      ["POST", "/v1.0/users/a/sendMail"],
      ["GET", "/v1.0/users/a/messages"],
      ["DELETE", "/v1.0/users/a/mailFolders/inbox/messages"],
      ["GET", "https://evil.example.com/v1.0/users/a/mailFolders/inbox/messages"],
    ] as const) {
      expect(() => assertGraphPermitted(m, p), `${m} ${p}`).toThrow(GraphForbiddenError);
    }
  });

  it("validates GRAPH_MAILBOXES", () => {
    expect(getMailboxes()).toEqual([{ label: "custody", address: "custody@example.com", purpose: "custody" }]);
  });
});

describe("vendor parsing (synthetic fixture, CONFIRM-VENDOR-FORMATS)", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/synthetic/CONFIRM-VENDOR-FORMATS.json"), "utf8"));
  const parser: VendorParser = {
    vendor: fixture.parser.vendor,
    senderDomains: fixture.parser.senderDomains,
    keyPattern: new RegExp(fixture.parser.keyPattern),
    statusPattern: new RegExp(fixture.parser.statusPattern),
  };

  it("extracts the vendor key and status", () => {
    expect(parseVendorEmail(fixture.email, [parser])).toEqual({ vendor: "ExampleVendor", vendorKey: "VSD-1234", status: "Waiting for customer" });
  });

  it("ignores senders with no registered parser (none are registered by default)", () => {
    expect(parseVendorEmail(fixture.email)).toBeNull();
  });
});

describe("custody mailbox sync", () => {
  it("creates one thread per conversation and skips already-ingested messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = new URL(input.toString());
      if (url.host === "login.microsoftonline.com") return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      expect(url.pathname).toBe("/v1.0/users/custody%40example.com/mailFolders/inbox/messages/delta");
      return new Response(JSON.stringify({
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/users/custody%40example.com/mailFolders/inbox/messages/delta?$deltatoken=t1",
        value: [
          { id: "m1", internetMessageId: "<m1@x>", conversationId: "conv-1", subject: "Withdrawal query", receivedDateTime: "2026-09-23T09:00:00Z", from: { emailAddress: { address: "client@example.org" } }, bodyPreview: "hello" },
          { id: "m2", internetMessageId: "<m2@x>", conversationId: "conv-1", subject: "RE: Withdrawal query", receivedDateTime: "2026-09-23T09:05:00Z", from: { emailAddress: { address: "client@example.org" } }, bodyPreview: "again" },
        ],
      }));
    }));
    prismaMock.sourceHeartbeat.findUnique.mockResolvedValue(null);
    prismaMock.sourceRecord.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prismaMock.commsThread.findFirst.mockResolvedValue(null);
    prismaMock.commsThread.create.mockResolvedValue({ id: "t1" });

    prismaMock.syncCursor.findUnique.mockResolvedValue(null);

    const result = await syncMailbox({ label: "custody", address: "custody@example.com", purpose: "custody" }, { now: new Date("2026-09-23T10:00:00Z") });
    expect(result).toMatchObject({ fetched: 2, ingested: 1 });
    expect(prismaMock.commsThread.create.mock.calls[0][0].data.sourceThreadRef).toBe("graph-conv-1");
    expect(prismaMock.sourceHeartbeat.upsert.mock.calls[0][0].where.source).toBe("outlook.custody");
    expect(prismaMock.syncCursor.upsert.mock.calls[0][0].create).toMatchObject({ source: "outlook.custody.inbox", cursor: expect.stringContaining("$deltatoken=t1") });
  });
});

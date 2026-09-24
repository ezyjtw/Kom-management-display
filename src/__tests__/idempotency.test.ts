/**
 * At-most-once mutations (Phase 12k, review remediation). The middleware
 * refuses a duplicate submission (same user, method, path and body within
 * 10 s) and a repeated Idempotency-Key, using an atomic claim in PostgreSQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const store = vi.hoisted(() => ({ keys: new Map<string, { requestHash: string; expiresAt: Date }>(), fail: false }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    // Emulates the INSERT ... ON CONFLICT DO UPDATE ... WHERE expired RETURNING statement.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, key: string, requestHash: string, now: Date, expiresAt: Date) => {
      if (store.fail) throw new Error("connection refused");
      const existing = store.keys.get(key);
      if (existing && existing.expiresAt > now) return [];
      store.keys.set(key, { requestHash, expiresAt });
      return [{ key }];
    }),
    idempotencyKey: { findUnique: vi.fn(async ({ where }: { where: { key: string } }) => store.keys.get(where.key) ?? null) },
  },
}));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => ({ role: "lead", sub: "u-ann", authTime: Math.floor(Date.now() / 1000) })) }));

import { middleware } from "@/middleware";
import { claimKey, DUPLICATE_WINDOW_SECONDS } from "@/lib/idempotency";

const BASE = "http://localhost:3000";
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { origin: BASE, cookie: "kom.csrf=t", "x-csrf-token": "t", "content-type": "application/json", ...headers } });

beforeEach(() => { store.keys.clear(); store.fail = false; });

describe("idempotency (middleware)", () => {
  it("refuses an identical submission within the window, allows a different one", async () => {
    expect((await middleware(post("/api/work-items/w1/notes", { text: "checked" }))).status).toBe(200);
    const dup = await middleware(post("/api/work-items/w1/notes", { text: "checked" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("DUPLICATE_REQUEST");
    expect(dup.headers.get("retry-after")).toBe(String(DUPLICATE_WINDOW_SECONDS));
    expect((await middleware(post("/api/work-items/w1/notes", { text: "different" }))).status).toBe(200);
    expect((await middleware(post("/api/work-items/w2/notes", { text: "checked" }))).status).toBe(200);
  });

  it("accepts an explicit Idempotency-Key once, refuses it reused, and refuses it for another body", async () => {
    const h = { "idempotency-key": "retry-key-0001" };
    expect((await middleware(post("/api/client-incidents", { a: 1 }, h))).status).toBe(200);
    expect((await middleware(post("/api/client-incidents", { a: 1 }, h))).status).toBe(409);
    const reused = await middleware(post("/api/client-incidents", { a: 2 }, h));
    expect(reused.status).toBe(422);
    expect((await reused.json()).code).toBe("IDEMPOTENCY_KEY_REUSED");
    const bad = await middleware(post("/api/client-incidents", { a: 1 }, { "idempotency-key": "short" }));
    expect(bad.status).toBe(400);
  });

  it("does not deduplicate webhooks, sign-in or GET requests", async () => {
    for (let i = 0; i < 2; i++) expect((await middleware(post("/api/webhooks/jira", { e: 1 }))).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await middleware(new NextRequest(`${BASE}/api/work-items`))).status).toBe(200);
  });

  it("continues (logged) if the key store is unreachable: the mutation needs the same database", async () => {
    store.fail = true;
    expect((await middleware(post("/api/work-items/w1/notes", { text: "x" }))).status).toBe(200);
  });

  it("a claim expires, so the same request is accepted again after the window", async () => {
    const t0 = new Date("2026-09-24T10:00:00Z");
    expect(await claimKey("w:abc", "h1", 10, t0)).toBe("claimed");
    expect(await claimKey("w:abc", "h1", 10, new Date(t0.getTime() + 5_000))).toBe("duplicate");
    expect(await claimKey("w:abc", "h1", 10, new Date(t0.getTime() + 11_000))).toBe("claimed");
  });
});

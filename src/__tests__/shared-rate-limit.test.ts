/** Spec §17.4: shared (database) rate limits per user and per IP; client-supplied X-Forwarded-For is not trusted. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});

import { checkSharedRateLimit, SHARED_LIMITS } from "@/lib/api/shared-rate-limit";
import { clientIp } from "@/lib/api/client-ip";

const req = (xff: string) => new NextRequest("http://localhost/api/search", { headers: { "x-forwarded-for": xff } });

beforeEach(() => db.client.__reset());

describe("shared rate limit", () => {
  it("blocks a user over the limit within the window and resets after it", async () => {
    const t0 = new Date("2026-09-24T10:00:00Z");
    for (let i = 0; i < SHARED_LIMITS.search.limit; i++) expect(await checkSharedRateLimit(req(`10.0.0.${i % 200}, 1.2.3.4`), "search", "u1", t0)).toBeNull();
    const blocked = await checkSharedRateLimit(req("9.9.9.9, 5.6.7.8"), "search", "u1", t0);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBe("60");
    expect(await checkSharedRateLimit(req("9.9.9.9, 5.6.7.8"), "search", "u1", new Date(t0.getTime() + 61_000))).toBeNull();
  });

  it("limits per IP across users", async () => {
    const t0 = new Date("2026-09-24T10:00:00Z");
    for (let i = 0; i < SHARED_LIMITS.export.limit; i++) expect(await checkSharedRateLimit(req("1.2.3.4"), "export", `user-${i}`, t0)).toBeNull();
    expect((await checkSharedRateLimit(req("1.2.3.4"), "export", "user-new", t0))?.status).toBe(429);
  });

  it("takes the IP the trusted proxy saw, not the client-supplied left end", () => {
    expect(clientIp({ headers: new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }) }, 1)).toBe("203.0.113.9");
    expect(clientIp({ headers: new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.1" }) }, 2)).toBe("203.0.113.9");
    expect(clientIp({ headers: new Headers() }, 1)).toBe("unknown");
  });
});

describe("shared login limit", () => {
  it("locks an account after 5 attempts across instances, case-insensitively, and resets on success", async () => {
    const { checkSharedLoginLimit, resetSharedLoginLimit } = await import("@/lib/api/shared-rate-limit");
    const t0 = new Date("2026-09-24T10:00:00Z");
    for (let i = 0; i < 5; i++) expect((await checkSharedLoginLimit(i % 2 ? "Ann@K.com" : "ann@k.com", t0)).allowed).toBe(true);
    const locked = await checkSharedLoginLimit("ann@k.com", t0);
    expect(locked).toEqual({ allowed: false, retryAfterSeconds: 900 });
    expect((await checkSharedLoginLimit("bob@k.com", t0)).allowed).toBe(true);
    // No email address is stored in the bucket key.
    const keys = (await db.client.rateLimitBucket.findMany({})).map((b) => String(b.key));
    expect(keys.some((k) => k.includes("@"))).toBe(false);
    await resetSharedLoginLimit("ann@k.com");
    expect((await checkSharedLoginLimit("ann@k.com", t0)).allowed).toBe(true);
  });
});

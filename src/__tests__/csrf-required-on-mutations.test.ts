/**
 * CSRF (spec §17.4): every state-changing request needs the double-submit
 * token (cookie + header) and a same-site Origin/Referer, except signed
 * webhooks, the cron trigger and the NextAuth flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";

const BASE = "http://localhost:3000";

function req(path: string, method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(path, BASE), { method, headers });
}

beforeEach(() => {
  vi.mocked(getToken).mockResolvedValue({ role: "employee", sub: "u1", iat: Math.floor(Date.now() / 1000) } as never);
});

describe("csrf-required-on-mutations", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    it(`${method} without a token is rejected`, async () => {
      const res = await middleware(req("/api/work-items/x", method, { origin: BASE }));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("CSRF_TOKEN_INVALID");
    });
  }

  it("rejects a header that does not match the cookie", async () => {
    const res = await middleware(req("/api/work-items/x", "POST", { origin: BASE, cookie: "kom.csrf=aaaa", "x-csrf-token": "bbbb" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF_TOKEN_INVALID");
  });

  it("rejects a cookie with no header (a cross-site form post)", async () => {
    const res = await middleware(req("/api/work-items/x", "POST", { origin: BASE, cookie: "kom.csrf=aaaa" }));
    expect(res.status).toBe(403);
  });

  it("rejects a matching token from a foreign origin", async () => {
    const res = await middleware(req("/api/work-items/x", "POST", { origin: "https://evil.example", cookie: "kom.csrf=aaaa", "x-csrf-token": "aaaa" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF_REJECTED");
  });

  it("passes a same-origin request with a matching token", async () => {
    const res = await middleware(req("/api/work-items/x", "POST", { origin: BASE, cookie: "kom.csrf=aaaa", "x-csrf-token": "aaaa" }));
    expect(res.status).toBe(200);
  });

  it("does not require a token for GET", async () => {
    const res = await middleware(req("/api/work-items", "GET"));
    expect(res.status).toBe(200);
  });

  it("exempts signed webhooks (verified in the route)", async () => {
    for (const path of ["/api/webhooks/slack", "/api/webhooks/jira"]) {
      const res = await middleware(req(path, "POST"));
      expect(res.status).toBe(200);
    }
  });

  it("exempts the NextAuth flow", async () => {
    const res = await middleware(req("/api/auth/signout", "POST", { origin: BASE }));
    expect(res.status).toBe(200);
  });

  it("issues a CSRF cookie when the browser has none", async () => {
    const res = await middleware(req("/work", "GET"));
    expect(res.cookies.get("kom.csrf")?.value).toMatch(/^[0-9a-f]{64}$/);
  });
});

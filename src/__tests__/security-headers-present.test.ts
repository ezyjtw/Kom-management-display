/**
 * Security headers (spec §17.4): a nonce-based CSP with no inline or eval
 * script, plus the fixed headers, on pages and API responses alike.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { middleware } from "@/middleware";
import { buildCsp } from "@/lib/security-policy";

const BASE = "http://localhost:3000";
const nextConfig = require("../../next.config.js");

beforeEach(() => {
  vi.mocked(getToken).mockResolvedValue({ role: "employee", sub: "u1", iat: Math.floor(Date.now() / 1000) } as never);
});
afterEach(() => vi.unstubAllEnvs());

function scriptSrc(csp: string): string {
  return csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
}

describe("security-headers-present", () => {
  it("production CSP uses a nonce and allows no inline or eval script", () => {
    const csp = buildCsp("abc123", false);
    const script = scriptSrc(csp);
    expect(script).toContain("'nonce-abc123'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  for (const path of ["/work", "/api/work-items", "/login"]) {
    it(`sets the headers on ${path}`, async () => {
      const res = await middleware(new NextRequest(new URL(path, BASE)));
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(scriptSrc(csp)).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("none");
    });
  }

  it("uses a fresh nonce per request", async () => {
    const a = await middleware(new NextRequest(new URL("/work", BASE)));
    const b = await middleware(new NextRequest(new URL("/work", BASE)));
    expect(a.headers.get("content-security-policy")).not.toBe(b.headers.get("content-security-policy"));
  });

  it("sets HSTS on HTTPS", async () => {
    const res = await middleware(new NextRequest(new URL("/work", BASE), { headers: { "x-forwarded-proto": "https" } }));
    expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("adds headers to denied responses too", async () => {
    vi.mocked(getToken).mockResolvedValue(null as never);
    const res = await middleware(new NextRequest(new URL("/api/work-items", BASE)));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("next.config hides X-Powered-By and sets the fixed headers for static assets", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const [{ headers }] = await nextConfig.headers();
    const byKey = Object.fromEntries(headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Referrer-Policy"]).toBe("same-origin");
    expect(byKey["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(byKey["Content-Security-Policy"]).toBeUndefined(); // the nonce CSP is per-request, in middleware
  });
});

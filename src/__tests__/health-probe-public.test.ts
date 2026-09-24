/**
 * Regression (Phase 12i): platform health checks (Railway's healthcheckPath,
 * the compose healthcheck, external monitors) probe GET /api/health without a
 * session. 12a put it behind authentication (401) and deploys failed their
 * health check. Basic health is public again; deep health still needs a session.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));

import { middleware } from "@/middleware";

describe("health probes reach the app without a session", () => {
  for (const path of ["/api/health", "/api/health/liveness", "/api/health/readiness"]) {
    it(`GET ${path} passes the middleware`, async () => {
      const res = await middleware(new NextRequest(`http://localhost:3000${path}`));
      expect(res.status).toBe(200); // passed through to the route
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    });
  }

  it("other API routes still need a session", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/api/health/dependencies"));
    expect(res.status).toBe(401);
  });

  it("the route itself refuses deep health without a session", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/app/api/health/route.ts", "utf8");
    expect(src).toMatch(/if \(deep\) \{\s*const auth = await requireAuth\(\);/);
    expect(src).not.toMatch(/details: error instanceof Error \? error\.message/);
  });
});

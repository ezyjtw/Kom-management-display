/**
 * Security policy the middleware applies (spec §17.4). Behavioural tests live
 * in csrf-required-on-mutations and security-headers-present.
 */
import { describe, it, expect } from "vitest";
import { CSRF_EXEMPT_PATHS, isPublicPath } from "@/lib/security-policy";
import { SESSION_IDLE_SECONDS, SESSION_MAX_AGE_SECONDS } from "@/lib/session-config";

describe("Middleware Security", () => {
  it("exempts only the NextAuth flow, signed webhooks and the cron trigger from CSRF", () => {
    expect([...CSRF_EXEMPT_PATHS].sort()).toEqual(
      ["/api/alerts/generate", "/api/auth/", "/api/webhooks/jira", "/api/webhooks/slack"].sort(),
    );
  });

  it("keeps the public surface to sign-in, health probes and GET branding", () => {
    expect(isPublicPath("/login", "GET")).toBe(true);
    expect(isPublicPath("/api/auth/session", "GET")).toBe(true);
    expect(isPublicPath("/api/health/liveness", "GET")).toBe(true);
    expect(isPublicPath("/api/health/readiness", "GET")).toBe(true);
    expect(isPublicPath("/api/branding", "GET")).toBe(true);
    expect(isPublicPath("/api/branding", "POST")).toBe(false);
    expect(isPublicPath("/api/health", "GET")).toBe(false); // detailed health needs a session
    expect(isPublicPath("/work", "GET")).toBe(false);
    expect(isPublicPath("/api/users", "GET")).toBe(false);
  });

  it("uses a 1 h idle timeout and a 12 h absolute lifetime", () => {
    expect(SESSION_IDLE_SECONDS).toBe(3600);
    expect(SESSION_MAX_AGE_SECONDS).toBe(12 * 3600);
  });
});

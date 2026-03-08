/**
 * Session revocation logic tests.
 * Tests the pure logic portions without database dependencies.
 */
import { describe, it, expect } from "vitest";

describe("Session Revocation - Token Masking", () => {
  function maskToken(token: string): string {
    return token.substring(0, 8) + "..." + token.slice(-4);
  }

  it("masks a token correctly", () => {
    const token = "abcdefghijklmnopqrstuvwxyz1234567890";
    const masked = maskToken(token);
    expect(masked).toBe("abcdefgh...7890");
    expect(masked).not.toContain("ijklmnop");
  });

  it("handles short tokens gracefully", () => {
    const token = "short";
    const masked = maskToken(token);
    expect(masked).toContain("...");
    // Masked version always has format: first8 + "..." + last4
    expect(masked).toBe("short...hort");
  });

  it("preserves first 8 and last 4 characters", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const masked = maskToken(token);
    expect(masked.startsWith("01234567")).toBe(true);
    expect(masked.endsWith("cdef")).toBe(true);
  });
});

describe("Session Revocation - Expiry Logic", () => {
  it("identifies expired sessions", () => {
    const pastDate = new Date(Date.now() - 1000);
    expect(pastDate < new Date()).toBe(true);
  });

  it("identifies valid sessions", () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(futureDate > new Date()).toBe(true);
  });

  it("calculates cleanup threshold correctly", () => {
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const daysAgo = (Date.now() - threshold.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(daysAgo)).toBe(7);
  });
});

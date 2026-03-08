import { describe, it, expect } from "vitest";
import { checkLoginRateLimit, resetLoginRateLimit } from "@/lib/rate-limit";

describe("checkLoginRateLimit", () => {
  it("allows first attempt", () => {
    const id = `test-${Date.now()}-1`;
    const result = checkLoginRateLimit(id);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(4);
  });

  it("allows up to 5 attempts", () => {
    const id = `test-${Date.now()}-2`;
    for (let i = 0; i < 5; i++) {
      const result = checkLoginRateLimit(id);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks after 5 attempts", () => {
    const id = `test-${Date.now()}-3`;
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit(id);
    }
    const result = checkLoginRateLimit(id);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after resetLoginRateLimit", () => {
    const id = `test-${Date.now()}-4`;
    for (let i = 0; i < 5; i++) {
      checkLoginRateLimit(id);
    }
    resetLoginRateLimit(id);
    const result = checkLoginRateLimit(id);
    expect(result.allowed).toBe(true);
  });
});

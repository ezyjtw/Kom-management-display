/**
 * Circuit Breaker tests.
 * Tests state transitions, failure counting, timeouts, and recovery.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker, CircuitBreakerError } from "@/lib/circuit-breaker";

describe("Circuit Breaker", () => {
  beforeEach(() => {
    CircuitBreaker.resetAll();
  });

  it("starts in closed state", () => {
    const breaker = new CircuitBreaker({ name: "test", failureThreshold: 3 });
    expect(breaker.getState()).toBe("closed");
  });

  it("passes through successful calls in closed state", async () => {
    const breaker = new CircuitBreaker({ name: "test", failureThreshold: 3 });
    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
    expect(breaker.getState()).toBe("closed");
  });

  it("opens after reaching failure threshold", async () => {
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      failureWindowMs: 60_000,
      cooldownMs: 30_000,
    });

    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    expect(breaker.getState()).toBe("open");
  });

  it("rejects immediately when open", async () => {
    const breaker = new CircuitBreaker({
      name: "test-reject",
      failureThreshold: 1,
      cooldownMs: 60_000,
    });

    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* trigger open */ }

    expect(breaker.getState()).toBe("open");

    await expect(
      breaker.execute(() => Promise.resolve("should not run")),
    ).rejects.toThrow(CircuitBreakerError);
  });

  it("transitions to half_open after cooldown", async () => {
    const breaker = new CircuitBreaker({
      name: "test-halfopen",
      failureThreshold: 1,
      cooldownMs: 1, // 1ms cooldown for testing
    });

    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* trigger open */ }

    expect(breaker.getState()).toBe("open");

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Next call should be allowed (half_open probe)
    const result = await breaker.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });

  it("re-opens if half_open probe fails", async () => {
    const breaker = new CircuitBreaker({
      name: "test-reopen",
      failureThreshold: 1,
      cooldownMs: 1,
    });

    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* trigger open */ }

    await new Promise((resolve) => setTimeout(resolve, 10));

    try {
      await breaker.execute(() => Promise.reject(new Error("still failing")));
    } catch { /* expected */ }

    expect(breaker.getState()).toBe("open");
  });

  it("can be manually reset", async () => {
    const breaker = new CircuitBreaker({
      name: "test-reset",
      failureThreshold: 1,
      cooldownMs: 60_000,
    });

    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* trigger open */ }

    expect(breaker.getState()).toBe("open");
    breaker.reset();
    expect(breaker.getState()).toBe("closed");
  });

  it("provides status information", async () => {
    const breaker = new CircuitBreaker({
      name: "test-status",
      failureThreshold: 5,
    });

    await breaker.execute(() => Promise.resolve("ok"));
    try {
      await breaker.execute(() => Promise.reject(new Error("oops")));
    } catch { /* expected */ }

    const status = breaker.getStatus();
    expect(status.name).toBe("test-status");
    expect(status.state).toBe("closed");
    expect(status.totalCalls).toBe(2);
    expect(status.totalFailures).toBe(1);
    expect(status.successCount).toBe(1);
    expect(status.failureThreshold).toBe(5);
  });

  it("singleton factory returns same instance", () => {
    const a = CircuitBreaker.for("singleton-test");
    const b = CircuitBreaker.for("singleton-test");
    expect(a).toBe(b);
  });

  it("times out long-running calls", async () => {
    const breaker = new CircuitBreaker({
      name: "test-timeout",
      failureThreshold: 5,
      callTimeoutMs: 50,
    });

    await expect(
      breaker.execute(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      ),
    ).rejects.toThrow("timed out");
  });

  it("does not count old failures outside the window", async () => {
    const breaker = new CircuitBreaker({
      name: "test-window",
      failureThreshold: 3,
      failureWindowMs: 50, // 50ms window
    });

    // Generate 2 failures
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(() => Promise.reject(new Error("fail")));
      } catch { /* expected */ }
    }

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // This failure should not trip the breaker (old failures expired)
    try {
      await breaker.execute(() => Promise.reject(new Error("fail")));
    } catch { /* expected */ }

    expect(breaker.getState()).toBe("closed");
  });

  it("getAllStatus returns all registered breakers", () => {
    CircuitBreaker.for("service-a");
    CircuitBreaker.for("service-b");

    const all = CircuitBreaker.getAllStatus();
    expect(Object.keys(all)).toContain("service-a");
    expect(Object.keys(all)).toContain("service-b");
  });
});

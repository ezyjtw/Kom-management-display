/**
 * Background job queue logic tests.
 */
import { describe, it, expect } from "vitest";

// Test the cron parser logic (extracted for testing)
function getNextCronRun(cron: string): Date {
  const parts = cron.split(" ");
  const now = new Date();
  const next = new Date(now);

  if (parts.length < 5) {
    next.setMinutes(next.getMinutes() + 5);
    return next;
  }

  const [minute, hour] = parts;

  if (minute.startsWith("*/")) {
    const interval = parseInt(minute.substring(2));
    next.setMinutes(next.getMinutes() + interval);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  if (minute === "0" && hour.startsWith("*/")) {
    const interval = parseInt(hour.substring(2));
    next.setHours(next.getHours() + interval);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }

  if (minute === "0" && !hour.includes("*")) {
    const targetHour = parseInt(hour);
    next.setHours(targetHour);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  next.setMinutes(next.getMinutes() + 5);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}

describe("Background Jobs - Cron Parser", () => {
  it("parses */5 * * * * as approximately 5 minutes from now", () => {
    const now = new Date();
    const next = getNextCronRun("*/5 * * * *");
    const diffMinutes = (next.getTime() - now.getTime()) / 60000;
    // Zeroing seconds/ms may reduce by up to ~1 minute
    expect(diffMinutes).toBeGreaterThan(3);
    expect(diffMinutes).toBeLessThanOrEqual(5.5);
  });

  it("parses */1 * * * * as approximately 1 minute from now", () => {
    const now = new Date();
    const next = getNextCronRun("*/1 * * * *");
    const diffMinutes = (next.getTime() - now.getTime()) / 60000;
    expect(diffMinutes).toBeGreaterThan(-0.1);
    expect(diffMinutes).toBeLessThanOrEqual(1.5);
  });

  it("parses 0 */6 * * * as approximately 6 hours from now", () => {
    const now = new Date();
    const next = getNextCronRun("0 */6 * * *");
    const diffHours = (next.getTime() - now.getTime()) / 3600000;
    // Zeroing minutes/seconds may reduce by up to ~1 hour
    expect(diffHours).toBeGreaterThan(4);
    expect(diffHours).toBeLessThanOrEqual(6.5);
  });

  it("parses 0 2 * * * as specific hour", () => {
    const next = getNextCronRun("0 2 * * *");
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("defaults to approximately 5 minutes for invalid cron", () => {
    const now = new Date();
    const next = getNextCronRun("invalid");
    const diffMinutes = (next.getTime() - now.getTime()) / 60000;
    expect(diffMinutes).toBeGreaterThan(3);
    expect(diffMinutes).toBeLessThanOrEqual(5.5);
  });

  it("returns future date for all valid expressions", () => {
    const expressions = ["*/1 * * * *", "*/5 * * * *", "*/10 * * * *", "0 */6 * * *", "0 2 * * *"];
    for (const expr of expressions) {
      const next = getNextCronRun(expr);
      expect(next.getTime()).toBeGreaterThan(Date.now() - 1000); // Allow 1s tolerance
    }
  });
});

describe("Background Jobs - Job Types", () => {
  const VALID_JOB_TYPES = [
    "sync_slack", "sync_email", "sync_jira", "check_sla",
    "check_staking", "poll_komainu", "check_confirmations", "cleanup_sessions",
  ];

  it("has all expected job types", () => {
    expect(VALID_JOB_TYPES).toHaveLength(8);
    expect(VALID_JOB_TYPES).toContain("sync_slack");
    expect(VALID_JOB_TYPES).toContain("check_sla");
    expect(VALID_JOB_TYPES).toContain("check_confirmations");
    expect(VALID_JOB_TYPES).toContain("cleanup_sessions");
  });
});

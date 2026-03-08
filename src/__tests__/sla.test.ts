import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeSlaStatus,
  computeTtoDeadline,
  computeTtfaDeadline,
  formatSlaRemaining,
  isExcessiveBouncing,
  computeTravelRuleAging,
  DEFAULT_SLA_THRESHOLDS,
} from "@/lib/sla";

describe("computeSlaStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects TTO breach for unassigned P0 thread after 10 minutes", () => {
    const now = new Date("2026-03-08T10:10:00Z");
    vi.setSystemTime(now);

    const result = computeSlaStatus({
      createdAt: new Date("2026-03-08T10:00:00Z"),
      ownerUserId: null,
      lastActionAt: null,
      status: "Unassigned",
      priority: "P0",
    });

    expect(result.isTtoBreached).toBe(true);
    expect(result.ttoRemaining).toBeLessThan(0);
  });

  it("does not flag TTO breach within threshold", () => {
    const now = new Date("2026-03-08T10:03:00Z");
    vi.setSystemTime(now);

    const result = computeSlaStatus({
      createdAt: new Date("2026-03-08T10:00:00Z"),
      ownerUserId: null,
      lastActionAt: null,
      status: "Unassigned",
      priority: "P0",
    });

    expect(result.isTtoBreached).toBe(false);
    expect(result.ttoRemaining).toBeGreaterThan(0);
  });

  it("does not compute TTO for assigned threads", () => {
    const now = new Date("2026-03-08T12:00:00Z");
    vi.setSystemTime(now);

    const result = computeSlaStatus({
      createdAt: new Date("2026-03-08T10:00:00Z"),
      ownerUserId: "user-1",
      lastActionAt: null,
      status: "Assigned",
      priority: "P0",
    });

    expect(result.ttoRemaining).toBeNull();
    expect(result.isTtoBreached).toBe(false);
  });

  it("detects TSLA breach for InProgress thread", () => {
    const now = new Date("2026-03-08T15:00:00Z");
    vi.setSystemTime(now);

    const result = computeSlaStatus({
      createdAt: new Date("2026-03-08T10:00:00Z"),
      ownerUserId: "user-1",
      lastActionAt: new Date("2026-03-08T12:00:00Z"), // 3 hours ago
      status: "InProgress",
      priority: "P2",
    });

    // InProgress TSLA threshold is 120 min (2h), 3h elapsed → breached
    expect(result.isTslaBreached).toBe(true);
  });

  it("uses WaitingExternal TSLA threshold (8h) for that status", () => {
    const now = new Date("2026-03-08T17:00:00Z");
    vi.setSystemTime(now);

    const result = computeSlaStatus({
      createdAt: new Date("2026-03-08T10:00:00Z"),
      ownerUserId: "user-1",
      lastActionAt: new Date("2026-03-08T12:00:00Z"), // 5h ago
      status: "WaitingExternal",
      priority: "P2",
    });

    // WaitingExternal TSLA is 480 min (8h), only 5h elapsed → not breached
    expect(result.isTslaBreached).toBe(false);
  });

  it("does not compute TSLA for Done threads", () => {
    const now = new Date("2026-03-08T23:00:00Z");
    vi.setSystemTime(now);

    const result = computeSlaStatus({
      createdAt: new Date("2026-03-08T10:00:00Z"),
      ownerUserId: "user-1",
      lastActionAt: new Date("2026-03-08T12:00:00Z"),
      status: "Done",
      priority: "P2",
    });

    expect(result.tslaRemaining).toBeNull();
    expect(result.isTslaBreached).toBe(false);
  });
});

describe("computeTtoDeadline", () => {
  it("adds P0 threshold (5 min) to creation time", () => {
    const created = new Date("2026-03-08T10:00:00Z");
    const deadline = computeTtoDeadline(created, "P0");
    expect(deadline.getTime()).toBe(created.getTime() + 5 * 60 * 1000);
  });

  it("adds P3 threshold (480 min / 8h) to creation time", () => {
    const created = new Date("2026-03-08T10:00:00Z");
    const deadline = computeTtoDeadline(created, "P3");
    expect(deadline.getTime()).toBe(created.getTime() + 480 * 60 * 1000);
  });
});

describe("computeTtfaDeadline", () => {
  it("adds P1 threshold (60 min) to assignment time", () => {
    const assigned = new Date("2026-03-08T10:00:00Z");
    const deadline = computeTtfaDeadline(assigned, "P1");
    expect(deadline.getTime()).toBe(assigned.getTime() + 60 * 60 * 1000);
  });
});

describe("formatSlaRemaining", () => {
  it("formats null as dash", () => {
    expect(formatSlaRemaining(null)).toBe("—");
  });

  it("formats positive minutes", () => {
    expect(formatSlaRemaining(45)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatSlaRemaining(130)).toBe("2h 10m");
  });

  it("formats overdue minutes", () => {
    expect(formatSlaRemaining(-30)).toBe("Overdue by 30m");
  });

  it("formats overdue hours", () => {
    expect(formatSlaRemaining(-90)).toBe("Overdue by 1h 30m");
  });
});

describe("isExcessiveBouncing", () => {
  it("returns false for 2 or fewer changes in 24h", () => {
    const changes = [
      { changedAt: new Date() },
      { changedAt: new Date() },
    ];
    expect(isExcessiveBouncing(changes)).toBe(false);
  });

  it("returns true for 3+ changes in 24h", () => {
    const changes = [
      { changedAt: new Date() },
      { changedAt: new Date() },
      { changedAt: new Date() },
    ];
    expect(isExcessiveBouncing(changes)).toBe(true);
  });

  it("ignores changes older than 24h", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const changes = [
      { changedAt: twoDaysAgo },
      { changedAt: twoDaysAgo },
      { changedAt: twoDaysAgo },
      { changedAt: new Date() },
    ];
    expect(isExcessiveBouncing(changes)).toBe(false);
  });
});

describe("computeTravelRuleAging", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns green for case < 24h old", () => {
    vi.setSystemTime(new Date("2026-03-08T20:00:00Z"));
    const result = computeTravelRuleAging("2026-03-08T10:00:00Z");
    expect(result.agingStatus).toBe("green");
    expect(result.ageHours).toBeCloseTo(10, 0);
  });

  it("returns amber for case 24-48h old", () => {
    vi.setSystemTime(new Date("2026-03-09T20:00:00Z"));
    const result = computeTravelRuleAging("2026-03-08T10:00:00Z");
    expect(result.agingStatus).toBe("amber");
  });

  it("returns red for case > 48h old", () => {
    vi.setSystemTime(new Date("2026-03-11T10:00:00Z"));
    const result = computeTravelRuleAging("2026-03-08T10:00:00Z");
    expect(result.agingStatus).toBe("red");
  });
});

describe("DEFAULT_SLA_THRESHOLDS", () => {
  it("has progressively looser P0→P3 TTO thresholds", () => {
    expect(DEFAULT_SLA_THRESHOLDS.tto.P0).toBeLessThan(DEFAULT_SLA_THRESHOLDS.tto.P1);
    expect(DEFAULT_SLA_THRESHOLDS.tto.P1).toBeLessThan(DEFAULT_SLA_THRESHOLDS.tto.P2);
    expect(DEFAULT_SLA_THRESHOLDS.tto.P2).toBeLessThan(DEFAULT_SLA_THRESHOLDS.tto.P3);
  });

  it("has progressively looser P0→P3 TTFA thresholds", () => {
    expect(DEFAULT_SLA_THRESHOLDS.ttfa.P0).toBeLessThan(DEFAULT_SLA_THRESHOLDS.ttfa.P1);
    expect(DEFAULT_SLA_THRESHOLDS.ttfa.P1).toBeLessThan(DEFAULT_SLA_THRESHOLDS.ttfa.P2);
    expect(DEFAULT_SLA_THRESHOLDS.ttfa.P2).toBeLessThan(DEFAULT_SLA_THRESHOLDS.ttfa.P3);
  });

  it("has shorter TSLA for InProgress than WaitingExternal", () => {
    expect(DEFAULT_SLA_THRESHOLDS.tsla.InProgress).toBeLessThan(
      DEFAULT_SLA_THRESHOLDS.tsla.WaitingExternal
    );
  });
});

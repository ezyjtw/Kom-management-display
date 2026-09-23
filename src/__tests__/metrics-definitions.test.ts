/**
 * Spec §13.2: one unit test per metric formula.
 */
import { describe, it, expect } from "vitest";
import {
  alertLoad, backlogAge, backlogBand, breachCount, checkCompletion, clientEffortHours, elapsedMins, loggingCoverage,
  mtdClosure, slaAttainment, targetFor, timeTo, trendPct, windowOutcome, type MeasuredItem,
} from "@/modules/metrics/definitions";
import type { BusinessCalendar } from "@/modules/alerting/calendar";

const T = new Date("2026-09-23T09:00:00Z"); // Wednesday 10:00 London
const at = (mins: number) => new Date(T.getTime() + mins * 60_000);
const item = (o: Partial<MeasuredItem> = {}): MeasuredItem => ({ clockStartedAt: T, ownedAt: null, firstResponseAt: null, resolvedAt: null, ...o });
const UK: BusinessCalendar = { is24x7: false, startMin: 8 * 60, endMin: 18 * 60, holidays: new Set() };

describe("time to ownership / first response / resolution", () => {
  it("measures from clockStartedAt (source time) to the stop event", () => {
    const i = item({ ownedAt: at(12), firstResponseAt: at(30), resolvedAt: at(240) });
    expect(timeTo(i, "ownership")).toBe(12);
    expect(timeTo(i, "first_response")).toBe(30);
    expect(timeTo(i, "resolution")).toBe(240);
  });

  it("is null while the clock is still running", () => {
    expect(timeTo(item(), "resolution")).toBeNull();
  });

  it("uses business minutes only when the policy calendar says so", () => {
    // Started Wed 17:00 London (16:00Z), owned Thu 09:00 London (08:00Z).
    const i = item({ clockStartedAt: new Date("2026-09-23T16:00:00Z"), ownedAt: new Date("2026-09-24T08:00:00Z") });
    expect(timeTo(i, "ownership")).toBe(16 * 60);
    expect(timeTo(i, "ownership", UK)).toBe(120);
  });
});

describe("SLA attainment %", () => {
  const policy = { ownershipMins: 30, firstRespMins: 60, resolveMins: 480 };

  it("is attained ÷ measured, with running clocks counted as missed once past target and pending before", () => {
    const rows = [
      { item: item({ ownedAt: at(20) }), policy }, // attained
      { item: item({ ownedAt: at(45) }), policy }, // missed
      { item: item({ clockStartedAt: at(-60) }), policy }, // running, past target: missed
      { item: item({ clockStartedAt: at(-10) }), policy }, // running, within target: pending
    ];
    expect(slaAttainment(rows, "ownership", T)).toEqual({ attained: 1, measured: 3, pct: 33.3, pending: 1, excludedNonActionable: 0, targetSet: true });
  });

  it("excludes closed_non_actionable from the denominator but reports the count", () => {
    const rows = [{ item: item({ firstResponseAt: at(10) }), policy }, { item: item({ nonActionable: true }), policy }];
    expect(slaAttainment(rows, "first_response", T)).toMatchObject({ attained: 1, measured: 1, pct: 100, excludedNonActionable: 1 });
  });

  it("reports target not set when no policy has a target", () => {
    const res = slaAttainment([{ item: item({ ownedAt: at(5) }), policy: { ownershipMins: null, firstRespMins: null, resolveMins: null } }], "ownership", T);
    expect(res).toMatchObject({ targetSet: false, pct: null, measured: 0 });
  });

  it("derives the resolution target from next_business_day_eod", () => {
    expect(targetFor({ ownershipMins: null, firstRespMins: null, resolveMins: null, resolveRule: "next_business_day_eod" }, "resolution", T, UK)).toBe((8 + 10) * 60);
  });
});

describe("breach count", () => {
  it("counts distinct WorkItems with a breach event in the period", () => {
    const events = [
      { workItemId: "a", kind: "ownership_breach", at: at(1) },
      { workItemId: "a", kind: "resolution_breach", at: at(2) },
      { workItemId: "b", kind: "ownership_warn", at: at(3) },
      { workItemId: "c", kind: "first_response_breach", at: at(-100) },
    ];
    expect(breachCount(events, T, at(60))).toBe(1);
  });
});

describe("backlog age", () => {
  it("bands open items by age", () => {
    expect([30, 90, 300, 2000, 6000].map(backlogBand)).toEqual(["<1h", "1–4h", "4–24h", "1–3d", ">3d"]);
    expect(backlogAge([{ clockStartedAt: at(-30) }, { clockStartedAt: at(-30) }, { clockStartedAt: at(-5000) }], T)).toEqual({ "<1h": 2, "1–4h": 0, "4–24h": 0, "1–3d": 0, ">3d": 1 });
  });
});

describe("client effort (hours)", () => {
  it("sums bucketMins/60 by client and ignores logs without a client", () => {
    const m = clientEffortHours([{ clientId: "c1", bucketMins: 30 }, { clientId: "c1", bucketMins: 60 }, { clientId: null, bucketMins: 240 }]);
    expect(Object.fromEntries(m)).toEqual({ c1: 1.5 });
  });
});

describe("logging coverage %", () => {
  it("is closed client requests with a TimeLog ÷ closed client requests", () => {
    expect(loggingCoverage(["a", "b", "c"], new Set(["a", "c", "z"]))).toEqual({ covered: 2, total: 3, pct: 66.7 });
    expect(loggingCoverage([], new Set()).pct).toBeNull();
  });
});

describe("alert load", () => {
  it("counts by rule and severity, mean time to acknowledge, auto-resolved share", () => {
    const load = alertLoad([
      { ruleCode: "ALR-OES-01", severity: "critical", firstFiredAt: T, acknowledgedAt: at(10), resolvedAt: at(60), autoResolvedAt: at(60) },
      { ruleCode: "ALR-OES-01", severity: "critical", firstFiredAt: T, acknowledgedAt: at(30), resolvedAt: at(90), autoResolvedAt: null },
      { ruleCode: "ALR-TX-01", severity: "high", firstFiredAt: T, acknowledgedAt: null, resolvedAt: null, autoResolvedAt: null },
    ]);
    expect(load).toEqual({ byRule: { "ALR-OES-01": 2, "ALR-TX-01": 1 }, bySeverity: { critical: 2, high: 1 }, total: 3, meanMinsToAcknowledge: 20, autoResolvedShare: 50 });
  });
});

describe("check completion", () => {
  it("is the on-time rate per definition plus the skipped count", () => {
    const due = at(5);
    expect(checkCompletion([
      { status: "pass", completedAt: at(1), dueAt: due },
      { status: "issues_found", completedAt: at(20), dueAt: due },
      { status: "skipped", completedAt: at(2), dueAt: due },
      { status: "pending", completedAt: null, dueAt: due },
    ])).toEqual({ items: 4, completed: 2, onTime: 1, onTimePct: 25, skipped: 1 });
  });
});

describe("MTD break closure", () => {
  it("is the share closed by the end of the next business day; breaks not yet due are left out", () => {
    const wed = T;
    const res = mtdClosure([
      { clockStartedAt: wed, resolvedAt: new Date("2026-09-24T16:00:00Z") }, // Thu 17:00 London: within
      { clockStartedAt: wed, resolvedAt: new Date("2026-09-25T09:00:00Z") }, // Fri: late
      { clockStartedAt: wed, resolvedAt: null }, // open, still due by Thu EOD at "now" below
    ], UK, new Date("2026-09-24T12:00:00Z"));
    expect(res).toEqual({ withinT1: 1, due: 2, pct: 50 });
  });
});

describe("OES window health", () => {
  it("classifies a window as on time, failed, stuck, not run or in progress", () => {
    expect(windowOutcome([{ mappedStatus: "completed", startedAt: T }], T, at(90))).toBe("on_time");
    expect(windowOutcome([{ mappedStatus: "completed", startedAt: T }, { mappedStatus: "failed", startedAt: T }], T, at(90))).toBe("failed");
    expect(windowOutcome([{ mappedStatus: "in_progress", startedAt: T }], T, at(90))).toBe("stuck");
    expect(windowOutcome([{ mappedStatus: "in_progress", startedAt: T }], T, at(20))).toBe("in_progress");
    expect(windowOutcome([], T, at(45))).toBe("not_run");
    expect(windowOutcome([], T, at(10))).toBe("in_progress");
  });
});

describe("trend", () => {
  it("is the month-on-month change in percent", () => {
    expect(trendPct(15, 10)).toBe(50);
    expect(trendPct(5, 0)).toBeNull();
    expect(elapsedMins(T, at(-5))).toBe(0);
  });
});

import { describe, it, expect } from "vitest";

describe("Vendor Reliability Scoring", () => {
  // Test the scoring formula in isolation (no DB dependency)

  function computeScore(params: {
    incidentCount: number;
    avgResolutionMins: number;
    clientImpactCount: number;
    rcaOverdueCount: number;
    disputeCount: number;
  }): number {
    let score = 100;

    // -5 per incident
    score -= params.incidentCount * 5;

    // -2 per hour of avg resolution above 4 hours
    const avgResolutionHours = params.avgResolutionMins / 60;
    if (avgResolutionHours > 4) {
      score -= Math.floor(avgResolutionHours - 4) * 2;
    }

    // -10 per client impact
    score -= params.clientImpactCount * 10;

    // -5 per RCA overdue
    score -= params.rcaOverdueCount * 5;

    // -5 per dispute
    score -= params.disputeCount * 5;

    // Clamp to [0, 100]
    return Math.max(0, Math.min(100, score));
  }

  it("score is 100 for a provider with zero incidents in the period", () => {
    const score = computeScore({
      incidentCount: 0,
      avgResolutionMins: 0,
      clientImpactCount: 0,
      rcaOverdueCount: 0,
      disputeCount: 0,
    });
    expect(score).toBe(100);
  });

  it("each incident deducts 5 points", () => {
    const score = computeScore({
      incidentCount: 3,
      avgResolutionMins: 0,
      clientImpactCount: 0,
      rcaOverdueCount: 0,
      disputeCount: 0,
    });
    expect(score).toBe(85); // 100 - (3 * 5)
  });

  it("avg resolution above 4 hours deducts 2 per extra hour", () => {
    const score = computeScore({
      incidentCount: 0,
      avgResolutionMins: 420, // 7 hours = 3 hours over threshold
      clientImpactCount: 0,
      rcaOverdueCount: 0,
      disputeCount: 0,
    });
    expect(score).toBe(94); // 100 - (3 * 2)
  });

  it("client impact deducts 10 per record", () => {
    const score = computeScore({
      incidentCount: 0,
      avgResolutionMins: 0,
      clientImpactCount: 2,
      rcaOverdueCount: 0,
      disputeCount: 0,
    });
    expect(score).toBe(80); // 100 - (2 * 10)
  });

  it("RCA overdue deducts 5 per incident", () => {
    const score = computeScore({
      incidentCount: 0,
      avgResolutionMins: 0,
      clientImpactCount: 0,
      rcaOverdueCount: 2,
      disputeCount: 0,
    });
    expect(score).toBe(90); // 100 - (2 * 5)
  });

  it("disputes deduct 5 per dispute", () => {
    const score = computeScore({
      incidentCount: 0,
      avgResolutionMins: 0,
      clientImpactCount: 0,
      rcaOverdueCount: 0,
      disputeCount: 3,
    });
    expect(score).toBe(85); // 100 - (3 * 5)
  });

  it("score is clamped to 0 — never returns negative", () => {
    const score = computeScore({
      incidentCount: 10, // -50
      avgResolutionMins: 600, // -12 (6 hours over)
      clientImpactCount: 5, // -50
      rcaOverdueCount: 5, // -25
      disputeCount: 5, // -25
    });
    expect(score).toBe(0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("all deduction types combined reduce score correctly", () => {
    const score = computeScore({
      incidentCount: 2, // -10
      avgResolutionMins: 360, // 6 hrs = 2 hrs over → -4
      clientImpactCount: 1, // -10
      rcaOverdueCount: 1, // -5
      disputeCount: 1, // -5
    });
    expect(score).toBe(66); // 100 - 10 - 4 - 10 - 5 - 5
  });
});

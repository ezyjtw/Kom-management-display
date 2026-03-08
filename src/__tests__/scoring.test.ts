import { describe, it, expect } from "vitest";
import {
  rawIndexToScore,
  clamp,
  computeOverallScore,
  computeDailyTasksIndex,
  computeProjectsIndex,
  computeAssetActionsIndex,
  computeQualityIndex,
  mapKnowledgeScore,
  getDefaultScoringConfig,
} from "@/lib/scoring";
import type { Category } from "@/types";

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(5, 3, 8)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(1, 3, 8)).toBe(3);
  });

  it("clamps to max", () => {
    expect(clamp(10, 3, 8)).toBe(8);
  });

  it("handles edge values", () => {
    expect(clamp(3, 3, 8)).toBe(3);
    expect(clamp(8, 3, 8)).toBe(8);
  });
});

describe("rawIndexToScore", () => {
  it("maps 0 to minimum score (3)", () => {
    expect(rawIndexToScore(0)).toBe(3);
  });

  it("maps 1 to maximum score (8)", () => {
    expect(rawIndexToScore(1)).toBe(8);
  });

  it("maps 0.5 to midpoint (5.5)", () => {
    expect(rawIndexToScore(0.5)).toBe(5.5);
  });

  it("clamps negative input to 3", () => {
    expect(rawIndexToScore(-0.5)).toBe(3);
  });

  it("clamps >1 input to 8", () => {
    expect(rawIndexToScore(1.5)).toBe(8);
  });

  it("rounds to 1 decimal place", () => {
    const result = rawIndexToScore(0.33);
    expect(result).toBe(4.7); // 3 + 0.33*5 = 4.65 → 4.7
  });
});

describe("computeOverallScore", () => {
  const config = getDefaultScoringConfig();

  it("computes weighted average of category scores", () => {
    const scores: Record<Category, number> = {
      daily_tasks: 6,
      projects: 6,
      asset_actions: 6,
      quality: 6,
      knowledge: 6,
    };
    expect(computeOverallScore(scores, config.weights)).toBe(6);
  });

  it("weights categories correctly", () => {
    const scores: Record<Category, number> = {
      daily_tasks: 8,    // 25%
      projects: 3,       // 15%
      asset_actions: 8,  // 25%
      quality: 3,        // 25%
      knowledge: 3,      // 10%
    };
    const result = computeOverallScore(scores, config.weights);
    // 8*0.25 + 3*0.15 + 8*0.25 + 3*0.25 + 3*0.10 = 2 + 0.45 + 2 + 0.75 + 0.3 = 5.5
    expect(result).toBe(5.5);
  });

  it("returns 3 for all minimum scores", () => {
    const scores: Record<Category, number> = {
      daily_tasks: 3,
      projects: 3,
      asset_actions: 3,
      quality: 3,
      knowledge: 3,
    };
    expect(computeOverallScore(scores, config.weights)).toBe(3);
  });

  it("returns 8 for all maximum scores", () => {
    const scores: Record<Category, number> = {
      daily_tasks: 8,
      projects: 8,
      asset_actions: 8,
      quality: 8,
      knowledge: 8,
    };
    expect(computeOverallScore(scores, config.weights)).toBe(8);
  });
});

describe("computeDailyTasksIndex", () => {
  it("returns ~1.0 for perfect performance", () => {
    const result = computeDailyTasksIndex({
      ticketsResolved: 100,
      ticketsTarget: 100,
      onTimeRate: 0.95,
      targetOnTimeRate: 0.95,
      avgCycleTimeDays: 1.0,
      targetCycleTimeDays: 1.0,
      reopenedRate: 0,
      workingDaysFactor: 1.0,
    });
    expect(result).toBeGreaterThanOrEqual(0.9);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("returns lower index for poor throughput vs perfect", () => {
    const poor = computeDailyTasksIndex({
      ticketsResolved: 20,
      ticketsTarget: 100,
      onTimeRate: 0.95,
      targetOnTimeRate: 0.95,
      avgCycleTimeDays: 1.0,
      targetCycleTimeDays: 1.0,
      reopenedRate: 0,
      workingDaysFactor: 1.0,
    });
    const perfect = computeDailyTasksIndex({
      ticketsResolved: 100,
      ticketsTarget: 100,
      onTimeRate: 0.95,
      targetOnTimeRate: 0.95,
      avgCycleTimeDays: 1.0,
      targetCycleTimeDays: 1.0,
      reopenedRate: 0,
      workingDaysFactor: 1.0,
    });
    expect(poor).toBeLessThan(perfect);
  });

  it("adjusts for PTO via workingDaysFactor", () => {
    const fullWeek = computeDailyTasksIndex({
      ticketsResolved: 50,
      ticketsTarget: 100,
      onTimeRate: 0.95,
      targetOnTimeRate: 0.95,
      avgCycleTimeDays: 1.0,
      targetCycleTimeDays: 1.0,
      reopenedRate: 0,
      workingDaysFactor: 1.0,
    });
    const halfWeek = computeDailyTasksIndex({
      ticketsResolved: 50,
      ticketsTarget: 100,
      onTimeRate: 0.95,
      targetOnTimeRate: 0.95,
      avgCycleTimeDays: 1.0,
      targetCycleTimeDays: 1.0,
      reopenedRate: 0,
      workingDaysFactor: 0.5,
    });
    // Same output but adjusted target — half week should score higher
    expect(halfWeek).toBeGreaterThan(fullWeek);
  });
});

describe("computeProjectsIndex", () => {
  it("returns ~1.0 for perfect performance", () => {
    const result = computeProjectsIndex({
      pagesCreated: 10,
      pagesCreatedTarget: 10,
      pagesUpdated: 20,
      pagesUpdatedTarget: 20,
      qualityMarkers: 1.0,
      workingDaysFactor: 1.0,
    });
    expect(result).toBeGreaterThanOrEqual(0.9);
    expect(result).toBeLessThanOrEqual(1.0);
  });
});

describe("computeAssetActionsIndex", () => {
  it("returns high index for good performance", () => {
    const result = computeAssetActionsIndex({
      actionsCompleted: 100,
      actionsTarget: 100,
      slaComplianceRate: 0.98,
      targetSlaRate: 0.95,
      rejectedRate: 0.01,
      complexityFactor: 1.0,
      workingDaysFactor: 1.0,
    });
    expect(result).toBeGreaterThanOrEqual(0.8);
  });
});

describe("computeQualityIndex", () => {
  it("returns high index when few mistakes and many positives", () => {
    const result = computeQualityIndex({
      mistakesWeighted: 0,
      maxMistakesThreshold: 5,
      positiveActions: 10,
      positiveActionsTarget: 5,
      nearMisses: 0,
    });
    expect(result).toBeGreaterThanOrEqual(0.8);
  });

  it("returns low index when many mistakes", () => {
    const result = computeQualityIndex({
      mistakesWeighted: 10,
      maxMistakesThreshold: 5,
      positiveActions: 0,
      positiveActionsTarget: 5,
      nearMisses: 5,
    });
    expect(result).toBeLessThan(0.3);
  });
});

describe("mapKnowledgeScore", () => {
  it("maps rubric 1 to score 3", () => {
    expect(mapKnowledgeScore(1)).toBe(3);
  });

  it("maps rubric 10 to score 8", () => {
    expect(mapKnowledgeScore(10)).toBe(8);
  });

  it("maps rubric 5.5 to approximately midpoint", () => {
    const result = mapKnowledgeScore(5.5);
    expect(result).toBeGreaterThan(4.5);
    expect(result).toBeLessThan(6);
  });
});

describe("getDefaultScoringConfig", () => {
  it("returns weights that sum to 1.0", () => {
    const config = getDefaultScoringConfig();
    const sum = Object.values(config.weights).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1);
  });

  it("has all required categories", () => {
    const config = getDefaultScoringConfig();
    expect(config.weights).toHaveProperty("daily_tasks");
    expect(config.weights).toHaveProperty("projects");
    expect(config.weights).toHaveProperty("asset_actions");
    expect(config.weights).toHaveProperty("quality");
    expect(config.weights).toHaveProperty("knowledge");
  });

  it("has a version string", () => {
    const config = getDefaultScoringConfig();
    expect(config.version).toBeTruthy();
  });
});

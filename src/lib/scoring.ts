/**
 * Employee performance scoring engine.
 *
 * All scores are on a 3-8 scale (not 1-10) to avoid false precision and
 * compressed distributions. Each category computes a raw 0-1 index from
 * metrics, then maps to 3-8 via `rawIndexToScore()`.
 *
 * Categories and their weights (configurable):
 *   - daily_tasks (25%): ticket throughput, on-time rate, cycle time
 *   - asset_actions (25%): completed actions, SLA compliance, complexity
 *   - quality (25%): mistakes (severity-weighted) vs positive contributions
 *   - projects (15%): documentation created/updated in Confluence
 *   - knowledge (10%): monthly rubric assessment by lead (mapped from 1-10)
 */
import type { Category, CategoryWeight, ScoringConfigData } from "@/types";
import { prisma } from "@/lib/prisma";

// Dashboard score range — 3 is the floor, 8 is the ceiling
const CLAMP_MIN = 3;
const CLAMP_MAX = 8;

/**
 * Converts a raw performance index (0-1) into a clamped category score (3-8).
 * Formula: score = 3 + (rawIndex * 5), then clamp to [3, 8]
 */
export function rawIndexToScore(rawIndex: number): number {
  const score = CLAMP_MIN + rawIndex * (CLAMP_MAX - CLAMP_MIN);
  return Math.round(clamp(score, CLAMP_MIN, CLAMP_MAX) * 10) / 10;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute weighted overall score from category scores.
 */
export function computeOverallScore(
  categoryScores: Record<Category, number>,
  weights: CategoryWeight
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const cat of Object.keys(weights) as Category[]) {
    const w = weights[cat];
    const s = categoryScores[cat] ?? CLAMP_MIN;
    weightedSum += s * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return CLAMP_MIN;
  const overall = weightedSum / totalWeight;
  return Math.round(clamp(overall, CLAMP_MIN, CLAMP_MAX) * 10) / 10;
}

/**
 * Calculate raw index for daily tasks category.
 *
 * Breakdown: 40% throughput, 30% on-time rate, 20% cycle time, 10% quality.
 * Each sub-score is capped (1.2-1.5x) to allow slight over-performance
 * without gaming. `workingDaysFactor` adjusts targets for PTO.
 */
export function computeDailyTasksIndex(metrics: {
  ticketsResolved: number;
  ticketsTarget: number;
  onTimeRate: number; // 0-1
  targetOnTimeRate: number; // 0-1
  avgCycleTimeDays: number;
  targetCycleTimeDays: number;
  reopenedRate: number; // 0-1
  workingDaysFactor: number; // 0-1, adjusts for PTO
}): number {
  const throughputRatio = Math.min(
    (metrics.ticketsResolved / (metrics.ticketsTarget * metrics.workingDaysFactor)) || 0,
    1.5
  );
  const onTimeScore = Math.min(metrics.onTimeRate / metrics.targetOnTimeRate, 1.2);
  const cycleTimeScore = metrics.avgCycleTimeDays > 0
    ? Math.min(metrics.targetCycleTimeDays / metrics.avgCycleTimeDays, 1.2)
    : 0.5;
  const qualityPenalty = metrics.reopenedRate * 0.5; // reduce for reopens

  const raw = (throughputRatio * 0.4 + onTimeScore * 0.3 + cycleTimeScore * 0.2 + (1 - qualityPenalty) * 0.1);
  return clamp(raw, 0, 1);
}

/**
 * Calculate raw index for projects/docs category.
 */
export function computeProjectsIndex(metrics: {
  pagesCreated: number;
  pagesCreatedTarget: number;
  pagesUpdated: number;
  pagesUpdatedTarget: number;
  qualityMarkers: number; // 0-1 percentage with quality markers
  workingDaysFactor: number;
}): number {
  const createScore = Math.min(
    (metrics.pagesCreated / (metrics.pagesCreatedTarget * metrics.workingDaysFactor)) || 0,
    1.5
  );
  const updateScore = Math.min(
    (metrics.pagesUpdated / (metrics.pagesUpdatedTarget * metrics.workingDaysFactor)) || 0,
    1.5
  );
  const raw = createScore * 0.5 + updateScore * 0.3 + metrics.qualityMarkers * 0.2;
  return clamp(raw, 0, 1);
}

/**
 * Calculate raw index for asset actions category.
 */
export function computeAssetActionsIndex(metrics: {
  actionsCompleted: number;
  actionsTarget: number;
  slaComplianceRate: number; // 0-1
  targetSlaRate: number;
  rejectedRate: number; // 0-1
  complexityFactor: number; // 1.0 = normal, higher = more complex
  workingDaysFactor: number;
}): number {
  const volumeScore = Math.min(
    (metrics.actionsCompleted / (metrics.actionsTarget * metrics.workingDaysFactor)) || 0,
    1.5
  );
  const slaScore = Math.min(metrics.slaComplianceRate / metrics.targetSlaRate, 1.2);
  const qualityBonus = (1 - metrics.rejectedRate) * 0.1;
  const complexityBonus = Math.min((metrics.complexityFactor - 1) * 0.1, 0.1);

  const raw = volumeScore * 0.45 + slaScore * 0.35 + qualityBonus + complexityBonus;
  return clamp(raw, 0, 1);
}

/**
 * Calculate raw index for quality (mistakes vs positives) category.
 */
export function computeQualityIndex(metrics: {
  mistakesWeighted: number; // severity-weighted count
  maxMistakesThreshold: number;
  positiveActions: number;
  positiveActionsTarget: number;
  nearMisses: number;
}): number {
  // Net quality: positives offset mistakes
  const mistakePenalty = Math.min(metrics.mistakesWeighted / metrics.maxMistakesThreshold, 1);
  const positiveCredit = Math.min(metrics.positiveActions / metrics.positiveActionsTarget, 1.2);
  const nearMissPenalty = metrics.nearMisses * 0.05;

  const raw = (1 - mistakePenalty * 0.5) * 0.5 + positiveCredit * 0.4 - nearMissPenalty;
  return clamp(raw, 0, 1);
}

/**
 * Map knowledge rubric (1-10 avg) to dashboard range (3-8).
 */
export function mapKnowledgeScore(rubricAverage: number): number {
  // Map 1-10 → 0-1 → 3-8
  const normalized = clamp((rubricAverage - 1) / 9, 0, 1);
  return rawIndexToScore(normalized);
}

/**
 * Load the active scoring config from the database.
 * Falls back to the hardcoded default if no active config exists in DB.
 */
export async function getActiveScoringConfig(): Promise<ScoringConfigData> {
  try {
    const dbConfig = await prisma.scoringConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });

    if (dbConfig) {
      // config is a native Json column — parse if string (legacy), otherwise use directly
      const raw = dbConfig.config;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as ScoringConfigData;
    }
  } catch {
    // DB unavailable or parse error — fall back to defaults
  }
  return getDefaultScoringConfig();
}

/**
 * Default scoring configuration.
 */
export function getDefaultScoringConfig(): ScoringConfigData {
  return {
    version: "1.0.0",
    weights: {
      daily_tasks: 0.25,
      projects: 0.15,
      asset_actions: 0.25,
      quality: 0.25,
      knowledge: 0.10,
    },
    targets: {
      Analyst: {
        daily_tasks: { ticketsPerWeek: 20, onTimeRate: 0.85, cycleTimeDays: 3 },
        projects: { pagesCreatedPerMonth: 2, pagesUpdatedPerMonth: 4 },
        asset_actions: { actionsPerWeek: 30, slaComplianceRate: 0.9 },
        quality: { maxMistakes: 3, positiveActionsTarget: 2 },
      },
      Senior: {
        daily_tasks: { ticketsPerWeek: 15, onTimeRate: 0.9, cycleTimeDays: 2 },
        projects: { pagesCreatedPerMonth: 3, pagesUpdatedPerMonth: 6 },
        asset_actions: { actionsPerWeek: 25, slaComplianceRate: 0.92 },
        quality: { maxMistakes: 2, positiveActionsTarget: 3 },
      },
      Lead: {
        daily_tasks: { ticketsPerWeek: 10, onTimeRate: 0.9, cycleTimeDays: 2 },
        projects: { pagesCreatedPerMonth: 4, pagesUpdatedPerMonth: 8 },
        asset_actions: { actionsPerWeek: 15, slaComplianceRate: 0.95 },
        quality: { maxMistakes: 1, positiveActionsTarget: 4 },
      },
    },
    clampMin: CLAMP_MIN,
    clampMax: CLAMP_MAX,
    definitions: {
      jira: {
        doneStatuses: ["Done", "Closed", "Resolved"],
        issueTypes: ["Task", "Bug", "Incident", "Sub-task", "Change"],
        creditRule: "assignee_at_completion",
        reopenedHandling: "quality_penalty",
      },
      confluence: {
        qualifyingSpaces: ["OPS", "RUNBOOKS", "PROCESSES"],
        qualifyingLabels: ["project-doc", "runbook", "process-improvement"],
        createWeight: 1.0,
        updateWeight: 0.3,
      },
      assetActions: {
        countableTypes: ["transfer", "stake", "unstake", "withdraw", "consolidate", "approve"],
        performedMeans: "completed",
        multiApproverCredit: "all_approvers",
      },
      quality: {
        severityWeights: { low: 1, medium: 2, high: 5 },
        positiveActionDefinition:
          "Process improvements, caught issues, prevented incidents, good escalations",
      },
      knowledge: {
        rubricDimensions: [
          "Operational understanding",
          "Asset-specific knowledge",
          "Compliance awareness",
          "Incident response competence",
        ],
        cadence: "monthly",
      },
    },
  };
}

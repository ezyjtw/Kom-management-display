/**
 * Scoring Domain Service
 *
 * Centralizes all scoring logic including score computation, explanation,
 * comparison, config lifecycle (draft/review/approve/activate), and
 * backtesting/simulation against historical data.
 *
 * Delegates data access to scoreRepository and wraps the raw scoring
 * functions from @/lib/scoring.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Category, CategoryWeight, ScoringConfigData, TrendData } from "@/types";
import {
  rawIndexToScore,
  clamp,
  computeOverallScore,
  computeDailyTasksIndex,
  computeProjectsIndex,
  computeAssetActionsIndex,
  computeQualityIndex,
  mapKnowledgeScore,
  getActiveScoringConfig,
  getDefaultScoringConfig,
} from "@/lib/scoring";
import {
  scoreRepository,
  type ScoreFilters,
  type ScorePaginationOptions,
  type ScoreRecord,
} from "@/modules/scoring/repositories/score-repository";

// ─── Config Lifecycle Types ───

/** Status progression for scoring config approval workflow. */
export type ConfigStatus = "draft" | "review" | "approved" | "active" | "archived";

export interface ScoringConfigRecord {
  id: string;
  version: string;
  config: string;
  active: boolean;
  createdById: string;
  createdAt: Date;
  notes: string;
  /** Extended status stored in the notes field as JSON prefix. */
  status?: ConfigStatus;
}

export interface ConfigTransitionResult {
  success: boolean;
  config: ScoringConfigRecord;
  previousStatus: ConfigStatus;
  newStatus: ConfigStatus;
  error?: string;
}

// ─── Score Explanation Types ───

/** Full breakdown of how a score was computed. */
export interface ScoreExplanation {
  employeeId: string;
  employeeName: string;
  periodLabel: string;
  category: Category;
  /** Final clamped score on the 3-8 scale. */
  score: number;
  /** Raw performance index (0-1) before mapping. */
  rawIndex: number;
  /** Target values from the scoring config for this employee's role. */
  targets: Record<string, unknown>;
  /** Raw metric inputs that were fed into the scoring function. */
  rawInputs: Record<string, unknown>;
  /** How the raw index was mapped to the score range. */
  normalization: {
    method: "linear";
    formula: string;
    clampMin: number;
    clampMax: number;
  };
  /** Whether clamping was applied (score hit floor or ceiling). */
  clampApplied: "none" | "floor" | "ceiling";
  /** The scoring config version used. */
  configVersion: string;
  /** Evidence links attached to this score. */
  evidence: string[];
  /** Any manual overrides that were applied. */
  manualOverrides: ManualOverride[];
}

export interface ManualOverride {
  field: string;
  originalValue: number;
  overriddenValue: number;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
}

// ─── Score Comparison Types ───

export interface PeriodComparison {
  employeeId: string;
  employeeName: string;
  currentPeriod: string;
  previousPeriod: string;
  categories: Record<Category, TrendData>;
  overall: TrendData;
}

// ─── Backtest Types ───

export interface BacktestRequest {
  /** The scoring config to test. */
  config: ScoringConfigData;
  /** The period to simulate scores for. */
  periodId: string;
  /** Optional subset of employees. If omitted, runs for all employees in the period. */
  employeeIds?: string[];
}

export interface BacktestResult {
  periodId: string;
  periodLabel: string;
  configVersion: string;
  results: BacktestEmployeeResult[];
  summary: {
    employeeCount: number;
    averageOverall: number;
    categoryAverages: Record<Category, number>;
    /** Comparison against current live scores for the same period. */
    deltas: Record<Category | "overall", number> | null;
  };
}

export interface BacktestEmployeeResult {
  employeeId: string;
  employeeName: string;
  role: string;
  scores: Record<Category, { rawIndex: number; score: number }>;
  overall: number;
  /** Delta from current live score, if one exists. */
  delta: number | null;
}

// ─── Service ───

export const scoringService = {
  // ──────────────────────────────
  // Score retrieval (delegates to repository)
  // ──────────────────────────────

  /**
   * Get all scores for a period with optional filters.
   */
  async getScoresForPeriod(
    periodId: string,
    filters?: ScoreFilters,
    pagination?: ScorePaginationOptions,
  ) {
    return scoreRepository.getScoresForPeriod(periodId, filters, pagination);
  },

  /**
   * Get all scores for an employee with optional filters.
   */
  async getScoresForEmployee(
    employeeId: string,
    filters?: ScoreFilters,
    pagination?: ScorePaginationOptions,
  ) {
    return scoreRepository.getScoresForEmployee(employeeId, filters, pagination);
  },

  /**
   * Get score trend history for an employee in a specific category.
   */
  async getScoreHistory(employeeId: string, category: Category, limit?: number) {
    return scoreRepository.getScoreHistory(employeeId, category, limit);
  },

  // ──────────────────────────────
  // Score computation
  // ──────────────────────────────

  /**
   * Compute and persist scores for an employee in a given period.
   * Pulls metrics from the metadata, applies the active config, and upserts.
   */
  async computeAndSaveScore(
    employeeId: string,
    periodId: string,
    category: Category,
    metrics: Record<string, unknown>,
  ): Promise<ScoreRecord> {
    const config = await getActiveScoringConfig();
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { role: true },
    });

    const rawIndex = computeRawIndex(category, metrics, config, employee.role);
    const score = rawIndexToScore(rawIndex);

    const result = await scoreRepository.upsertScore({
      employeeId,
      periodId,
      category,
      rawIndex,
      score,
      configVersion: config.version,
      metadata: JSON.stringify(metrics),
    });

    logger.info("scoringService.computeAndSaveScore", {
      employeeId,
      periodId,
      category,
      rawIndex,
      score,
      configVersion: config.version,
    });

    return result;
  },

  /**
   * Compute the weighted overall score from an employee's category scores
   * in a given period.
   */
  async computeOverall(
    employeeId: string,
    periodId: string,
  ): Promise<{ overall: number; categoryScores: Record<Category, number> }> {
    const config = await getActiveScoringConfig();
    const { scores } = await scoreRepository.getScoresForEmployee(employeeId, {});

    const periodScores = scores.filter((s) => s.periodId === periodId);
    const categoryScores = {} as Record<Category, number>;

    for (const s of periodScores) {
      categoryScores[s.category as Category] = s.score;
    }

    const overall = computeOverallScore(categoryScores, config.weights);
    return { overall, categoryScores };
  },

  // ──────────────────────────────
  // Score explanation
  // ──────────────────────────────

  /**
   * Explain how a specific score was computed. Returns raw inputs, targets,
   * normalization method, clamp behavior, config version, evidence, and
   * any manual overrides.
   */
  async explainScore(
    employeeId: string,
    periodId: string,
    category: Category,
  ): Promise<ScoreExplanation | null> {
    const score = await scoreRepository.getScoreByKey(employeeId, periodId, category);
    if (!score) return null;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { name: true, role: true },
    });
    if (!employee) return null;

    let config: ScoringConfigData;
    try {
      const dbConfig = await prisma.scoringConfig.findFirst({
        where: { version: score.configVersion },
      });
      config = dbConfig ? JSON.parse(dbConfig.config) : await getActiveScoringConfig();
    } catch {
      config = getDefaultScoringConfig();
    }

    const roleTargets = config.targets[employee.role];
    const rawInputs = safeParseJson(score.metadata, {}) as Record<string, unknown>;
    const evidence = safeParseJson(score.evidence, []);

    // Detect manual overrides from metadata
    const manualOverrides: ManualOverride[] = [];
    if (rawInputs._overrides && Array.isArray(rawInputs._overrides)) {
      manualOverrides.push(...(rawInputs._overrides as ManualOverride[]));
    }

    // Determine clamp behavior
    const unclamped = config.clampMin + score.rawIndex * (config.clampMax - config.clampMin);
    let clampApplied: "none" | "floor" | "ceiling" = "none";
    if (unclamped <= config.clampMin) clampApplied = "floor";
    else if (unclamped >= config.clampMax) clampApplied = "ceiling";

    return {
      employeeId,
      employeeName: employee.name,
      periodLabel: score.period?.label ?? periodId,
      category,
      score: score.score,
      rawIndex: score.rawIndex,
      targets: ((roleTargets as unknown as Record<string, unknown>)?.[category] as unknown as Record<string, unknown>) ?? {},
      rawInputs,
      normalization: {
        method: "linear",
        formula: `score = ${config.clampMin} + (rawIndex * ${config.clampMax - config.clampMin})`,
        clampMin: config.clampMin,
        clampMax: config.clampMax,
      },
      clampApplied,
      configVersion: score.configVersion,
      evidence,
      manualOverrides,
    };
  },

  // ──────────────────────────────
  // Score comparison
  // ──────────────────────────────

  /**
   * Compare an employee's scores between two periods, computing deltas
   * and trend direction for each category and overall.
   */
  async compareScores(
    employeeId: string,
    currentPeriodId: string,
    previousPeriodId: string,
  ): Promise<PeriodComparison | null> {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { name: true },
    });
    if (!employee) return null;

    const [currentScores, previousScores] = await Promise.all([
      scoreRepository.getScoresForEmployee(employeeId, {}),
      scoreRepository.getScoresForEmployee(employeeId, {}),
    ]);

    const currentMap = buildCategoryMap(currentScores.scores, currentPeriodId);
    const previousMap = buildCategoryMap(previousScores.scores, previousPeriodId);

    const config = await getActiveScoringConfig();
    const categories = {} as Record<Category, TrendData>;
    const allCategories: Category[] = [
      "daily_tasks", "projects", "asset_actions", "quality", "knowledge",
    ];

    for (const cat of allCategories) {
      const current = currentMap[cat] ?? config.clampMin;
      const previous = previousMap[cat] ?? config.clampMin;
      const delta = Math.round((current - previous) * 10) / 10;
      categories[cat] = {
        current,
        previous,
        delta,
        direction: delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat",
      };
    }

    const currentOverall = computeOverallScore(
      Object.fromEntries(allCategories.map((c) => [c, currentMap[c] ?? config.clampMin])) as Record<Category, number>,
      config.weights,
    );
    const previousOverall = computeOverallScore(
      Object.fromEntries(allCategories.map((c) => [c, previousMap[c] ?? config.clampMin])) as Record<Category, number>,
      config.weights,
    );
    const overallDelta = Math.round((currentOverall - previousOverall) * 10) / 10;

    const currentPeriod = await prisma.timePeriod.findUnique({ where: { id: currentPeriodId } });
    const previousPeriod = await prisma.timePeriod.findUnique({ where: { id: previousPeriodId } });

    return {
      employeeId,
      employeeName: employee.name,
      currentPeriod: currentPeriod?.label ?? currentPeriodId,
      previousPeriod: previousPeriod?.label ?? previousPeriodId,
      categories,
      overall: {
        current: currentOverall,
        previous: previousOverall,
        delta: overallDelta,
        direction: overallDelta > 0.05 ? "up" : overallDelta < -0.05 ? "down" : "flat",
      },
    };
  },

  // ──────────────────────────────
  // Config approval workflow
  // ──────────────────────────────

  /**
   * Create a new scoring config in "draft" status.
   */
  async createConfigDraft(
    config: ScoringConfigData,
    createdBy: string,
    notes = "",
  ): Promise<ScoringConfigRecord> {
    const statusMeta = JSON.stringify({ status: "draft" as ConfigStatus });
    const combinedNotes = `${statusMeta}\n${notes}`.trim();

    const record = await prisma.scoringConfig.create({
      data: {
        version: config.version,
        config: JSON.stringify(config),
        active: false,
        createdById: createdBy,
        notes: combinedNotes,
      },
    });

    await writeAuditLog("config_draft_created", "scoring_config", record.id, createdBy, {
      version: config.version,
    });

    logger.info("scoringService.createConfigDraft", { version: config.version, createdBy });
    return { ...record, status: "draft" };
  },

  /**
   * Transition a scoring config through the approval workflow.
   *
   * Valid transitions:
   *   draft -> review -> approved -> active
   *   Any state -> archived (to retire a config)
   */
  async transitionConfig(
    configId: string,
    targetStatus: ConfigStatus,
    performedBy: string,
    reason = "",
  ): Promise<ConfigTransitionResult> {
    const record = await prisma.scoringConfig.findUnique({ where: { id: configId } });
    if (!record) {
      throw new Error(`Scoring config ${configId} not found`);
    }

    const currentStatus = extractConfigStatus(record.notes);
    const validTransitions: Record<ConfigStatus, ConfigStatus[]> = {
      draft: ["review", "archived"],
      review: ["approved", "draft", "archived"],
      approved: ["active", "archived"],
      active: ["archived"],
      archived: [],
    };

    if (!validTransitions[currentStatus]?.includes(targetStatus)) {
      return {
        success: false,
        config: { ...record, status: currentStatus },
        previousStatus: currentStatus,
        newStatus: currentStatus,
        error: `Invalid transition: ${currentStatus} -> ${targetStatus}. Valid: ${validTransitions[currentStatus]?.join(", ")}`,
      };
    }

    // If activating, deactivate all other configs first
    if (targetStatus === "active") {
      await prisma.scoringConfig.updateMany({
        where: { active: true },
        data: { active: false },
      });
    }

    const statusMeta = JSON.stringify({ status: targetStatus });
    const existingNotes = stripStatusPrefix(record.notes);
    const combinedNotes = `${statusMeta}\n${reason ? `${reason}\n` : ""}${existingNotes}`.trim();

    const updated = await prisma.scoringConfig.update({
      where: { id: configId },
      data: {
        active: targetStatus === "active",
        notes: combinedNotes,
      },
    });

    await writeAuditLog("config_transition", "scoring_config", configId, performedBy, {
      from: currentStatus,
      to: targetStatus,
      reason,
    });

    logger.info("scoringService.transitionConfig", {
      configId,
      from: currentStatus,
      to: targetStatus,
      performedBy,
    });

    return {
      success: true,
      config: { ...updated, status: targetStatus },
      previousStatus: currentStatus,
      newStatus: targetStatus,
    };
  },

  /**
   * List all scoring configs with their workflow status.
   */
  async listConfigs(): Promise<ScoringConfigRecord[]> {
    const configs = await prisma.scoringConfig.findMany({
      orderBy: { createdAt: "desc" },
    });

    return configs.map((c) => ({
      ...c,
      status: extractConfigStatus(c.notes),
    }));
  },

  // ──────────────────────────────
  // Backtesting / simulation
  // ──────────────────────────────

  /**
   * Simulate what scores would be for a historical period given a
   * specific config. This does not persist any data.
   *
   * It re-reads existing score metadata (raw metric inputs) and
   * recomputes scores using the supplied config instead of the
   * config that was active at the time.
   */
  async backtest(request: BacktestRequest): Promise<BacktestResult> {
    const { config, periodId, employeeIds } = request;

    const period = await prisma.timePeriod.findUnique({ where: { id: periodId } });
    if (!period) {
      throw new Error(`Period ${periodId} not found`);
    }

    // Get existing scores for this period to extract their raw metric inputs
    const whereClause: Record<string, unknown> = { periodId };
    if (employeeIds?.length) {
      whereClause.employeeId = { in: employeeIds };
    }

    const existingScores = await prisma.categoryScore.findMany({
      where: whereClause,
      include: {
        employee: { select: { id: true, name: true, role: true, team: true } },
      },
    });

    // Group scores by employee
    const byEmployee = new Map<string, typeof existingScores>();
    for (const s of existingScores) {
      const group = byEmployee.get(s.employeeId) ?? [];
      group.push(s);
      byEmployee.set(s.employeeId, group);
    }

    // Also fetch current live scores for delta comparison
    const liveConfig = await getActiveScoringConfig();

    const allCategories: Category[] = [
      "daily_tasks", "projects", "asset_actions", "quality", "knowledge",
    ];
    const results: BacktestEmployeeResult[] = [];
    const categorySums: Record<Category, number> = {
      daily_tasks: 0, projects: 0, asset_actions: 0, quality: 0, knowledge: 0,
    };
    let overallSum = 0;

    for (const [empId, empScores] of byEmployee) {
      const emp = empScores[0].employee;
      const scores = {} as Record<Category, { rawIndex: number; score: number }>;
      const categoryScoreValues = {} as Record<Category, number>;

      for (const cat of allCategories) {
        const existing = empScores.find((s) => s.category === cat);
        if (existing) {
          const metrics = safeParseJson(existing.metadata, {});
          const rawIndex = computeRawIndex(cat, metrics, config, emp.role);
          const score = rawIndexToScore(rawIndex);
          scores[cat] = { rawIndex, score };
          categoryScoreValues[cat] = score;
          categorySums[cat] += score;
        } else {
          scores[cat] = { rawIndex: 0, score: config.clampMin };
          categoryScoreValues[cat] = config.clampMin;
          categorySums[cat] += config.clampMin;
        }
      }

      const overall = computeOverallScore(categoryScoreValues, config.weights);
      overallSum += overall;

      // Compute delta against live score
      const liveScoreMap = buildCategoryMap(
        empScores.map((s) => ({
          ...s,
          employee: undefined,
          period: undefined,
        })) as unknown as ScoreRecord[],
        periodId,
      );
      const liveOverall = computeOverallScore(
        Object.fromEntries(allCategories.map((c) => [c, liveScoreMap[c] ?? liveConfig.clampMin])) as Record<Category, number>,
        liveConfig.weights,
      );

      results.push({
        employeeId: empId,
        employeeName: emp.name,
        role: emp.role,
        scores,
        overall,
        delta: Math.round((overall - liveOverall) * 10) / 10,
      });
    }

    const employeeCount = results.length;
    const categoryAverages = {} as Record<Category, number>;
    for (const cat of allCategories) {
      categoryAverages[cat] = employeeCount > 0
        ? Math.round((categorySums[cat] / employeeCount) * 10) / 10
        : 0;
    }

    // Compute deltas against live category averages
    const liveAverages = await computeLiveCategoryAverages(periodId, allCategories);
    const deltas = liveAverages
      ? (Object.fromEntries([
          ...allCategories.map((c) => [c, Math.round((categoryAverages[c] - (liveAverages[c] ?? 0)) * 10) / 10]),
          ["overall", Math.round(((employeeCount > 0 ? overallSum / employeeCount : 0) - (liveAverages.overall ?? 0)) * 10) / 10],
        ]) as Record<Category | "overall", number>)
      : null;

    logger.info("scoringService.backtest", {
      periodId,
      configVersion: config.version,
      employeeCount,
    });

    return {
      periodId,
      periodLabel: period.label,
      configVersion: config.version,
      results,
      summary: {
        employeeCount,
        averageOverall: employeeCount > 0
          ? Math.round((overallSum / employeeCount) * 10) / 10
          : 0,
        categoryAverages,
        deltas,
      },
    };
  },

  // ──────────────────────────────
  // Re-exports for convenience
  // ──────────────────────────────

  rawIndexToScore,
  clamp,
  computeOverallScore,
  computeDailyTasksIndex,
  computeProjectsIndex,
  computeAssetActionsIndex,
  computeQualityIndex,
  mapKnowledgeScore,
  getActiveScoringConfig,
  getDefaultScoringConfig,
};

// ─── Internal Helpers ───

/**
 * Compute the raw index (0-1) for a given category using the appropriate
 * scoring function based on the provided metrics and config.
 */
function computeRawIndex(
  category: Category,
  metrics: Record<string, unknown>,
  config: ScoringConfigData,
  role: string,
): number {
  const targets = config.targets[role];
  if (!targets) {
    logger.warn("computeRawIndex: no targets for role", { role, category });
    return 0;
  }

  switch (category) {
    case "daily_tasks":
      return computeDailyTasksIndex({
        ticketsResolved: asNumber(metrics.ticketsResolved),
        ticketsTarget: targets.daily_tasks.ticketsPerWeek,
        onTimeRate: asNumber(metrics.onTimeRate),
        targetOnTimeRate: targets.daily_tasks.onTimeRate,
        avgCycleTimeDays: asNumber(metrics.avgCycleTimeDays, 3),
        targetCycleTimeDays: targets.daily_tasks.cycleTimeDays,
        reopenedRate: asNumber(metrics.reopenedRate),
        workingDaysFactor: asNumber(metrics.workingDaysFactor, 1),
      });

    case "projects":
      return computeProjectsIndex({
        pagesCreated: asNumber(metrics.pagesCreated),
        pagesCreatedTarget: targets.projects.pagesCreatedPerMonth,
        pagesUpdated: asNumber(metrics.pagesUpdated),
        pagesUpdatedTarget: targets.projects.pagesUpdatedPerMonth,
        qualityMarkers: asNumber(metrics.qualityMarkers),
        workingDaysFactor: asNumber(metrics.workingDaysFactor, 1),
      });

    case "asset_actions":
      return computeAssetActionsIndex({
        actionsCompleted: asNumber(metrics.actionsCompleted),
        actionsTarget: targets.asset_actions.actionsPerWeek,
        slaComplianceRate: asNumber(metrics.slaComplianceRate),
        targetSlaRate: targets.asset_actions.slaComplianceRate,
        rejectedRate: asNumber(metrics.rejectedRate),
        complexityFactor: asNumber(metrics.complexityFactor, 1),
        workingDaysFactor: asNumber(metrics.workingDaysFactor, 1),
      });

    case "quality":
      return computeQualityIndex({
        mistakesWeighted: asNumber(metrics.mistakesWeighted),
        maxMistakesThreshold: targets.quality.maxMistakes,
        positiveActions: asNumber(metrics.positiveActions),
        positiveActionsTarget: targets.quality.positiveActionsTarget,
        nearMisses: asNumber(metrics.nearMisses),
      });

    case "knowledge":
      // Knowledge uses a different path: rubric average mapped directly
      return clamp((asNumber(metrics.rubricAverage, 1) - 1) / 9, 0, 1);

    default:
      logger.warn("computeRawIndex: unknown category", { category });
      return 0;
  }
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}

function buildCategoryMap(
  scores: ScoreRecord[],
  periodId: string,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of scores) {
    if (s.periodId === periodId) {
      map[s.category] = s.score;
    }
  }
  return map;
}

/**
 * Extract the config workflow status from the notes field.
 * The status is stored as a JSON prefix on the first line.
 */
function extractConfigStatus(notes: string): ConfigStatus {
  try {
    const firstLine = notes.split("\n")[0];
    const parsed = JSON.parse(firstLine);
    if (parsed.status) return parsed.status as ConfigStatus;
  } catch {
    // Not stored — infer from active flag
  }
  return "draft";
}

function stripStatusPrefix(notes: string): string {
  const lines = notes.split("\n");
  try {
    JSON.parse(lines[0]);
    return lines.slice(1).join("\n").trim();
  } catch {
    return notes;
  }
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId,
        details: JSON.stringify(details),
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", { action, entityType, entityId, error: String(err) });
  }
}

/**
 * Compute average category scores across all employees for a given period
 * using their current live scores.
 */
async function computeLiveCategoryAverages(
  periodId: string,
  categories: Category[],
): Promise<Record<Category | "overall", number> | null> {
  try {
    const scores = await prisma.categoryScore.findMany({
      where: { periodId },
    });

    if (scores.length === 0) return null;

    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const s of scores) {
      sums[s.category] = (sums[s.category] ?? 0) + s.score;
      counts[s.category] = (counts[s.category] ?? 0) + 1;
    }

    const result: Record<string, number> = {};
    let totalSum = 0;
    let totalCount = 0;
    for (const cat of categories) {
      result[cat] = counts[cat] ? Math.round((sums[cat] / counts[cat]) * 10) / 10 : 0;
      totalSum += sums[cat] ?? 0;
      totalCount += counts[cat] ?? 0;
    }
    result.overall = totalCount > 0 ? Math.round((totalSum / totalCount) * 10) / 10 : 0;

    return result as Record<Category | "overall", number>;
  } catch {
    return null;
  }
}

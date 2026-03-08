/**
 * Score Repository
 *
 * Data access layer for employee performance scores. All database operations
 * for CategoryScore, TimePeriod, and KnowledgeScore models are centralized here
 * so that service logic remains free of direct Prisma calls.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Category } from "@/types";

// ─── Filter & Input Types ───

export interface ScoreFilters {
  employeeId?: string;
  category?: Category;
  configVersion?: string;
  minScore?: number;
  maxScore?: number;
}

export interface ScorePaginationOptions {
  page?: number;
  pageSize?: number;
  orderBy?: "score" | "createdAt" | "category";
  order?: "asc" | "desc";
}

export interface UpsertScoreData {
  employeeId: string;
  periodId: string;
  category: Category;
  rawIndex: number;
  score: number;
  configVersion: string;
  evidence?: string;
  metadata?: string;
}

export interface ScoreRecord {
  id: string;
  employeeId: string;
  periodId: string;
  category: string;
  rawIndex: number;
  score: number;
  configVersion: string;
  evidence: string;
  metadata: string;
  createdAt: Date;
  updatedAt: Date;
  employee?: { id: string; name: string; role: string; team: string };
  period?: { id: string; type: string; label: string; startDate: Date; endDate: Date };
}

export interface PeriodRecord {
  id: string;
  type: string;
  startDate: Date;
  endDate: Date;
  label: string;
  createdAt: Date;
}

// ─── Repository ───

export const scoreRepository = {
  /**
   * Retrieve all scores for a given time period, optionally filtered.
   */
  async getScoresForPeriod(
    periodId: string,
    filters: ScoreFilters = {},
    pagination: ScorePaginationOptions = {},
  ): Promise<{ scores: ScoreRecord[]; total: number }> {
    const where = buildWhereClause({ ...filters, periodId });
    const { skip, take } = buildPagination(pagination);

    const [scores, total] = await Promise.all([
      prisma.categoryScore.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true, role: true, team: true } },
          period: true,
        },
        skip,
        take,
        orderBy: { [pagination.orderBy ?? "createdAt"]: pagination.order ?? "desc" },
      }),
      prisma.categoryScore.count({ where }),
    ]);

    logger.debug("scoreRepository.getScoresForPeriod", { periodId, total });
    return { scores: scores as unknown as ScoreRecord[], total };
  },

  /**
   * Retrieve all scores for a specific employee, optionally filtered by category or period.
   */
  async getScoresForEmployee(
    employeeId: string,
    filters: ScoreFilters = {},
    pagination: ScorePaginationOptions = {},
  ): Promise<{ scores: ScoreRecord[]; total: number }> {
    const where = buildWhereClause({ ...filters, employeeId });
    const { skip, take } = buildPagination(pagination);

    const [scores, total] = await Promise.all([
      prisma.categoryScore.findMany({
        where,
        include: {
          period: true,
        },
        skip,
        take,
        orderBy: { [pagination.orderBy ?? "createdAt"]: pagination.order ?? "desc" },
      }),
      prisma.categoryScore.count({ where }),
    ]);

    logger.debug("scoreRepository.getScoresForEmployee", { employeeId, total });
    return { scores: scores as unknown as ScoreRecord[], total };
  },

  /**
   * Create or update a category score. Uses the unique constraint
   * [employeeId, periodId, category] for upsert matching.
   */
  async upsertScore(data: UpsertScoreData): Promise<ScoreRecord> {
    const result = await prisma.categoryScore.upsert({
      where: {
        employeeId_periodId_category: {
          employeeId: data.employeeId,
          periodId: data.periodId,
          category: data.category,
        },
      },
      create: {
        employeeId: data.employeeId,
        periodId: data.periodId,
        category: data.category,
        rawIndex: data.rawIndex,
        score: data.score,
        configVersion: data.configVersion,
        evidence: data.evidence ?? "[]",
        metadata: data.metadata ?? "{}",
      },
      update: {
        rawIndex: data.rawIndex,
        score: data.score,
        configVersion: data.configVersion,
        ...(data.evidence !== undefined && { evidence: data.evidence }),
        ...(data.metadata !== undefined && { metadata: data.metadata }),
      },
      include: {
        employee: { select: { id: true, name: true, role: true, team: true } },
        period: true,
      },
    });

    logger.info("scoreRepository.upsertScore", {
      employeeId: data.employeeId,
      periodId: data.periodId,
      category: data.category,
      score: data.score,
    });
    return result as unknown as ScoreRecord;
  },

  /**
   * Get the most recent time period of a given type (week, month, quarter).
   */
  async getLatestPeriod(type: string): Promise<PeriodRecord | null> {
    const period = await prisma.timePeriod.findFirst({
      where: { type },
      orderBy: { endDate: "desc" },
    });
    return period as PeriodRecord | null;
  },

  /**
   * Get the time period immediately before a reference date, for the given type.
   */
  async getPreviousPeriod(type: string, before: Date): Promise<PeriodRecord | null> {
    const period = await prisma.timePeriod.findFirst({
      where: {
        type,
        endDate: { lt: before },
      },
      orderBy: { endDate: "desc" },
    });
    return period as PeriodRecord | null;
  },

  /**
   * Get score history for a specific employee and category, ordered newest first.
   * Useful for trend analysis and sparkline charts.
   */
  async getScoreHistory(
    employeeId: string,
    category: Category,
    limit = 12,
  ): Promise<ScoreRecord[]> {
    const scores = await prisma.categoryScore.findMany({
      where: { employeeId, category },
      include: { period: true },
      orderBy: { period: { endDate: "desc" } },
      take: limit,
    });

    logger.debug("scoreRepository.getScoreHistory", { employeeId, category, count: scores.length });
    return scores as unknown as ScoreRecord[];
  },

  /**
   * Get a single score by its composite key.
   */
  async getScoreByKey(
    employeeId: string,
    periodId: string,
    category: Category,
  ): Promise<ScoreRecord | null> {
    const score = await prisma.categoryScore.findUnique({
      where: {
        employeeId_periodId_category: {
          employeeId,
          periodId,
          category,
        },
      },
      include: {
        employee: { select: { id: true, name: true, role: true, team: true } },
        period: true,
      },
    });
    return score as unknown as ScoreRecord | null;
  },

  /**
   * Bulk-retrieve all scores for a set of employees in a given period.
   * Used for leaderboard generation and team comparisons.
   */
  async getScoresForEmployees(
    employeeIds: string[],
    periodId: string,
  ): Promise<ScoreRecord[]> {
    const scores = await prisma.categoryScore.findMany({
      where: {
        employeeId: { in: employeeIds },
        periodId,
      },
      include: {
        employee: { select: { id: true, name: true, role: true, team: true } },
        period: true,
      },
      orderBy: [{ employeeId: "asc" }, { category: "asc" }],
    });
    return scores as unknown as ScoreRecord[];
  },
};

// ─── Helpers ───

function buildWhereClause(filters: ScoreFilters & { periodId?: string }): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.periodId) where.periodId = filters.periodId;
  if (filters.employeeId) where.employeeId = filters.employeeId;
  if (filters.category) where.category = filters.category;
  if (filters.configVersion) where.configVersion = filters.configVersion;

  if (filters.minScore !== undefined || filters.maxScore !== undefined) {
    const scoreFilter: Record<string, number> = {};
    if (filters.minScore !== undefined) scoreFilter.gte = filters.minScore;
    if (filters.maxScore !== undefined) scoreFilter.lte = filters.maxScore;
    where.score = scoreFilter;
  }

  return where;
}

function buildPagination(opts: ScorePaginationOptions): { skip: number; take: number } {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  return { skip: (page - 1) * pageSize, take: pageSize };
}

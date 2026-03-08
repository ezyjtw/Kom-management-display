import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

const DEFAULT_CHECK_ITEMS = [
  { name: "Stuck Transactions", category: "stuck_tx", autoCheckKey: "stuck_tx_count" },
  { name: "Balance Variance", category: "balance_variance", autoCheckKey: "balance_variance" },
  { name: "Staking Rewards", category: "staking_rewards", autoCheckKey: "staking_overdue" },
  { name: "Screening Queue", category: "screening", autoCheckKey: "screening_pending" },
  { name: "Travel Rule Cases", category: "travel_rule", autoCheckKey: "travel_rule_open" },
  { name: "Pending Approvals", category: "pending_approvals", autoCheckKey: "pending_approvals" },
  { name: "Scam / Dust Review", category: "scam_dust", autoCheckKey: "scam_dust_pending" },
  { name: "Validator Health", category: "validator_health", autoCheckKey: "" },
  { name: "External Provider Status", category: "external_provider", autoCheckKey: "active_incidents" },
];

/**
 * GET /api/daily-checks?date=2026-03-07
 * Get the daily check run for a given date (defaults to today).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get("date");

    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const end = new Date(start.getTime() + 86400000);

    const run = await prisma.dailyCheckRun.findFirst({
      where: { date: { gte: start, lt: end } },
      include: {
        items: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!run) {
      return apiSuccess(null);
    }

    // Get operator name
    let operatorName = "Unknown";
    try {
      const emp = await prisma.employee.findUnique({ where: { id: run.operatorId }, select: { name: true } });
      if (emp) operatorName = emp.name;
    } catch { /* */ }

    const items = run.items;
    return apiSuccess({
      ...run,
      operatorName,
      progress: {
        total: items.length,
        completed: items.filter((i) => i.status !== "pending").length,
        passed: items.filter((i) => i.status === "pass").length,
        issues: items.filter((i) => i.status === "issues_found").length,
      },
    });
  } catch (error) {
    return handleApiError(error, "daily-checks GET");
  }
}

/**
 * POST /api/daily-checks
 * Create a new daily check run for today.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const actorId = auth.employeeId || auth.id;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Check if a run already exists for today
    const existing = await prisma.dailyCheckRun.findFirst({
      where: { date: start },
    });
    if (existing) {
      return apiConflictError("A check run already exists for today");
    }

    const run = await prisma.dailyCheckRun.create({
      data: {
        date: start,
        operatorId: actorId,
        items: {
          create: DEFAULT_CHECK_ITEMS.map((item) => ({
            name: item.name,
            category: item.category,
            autoCheckKey: item.autoCheckKey,
          })),
        },
      },
      include: { items: true },
    });

    return apiSuccess(run, undefined, 201);
  } catch (error) {
    return handleApiError(error, "daily-checks POST");
  }
}

/**
 * PATCH /api/daily-checks
 * Update a check item or the run itself.
 * Body: { itemId, status, notes } or { runId, jiraSummary }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const actorId = auth.employeeId || auth.id;

    if (body.itemId) {
      const { itemId, status, notes } = body;
      const updateData: Record<string, unknown> = {};
      if (status) {
        updateData.status = status;
        updateData.operatorId = actorId;
        updateData.completedAt = status !== "pending" ? new Date() : null;
      }
      if (notes !== undefined) updateData.notes = notes;

      const item = await prisma.dailyCheckItem.update({ where: { id: itemId }, data: updateData });

      // Check if all items are completed → mark run as completed
      const run = await prisma.dailyCheckRun.findUnique({
        where: { id: item.runId },
        include: { items: { select: { status: true } } },
      });
      if (run && run.items.every((i) => i.status !== "pending")) {
        await prisma.dailyCheckRun.update({ where: { id: run.id }, data: { completedAt: new Date() } });
      }

      return apiSuccess(item);
    }

    if (body.runId) {
      const { runId, jiraSummary } = body;
      const run = await prisma.dailyCheckRun.update({
        where: { id: runId },
        data: { jiraSummary: jiraSummary || "" },
      });
      return apiSuccess(run);
    }

    return apiValidationError("itemId or runId required");
  } catch (error) {
    return handleApiError(error, "daily-checks PATCH");
  }
}

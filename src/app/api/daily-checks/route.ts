import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, apiConflictError, apiForbiddenError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, updateDailyCheckPatchSchema } from "@/lib/validation";
import { DailyCheckRuleError, passItem, requestSkip } from "@/modules/daily-checks/enforcement";
import { isRestrictedItemFor } from "@/modules/realisations/access";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

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

  const authz = requireAuthorization(auth, "daily_check", "view");
  if (authz instanceof NextResponse) return authz;

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

  const authz = requireAuthorization(auth, "daily_check", "create");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "daily_check_run_created", entityType: "daily_check_run", entityId: new Date().toISOString().slice(0, 10), userId: auditActorInfo.userId, summary: "Start today's daily check run", metadata: auditActorInfo.metadata },
      async () => {
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
      },
    );
  } catch (error) {
    return handleApiError(error, "daily-checks POST");
  }
}

/**
 * PATCH /api/daily-checks
 * Update a check item or the run itself.
 * Body: { itemId, status, notes, evidence, skippedReason } or { runId, jiraSummary }
 * `pass` needs evidence; `skipped` only requests a skip (a different lead/admin
 * approves it); `issues_found` is set by recording exceptions.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "daily_check", "update");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = validateBody(updateDailyCheckPatchSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const validatedData = parsed.data;
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "daily_check_updated", entityType: "daily_check", entityId: "itemId" in validatedData ? String(validatedData.itemId) : String((validatedData as { runId?: string }).runId ?? "run"), userId: auditActorInfo.userId, summary: "Update a daily check", metadata: auditActorInfo.metadata },
      async () => {
        const actorId = auth.employeeId || auth.id;

        if ("itemId" in validatedData) {
          const { itemId, status, notes, evidence, skippedReason } = validatedData;
          if (await isRestrictedItemFor(itemId, auth)) return NextResponse.json({ success: false, error: "Restricted check: requires realisation:view." }, { status: 403 });
          if (notes !== undefined) await prisma.dailyCheckItem.update({ where: { id: itemId }, data: { notes } });

          // Spec §10.2: every status change goes through the daily-check rules.
          let item;
          if (status === "pass") {
            item = await passItem(itemId, evidence, actorId);
          } else if (status === "skipped") {
            item = await requestSkip(itemId, skippedReason, auth.id);
          } else if (status === "issues_found") {
            return NextResponse.json(
              { success: false, error: "Record the exceptions with POST /api/daily-checks/items/:id/exceptions; each one gets a ticket." },
              { status: 422 },
            );
          } else if (status === "pending") {
            if (auth.role !== "lead" && auth.role !== "admin") return apiForbiddenError("Only leads and admins can reopen a check item");
            item = await prisma.dailyCheckItem.update({
              where: { id: itemId },
              data: { status: "pending", completedAt: null, skippedReason: null, skipRequestedBy: null, skipApprovedBy: null },
            });
            await prisma.dailyCheckRun.update({ where: { id: item.runId }, data: { completedAt: null } });
          } else {
            item = await prisma.dailyCheckItem.findUnique({ where: { id: itemId } });
          }
          return apiSuccess(item);
        }

        if ("runId" in validatedData) {
          const { runId, jiraSummary } = validatedData;
          const run = await prisma.dailyCheckRun.update({
            where: { id: runId },
            data: { jiraSummary: jiraSummary || "" },
          });
          return apiSuccess(run);
        }

        return apiValidationError("itemId or runId required");
      },
    );
  } catch (error) {
    if (error instanceof DailyCheckRuleError) {
      return NextResponse.json({ success: false, error: error.message, issues: error.issues }, { status: error.status });
    }
    return handleApiError(error, "daily-checks PATCH");
  }
}

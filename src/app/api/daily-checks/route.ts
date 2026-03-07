import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

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
      return NextResponse.json({ success: true, data: null });
    }

    // Get operator name
    let operatorName = "Unknown";
    try {
      const emp = await prisma.employee.findUnique({ where: { id: run.operatorId }, select: { name: true } });
      if (emp) operatorName = emp.name;
    } catch { /* */ }

    const items = run.items;
    return NextResponse.json({
      success: true,
      data: {
        ...run,
        operatorName,
        progress: {
          total: items.length,
          completed: items.filter((i) => i.status !== "pending").length,
          passed: items.filter((i) => i.status === "pass").length,
          issues: items.filter((i) => i.status === "issues_found").length,
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/daily-checks
 * Create a new daily check run for today.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const actorId = auth.employeeId || auth.id;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Check if a run already exists for today
    const existing = await prisma.dailyCheckRun.findFirst({
      where: { date: start },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "A check run already exists for today" },
        { status: 409 },
      );
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

    return NextResponse.json({ success: true, data: run }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
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

      return NextResponse.json({ success: true, data: item });
    }

    if (body.runId) {
      const { runId, jiraSummary } = body;
      const run = await prisma.dailyCheckRun.update({
        where: { id: runId },
        data: { jiraSummary: jiraSummary || "" },
      });
      return NextResponse.json({ success: true, data: run });
    }

    return NextResponse.json({ success: false, error: "itemId or runId required" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

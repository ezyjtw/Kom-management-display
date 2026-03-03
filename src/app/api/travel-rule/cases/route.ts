import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import { TRAVEL_RULE_SLA } from "@/lib/sla";

/**
 * GET /api/travel-rule/cases
 * List travel rule cases with optional filters.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const owner = searchParams.get("owner");
    const matchStatus = searchParams.get("matchStatus");

    const overdue = searchParams.get("overdue");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (matchStatus) where.matchStatus = matchStatus;
    if (owner === "me") {
      where.ownerUserId = auth.employeeId || auth.id;
    } else if (owner) {
      where.ownerUserId = owner;
    }
    if (overdue === "true") {
      where.status = { not: "Resolved" };
      where.createdAt = {
        lt: new Date(Date.now() - TRAVEL_RULE_SLA.resolution * 3_600_000),
      };
    }

    const cases = await prisma.travelRuleCase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ success: true, data: cases });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/travel-rule/cases
 * Create a new travel rule case from a reconciliation gap.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      transactionId,
      txHash,
      direction,
      asset,
      amount,
      senderAddress,
      receiverAddress,
      matchStatus,
      notabeneTransferId,
      ownerUserId,
    } = body;

    if (!transactionId || !matchStatus) {
      return NextResponse.json(
        { success: false, error: "transactionId and matchStatus are required" },
        { status: 400 },
      );
    }

    // Avoid duplicate cases
    const existing = await prisma.travelRuleCase.findUnique({
      where: {
        transactionId_matchStatus: { transactionId, matchStatus },
      },
    });

    if (existing) {
      return NextResponse.json({ success: true, data: existing });
    }

    const now = new Date();
    const slaDeadline = new Date(now.getTime() + TRAVEL_RULE_SLA.resolution * 3_600_000);

    const travelCase = await prisma.travelRuleCase.create({
      data: {
        transactionId,
        txHash: txHash || "",
        direction: direction || "",
        asset: asset || "",
        amount: amount || 0,
        senderAddress: senderAddress || "",
        receiverAddress: receiverAddress || "",
        matchStatus,
        notabeneTransferId: notabeneTransferId || null,
        ownerUserId: ownerUserId || null,
        status: ownerUserId ? "Investigating" : "Open",
        slaDeadline,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "travel_rule_case_created",
        entityType: "travel_rule_case",
        entityId: travelCase.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          transactionId,
          matchStatus,
          ownerUserId: ownerUserId || null,
        }),
      },
    });

    return NextResponse.json({ success: true, data: travelCase }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

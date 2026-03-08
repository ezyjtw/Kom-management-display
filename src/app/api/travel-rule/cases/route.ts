import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { TRAVEL_RULE_SLA } from "@/lib/sla";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

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
    // ?overdue=true filters to unresolved cases older than the SLA deadline (48h).
    // Uses createdAt rather than slaDeadline so it works even for cases
    // created before the slaDeadline column was added.
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

    return apiSuccess(cases);
  } catch (error) {
    return handleApiError(error, "GET /api/travel-rule/cases");
  }
}

/**
 * POST /api/travel-rule/cases
 * Create a new travel rule case from a reconciliation gap.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

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
      return apiValidationError("transactionId and matchStatus are required");
    }

    // Uniqueness is enforced by transactionId + matchStatus compound key.
    // If a case already exists for this combination, return it rather than
    // creating a duplicate (idempotent create pattern).
    const existing = await prisma.travelRuleCase.findUnique({
      where: {
        transactionId_matchStatus: { transactionId, matchStatus },
      },
    });

    if (existing) {
      return apiSuccess(existing);
    }

    // SLA deadline is createdAt + 48 hours — displayed on the case detail page
    const now = new Date();
    const slaDeadline = new Date(now.getTime() + TRAVEL_RULE_SLA.resolution * 3_600_000);

    const [travelCase] = await prisma.$transaction([
      prisma.travelRuleCase.create({
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
      }),
      prisma.auditLog.create({
        data: {
          action: "travel_rule_case_created",
          entityType: "travel_rule_case",
          entityId: "pending",
          userId: auth.employeeId || auth.id,
          details: JSON.stringify({
            transactionId,
            matchStatus,
            ownerUserId: ownerUserId || null,
          }),
        },
      }),
    ]);

    return apiSuccess(travelCase, undefined, 201);
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/cases");
  }
}

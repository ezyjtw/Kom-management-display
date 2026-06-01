import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization, maskSensitiveFields } from "@/modules/auth/services/authorization";
import { TRAVEL_RULE_SLA } from "@/lib/sla";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, createTravelRuleCaseSchema } from "@/lib/validation";

/**
 * GET /api/travel-rule/cases
 * List travel rule cases with optional filters.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const owner = searchParams.get("owner");
    const matchStatus = searchParams.get("matchStatus");

    const overdue = searchParams.get("overdue");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (matchStatus) where.matchStatus = matchStatus;

    // Server-side scope enforcement — prevents bulk data exfiltration by
    // restricting list results to the caller's authorization scope.
    const actorId = auth.employeeId || auth.id;
    switch (authz.scope) {
      case "own":
        // Employees see their own cases + unowned (available for pickup)
        where.OR = [{ ownerUserId: actorId }, { ownerUserId: null }];
        break;
      case "team": {
        if (auth.team) {
          const teamIds = (await prisma.employee.findMany({
            where: { team: auth.team as never },
            select: { id: true },
          })).map(e => e.id);
          if (owner === "me") {
            where.ownerUserId = actorId;
          } else if (owner && teamIds.includes(owner)) {
            where.ownerUserId = owner;
          } else {
            where.OR = [{ ownerUserId: { in: teamIds } }, { ownerUserId: null }];
          }
        }
        break;
      }
      case "all":
        if (owner === "me") {
          where.ownerUserId = actorId;
        } else if (owner) {
          where.ownerUserId = owner;
        }
        break;
      case "none":
        return apiSuccess([]);
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

    const maskedCases = cases.map(c =>
      maskSensitiveFields(c, "travel_rule_case", auth.role, {
        isOwner: c.ownerUserId === actorId,
      }),
    );

    return apiSuccess(maskedCases);
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

  const authzPost = requireAuthorization(auth, "travel_rule_case", "create");
  if (authzPost instanceof NextResponse) return authzPost;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = validateBody(createTravelRuleCaseSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
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

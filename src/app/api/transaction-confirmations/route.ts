import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import {
  createTransactionConfirmation,
  acknowledgeConfirmation,
  signOffConfirmation,
  escalateConfirmation,
  assessRiskLevel,
} from "@/lib/transaction-confirmation";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { emitHighRiskTransaction } from "@/lib/sse";

/**
 * GET /api/transaction-confirmations
 * List transaction confirmations with optional filters.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const riskLevel = searchParams.get("riskLevel");
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (riskLevel) where.riskLevel = riskLevel;

    const [confirmations, total] = await Promise.all([
      prisma.transactionConfirmation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.transactionConfirmation.count({ where }),
    ]);

    // Summary stats
    const summary = {
      pending: await prisma.transactionConfirmation.count({ where: { status: "pending" } }),
      acknowledged: await prisma.transactionConfirmation.count({ where: { status: "acknowledged" } }),
      signedOff: await prisma.transactionConfirmation.count({ where: { status: "signed_off" } }),
      escalated: await prisma.transactionConfirmation.count({ where: { status: "escalated" } }),
      expired: await prisma.transactionConfirmation.count({ where: { status: "expired" } }),
    };

    return apiSuccess({
      confirmations,
      summary,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    return handleApiError(error, "transaction-confirmations GET");
  }
}

/**
 * POST /api/transaction-confirmations
 * Create a new transaction confirmation or perform an action on an existing one.
 * Body: { action: "create" | "acknowledge" | "sign_off" | "escalate", ... }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return apiValidationError("action is required (create, acknowledge, sign_off, escalate)");
    }

    const actorId = auth.employeeId || auth.id;

    switch (action) {
      case "create": {
        const { transactionId, asset, amount, direction, account, workspace, requestId } = body;
        if (!transactionId || !asset || amount === undefined || !direction) {
          return apiValidationError("transactionId, asset, amount, and direction are required");
        }

        const riskLevel = body.riskLevel ?? assessRiskLevel({ amount, asset, direction });
        const result = await createTransactionConfirmation({
          transactionId,
          requestId,
          asset,
          amount,
          direction,
          account,
          workspace,
          riskLevel,
        });

        // Push SSE event for medium+ risk
        if (riskLevel !== "low") {
          emitHighRiskTransaction({
            confirmationId: result.id,
            transactionId,
            asset,
            amount,
            riskLevel,
          });
        }

        return apiSuccess(result, undefined, 201);
      }

      case "acknowledge": {
        if (!body.confirmationId) return apiValidationError("confirmationId is required");
        await acknowledgeConfirmation(body.confirmationId, actorId);
        return apiSuccess({ acknowledged: true });
      }

      case "sign_off": {
        // Only admin/lead can sign off
        const roleCheck = await requireRole("admin", "lead");
        if (roleCheck instanceof NextResponse) return roleCheck;

        if (!body.confirmationId) return apiValidationError("confirmationId is required");
        await signOffConfirmation(body.confirmationId, actorId);
        return apiSuccess({ signedOff: true });
      }

      case "escalate": {
        if (!body.confirmationId || !body.reason) {
          return apiValidationError("confirmationId and reason are required");
        }
        await escalateConfirmation(body.confirmationId, actorId, body.reason);
        return apiSuccess({ escalated: true });
      }

      default:
        return apiValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    return handleApiError(error, "transaction-confirmations POST");
  }
}

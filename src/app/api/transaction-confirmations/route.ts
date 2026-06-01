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
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { validateBody, transactionConfirmationPostSchema } from "@/lib/validation";

/**
 * GET /api/transaction-confirmations
 * List transaction confirmations with optional filters.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "transaction_confirmation", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const riskLevel = searchParams.get("riskLevel");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50") || 50));

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
    const parsed = validateBody(transactionConfirmationPostSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const validatedData = parsed.data;

    const actorId = auth.employeeId || auth.id;

    switch (validatedData.action) {
      case "create": {
        const riskLevel = validatedData.riskLevel ?? assessRiskLevel({
          amount: validatedData.amount,
          asset: validatedData.asset,
          direction: validatedData.direction,
        });
        const result = await createTransactionConfirmation({
          transactionId: validatedData.transactionId,
          requestId: validatedData.requestId,
          asset: validatedData.asset,
          amount: validatedData.amount,
          direction: validatedData.direction,
          account: validatedData.account,
          workspace: validatedData.workspace,
          riskLevel,
        });

        if (riskLevel !== "low") {
          emitHighRiskTransaction({
            confirmationId: result.id,
            transactionId: validatedData.transactionId,
            asset: validatedData.asset,
            amount: validatedData.amount,
            riskLevel,
          });
        }

        return apiSuccess(result, undefined, 201);
      }

      case "acknowledge": {
        await acknowledgeConfirmation(validatedData.confirmationId, actorId);
        return apiSuccess({ acknowledged: true });
      }

      case "sign_off": {
        const roleCheck = await requireRole("admin", "lead");
        if (roleCheck instanceof NextResponse) return roleCheck;

        await signOffConfirmation(validatedData.confirmationId, actorId);
        return apiSuccess({ signedOff: true });
      }

      case "escalate": {
        await escalateConfirmation(validatedData.confirmationId, actorId, validatedData.reason);
        return apiSuccess({ escalated: true });
      }

      default:
        return apiValidationError("Unknown action");
    }
  } catch (error) {
    return handleApiError(error, "transaction-confirmations POST");
  }
}

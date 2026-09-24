import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import {
  createTransactionConfirmation,
  takeOwnership,
  addNote,
  linkTicket,
} from "@/lib/transaction-confirmation";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { emitHighRiskTransaction } from "@/lib/sse";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { validateBody, transactionConfirmationPostSchema } from "@/lib/validation";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

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

    const summary = {
      pending: await prisma.transactionConfirmation.count({ where: { status: "pending" } }),
      owned: await prisma.transactionConfirmation.count({ where: { status: "owned" } }),
      closedInSource: await prisma.transactionConfirmation.count({ where: { status: "closed_in_source" } }),
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
 * Record a GX-flagged item, or perform one of the allowed human actions:
 * take_ownership, add_note, link_ticket. Nothing here approves a transaction (H1).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "transaction_confirmation_action", entityType: "transaction_confirmation", entityId: new URL(request.url).pathname, userId: auditActorInfo.userId, summary: "Transaction confirmation action", metadata: auditActorInfo.metadata },
      async () => {
        const body = await request.json();
        const parsed = validateBody(transactionConfirmationPostSchema, body);
        if (!parsed.success) return apiValidationError(parsed.error);
        const validatedData = parsed.data;

        const actorId = auth.employeeId || auth.id;

        const requiredAction = validatedData.action === "create"
          ? "create"
          : validatedData.action === "take_ownership" ? "acknowledge" : "update";
        const authz = requireAuthorization(auth, "transaction_confirmation", requiredAction);
        if (authz instanceof NextResponse) return authz;

        switch (validatedData.action) {
          case "create": {
            const result = await createTransactionConfirmation({
              transactionId: validatedData.transactionId,
              requestId: validatedData.requestId,
              asset: validatedData.asset,
              amount: validatedData.amount,
              direction: validatedData.direction,
              account: validatedData.account,
              workspace: validatedData.workspace,
              riskLevel: validatedData.riskLevel,
            });

            if (result.riskLevel === "high" || result.riskLevel === "critical") {
              emitHighRiskTransaction({
                confirmationId: result.id,
                transactionId: validatedData.transactionId,
                asset: validatedData.asset,
                amount: validatedData.amount,
                riskLevel: result.riskLevel,
              });
            }

            return apiSuccess(result, undefined, 201);
          }

          case "take_ownership":
            await takeOwnership(validatedData.confirmationId, actorId);
            return apiSuccess({ owned: true });

          case "add_note":
            await addNote(validatedData.confirmationId, actorId, validatedData.note);
            return apiSuccess({ noteAdded: true });

          case "link_ticket":
            await linkTicket(validatedData.confirmationId, actorId, validatedData.ticketRef);
            return apiSuccess({ ticketLinked: true });
        }
      },
    );
  } catch (error) {
    return handleApiError(error, "transaction-confirmations POST");
  }
}

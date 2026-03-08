import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import {
  approveRequest,
  fetchRequest,
  fetchTransaction,
  isKomainuConfigured,
} from "@/lib/integrations/komainu";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * POST /api/travel-rule/cases/:id/approve-api
 *
 * Submits an API approval for the Komainu transaction linked to this case.
 * Sets the case status to "PendingResponse" while the API processes.
 *
 * Body: { requestId: string }
 *   The Komainu request ID to approve.
 *
 * Or: { action: "check_status" }
 *   Polls the current Komainu request/transaction status.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    if (!isKomainuConfigured()) {
      return apiValidationError("Komainu API is not configured");
    }

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    const body = await request.json();
    const actorId = auth.employeeId || auth.id;

    // ── Check status action ──
    if (body.action === "check_status") {
      // Check the Komainu transaction status
      let txStatus = "unknown";
      let requestStatus = "unknown";

      try {
        const tx = await fetchTransaction(travelCase.transactionId);
        txStatus = tx.status;
      } catch {
        // Transaction may not be directly fetchable
      }

      // If a request ID was stored, check that too
      if (body.requestId) {
        try {
          const req = await fetchRequest(body.requestId);
          requestStatus = req.status;
        } catch {
          // Request may no longer exist
        }
      }

      const isApproved = txStatus === "BROADCASTED" || txStatus === "CONFIRMED" || requestStatus === "APPROVED";
      const isFailed = txStatus === "FAILED" || requestStatus === "REJECTED" || requestStatus === "EXPIRED" || requestStatus === "CANCELLED";

      // Auto-update case status if approval completed
      if (isApproved && travelCase.status === "PendingResponse") {
        await prisma.$transaction([
          prisma.travelRuleCase.update({
            where: { id: params.id },
            data: { status: "Investigating" },
          }),
          prisma.auditLog.create({
            data: {
              action: "travel_rule_case_updated",
              entityType: "travel_rule_case",
              entityId: params.id,
              userId: actorId,
              details: JSON.stringify({
                description: "API approval confirmed — transaction approved",
                txStatus,
                requestStatus,
              }),
            },
          }),
        ]);
      }

      if (isFailed && travelCase.status === "PendingResponse") {
        await prisma.$transaction([
          prisma.travelRuleCase.update({
            where: { id: params.id },
            data: { status: "Investigating" },
          }),
          prisma.auditLog.create({
            data: {
              action: "travel_rule_case_updated",
              entityType: "travel_rule_case",
              entityId: params.id,
              userId: actorId,
              details: JSON.stringify({
                description: `API approval failed — ${requestStatus !== "unknown" ? requestStatus : txStatus}`,
                txStatus,
                requestStatus,
              }),
            },
          }),
        ]);
      }

      return apiSuccess({
        txStatus,
        requestStatus,
        isApproved,
        isFailed,
        caseStatus: isApproved || isFailed ? "Investigating" : travelCase.status,
      });
    }

    // ── Submit approval action ──
    if (!body.requestId) {
      return apiValidationError("requestId is required");
    }

    // Call the Komainu API to approve
    const approvalResult = await approveRequest(body.requestId);

    // Set case to AwaitingApproval
    const [updated] = await prisma.$transaction([
      prisma.travelRuleCase.update({
        where: { id: params.id },
        data: { status: "PendingResponse" },
      }),
      prisma.auditLog.create({
        data: {
          action: "travel_rule_case_updated",
          entityType: "travel_rule_case",
          entityId: params.id,
          userId: actorId,
          details: JSON.stringify({
            description: `API approval submitted for request ${body.requestId}`,
            requestId: body.requestId,
            komainuStatus: approvalResult.status,
          }),
        },
      }),
    ]);

    return apiSuccess({
      ...updated,
      requestId: body.requestId,
      komainuStatus: approvalResult.status,
    });
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/cases/[id]/approve-api");
  }
}

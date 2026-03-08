import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import {
  approveRequest,
  fetchRequest,
  fetchTransaction,
  isKomainuConfigured,
} from "@/lib/integrations/komainu";

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

  try {
    if (!isKomainuConfigured()) {
      return NextResponse.json(
        { success: false, error: "Komainu API is not configured" },
        { status: 400 },
      );
    }

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return NextResponse.json(
        { success: false, error: "Case not found" },
        { status: 404 },
      );
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
        await prisma.travelRuleCase.update({
          where: { id: params.id },
          data: { status: "Investigating" },
        });
        await prisma.auditLog.create({
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
        });
      }

      if (isFailed && travelCase.status === "PendingResponse") {
        await prisma.travelRuleCase.update({
          where: { id: params.id },
          data: { status: "Investigating" },
        });
        await prisma.auditLog.create({
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
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          txStatus,
          requestStatus,
          isApproved,
          isFailed,
          caseStatus: isApproved || isFailed ? "Investigating" : travelCase.status,
        },
      });
    }

    // ── Submit approval action ──
    if (!body.requestId) {
      return NextResponse.json(
        { success: false, error: "requestId is required" },
        { status: 400 },
      );
    }

    // Call the Komainu API to approve
    const approvalResult = await approveRequest(body.requestId);

    // Set case to AwaitingApproval
    const updated = await prisma.travelRuleCase.update({
      where: { id: params.id },
      data: { status: "PendingResponse" },
    });

    await prisma.auditLog.create({
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
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        requestId: body.requestId,
        komainuStatus: approvalResult.status,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

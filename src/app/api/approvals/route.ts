import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { isKomainuConfigured, fetchPendingRequests } from "@/lib/integrations/komainu";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * Categorize a pending request into a swimlane and risk level.
 */
function categorizeRequest(req: {
  type: string;
  entity: string;
  requested_at: string;
  expires_at: string;
}): { lane: string; riskLevel: string; ageMinutes: number } {
  const ageMinutes = Math.round((Date.now() - new Date(req.requested_at).getTime()) / 60000);

  // Risk scoring: high if > 60 min old, or if collateral operation
  let riskLevel = "medium";
  if (ageMinutes > 60 || req.type.includes("COLLATERAL")) riskLevel = "high";
  if (ageMinutes < 10 && req.type === "CREATE_TRANSACTION") riskLevel = "low";

  // Lane assignment
  let lane = "ops_approval";
  if (riskLevel === "low" && ageMinutes < 5) lane = "auto_approve";
  if (req.type.includes("COLLATERAL") || riskLevel === "high") lane = "compliance_review";

  return { lane, riskLevel, ageMinutes };
}

/**
 * GET /api/approvals
 * Fetch pending requests from Komainu API, categorize them, and return with audit trail.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    if (!isKomainuConfigured()) {
      return apiSuccess({ items: [], summary: { total: 0, autoApprove: 0, opsApproval: 0, complianceReview: 0 }, configured: false });
    }

    const result = await fetchPendingRequests();
    const items = result.data.map((req) => {
      const { lane, riskLevel, ageMinutes } = categorizeRequest({
        type: req.type,
        entity: req.entity,
        requested_at: req.requested_at,
        expires_at: req.expires_at,
      });
      return { ...req, lane, riskLevel, ageMinutes };
    });

    return apiSuccess({
      items,
      summary: {
        total: items.length,
        autoApprove: items.filter((i) => i.lane === "auto_approve").length,
        opsApproval: items.filter((i) => i.lane === "ops_approval").length,
        complianceReview: items.filter((i) => i.lane === "compliance_review").length,
      },
      configured: true,
    });
  } catch (error) {
    return handleApiError(error, "approvals GET");
  }
}

/**
 * POST /api/approvals
 * Perform an action on a pending request: approve, escalate, or flag_stuck.
 * Body: { requestId, action, notes? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { requestId, action, notes } = body;

    if (!requestId || !action) {
      return apiValidationError("requestId and action are required");
    }

    const actorId = auth.employeeId || auth.id;

    if (action === "approved" && isKomainuConfigured()) {
      const { approveRequest } = await import("@/lib/integrations/komainu");
      await approveRequest(requestId);
    }

    // Log the audit entry
    await prisma.$transaction([
      prisma.approvalAuditEntry.create({
        data: {
          requestId,
          action,
          performedById: actorId,
          riskLevel: body.riskLevel || "medium",
          notes: notes || "",
        },
      }),
      prisma.auditLog.create({
        data: {
          action: `approval_${action}`,
          entityType: "approval",
          entityId: requestId,
          userId: actorId,
          details: JSON.stringify({ action, notes }),
        },
      }),
    ]);

    return apiSuccess(undefined, undefined, 201);
  } catch (error) {
    return handleApiError(error, "approvals POST");
  }
}

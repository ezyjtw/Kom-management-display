import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization, requireRecordAccess, maskSensitiveFields } from "@/modules/auth/services/authorization";
import { sendTravelRuleEmail } from "@/lib/travel-rule-email";
import { apiSuccess, apiValidationError, apiForbiddenError, apiNotFoundError, apiConflictError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, updateTravelRuleCaseSchema } from "@/lib/validation";

const TRAVEL_RULE_TRANSITIONS: Record<string, string[]> = {
  Open: ["Investigating", "PendingResponse", "Escalated", "Resolved"],
  Investigating: ["PendingResponse", "Escalated", "Resolved"],
  PendingResponse: ["Investigating", "Escalated", "Resolved"],
  Escalated: ["Investigating", "Resolved"],
  Resolved: [],
};

/**
 * GET /api/travel-rule/cases/:id
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    // Resolve owner name (and team, for object-level scope checks)
    let ownerName: string | null = null;
    let ownerTeam: string | null = null;
    if (travelCase.ownerUserId) {
      const emp = await prisma.employee.findUnique({
        where: { id: travelCase.ownerUserId },
        select: { name: true, team: true },
      });
      ownerName = emp?.name ?? null;
      ownerTeam = emp?.team ?? null;
    }

    // Object-level authorization: a junior employee (scope "own") must not be
    // able to read regulated cases owned by someone else. Unowned cases remain
    // visible so they can be picked up (mirrors the PATCH claim semantics).
    if (travelCase.ownerUserId) {
      const accessError = requireRecordAccess(auth, authz.scope, {
        ownerId: travelCase.ownerUserId,
        team: ownerTeam,
      });
      if (accessError) return accessError;
    }

    // Mask sensitive counterparty/PII fields — exempt the case owner who
    // legitimately needs senderAddress/receiverAddress for their workflow
    const actorId = auth.employeeId || auth.id;
    const safeCase = maskSensitiveFields(travelCase, "travel_rule_case", auth.role, {
      isOwner: travelCase.ownerUserId === actorId,
    });

    return apiSuccess({ ...safeCase, ownerName });
  } catch (error) {
    return handleApiError(error, "GET /api/travel-rule/cases/[id]");
  }
}

/**
 * PATCH /api/travel-rule/cases/:id
 *
 * Actions:
 *   - Assign owner: { ownerUserId }
 *   - Change status: { status }
 *   - Resolve: { status: "Resolved", resolutionType, resolutionNote }
 *   - Send email: { action: "send_email", recipientEmail, recipientName? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authzPatch = requireAuthorization(auth, "travel_rule_case", "update");
  if (authzPatch instanceof NextResponse) return authzPatch;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = validateBody(updateTravelRuleCaseSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const validatedBody = parsed.data;
    const actorId = auth.employeeId || auth.id;

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    // Object-level scope check for owned cases
    const isPrivileged = ["admin", "lead"].includes(auth.role);
    if (travelCase.ownerUserId) {
      const ownerEmp = await prisma.employee.findUnique({
        where: { id: travelCase.ownerUserId },
        select: { team: true },
      });
      const accessError = requireRecordAccess(auth, authzPatch.scope, {
        ownerId: travelCase.ownerUserId,
        team: ownerEmp?.team ?? null,
      });
      if (accessError) return accessError;
    } else if (!isPrivileged) {
      const isClaim = validatedBody.ownerUserId === actorId && Object.keys(validatedBody).filter(k => k !== "ownerUserId").length === 0;
      if (!isClaim) {
        return apiForbiddenError("Unowned cases can only be claimed, not modified directly");
      }
    }

    // Handle send_email action
    if (validatedBody.action === "send_email") {
      if (!validatedBody.recipientEmail) {
        return apiValidationError("recipientEmail is required");
      }

      await sendTravelRuleEmail({
        recipientEmail: validatedBody.recipientEmail,
        recipientName: validatedBody.recipientName || "",
        travelCase,
        senderName: auth.name || "Ops Team",
      });

      const [updated] = await prisma.$transaction([
        prisma.travelRuleCase.update({
          where: { id: params.id },
          data: {
            status: "PendingResponse",
            emailSentTo: validatedBody.recipientEmail,
            emailSentAt: new Date(),
          },
        }),
        prisma.auditLog.create({
          data: {
            action: "travel_rule_email_sent",
            entityType: "travel_rule_case",
            entityId: params.id,
            userId: actorId,
            details: JSON.stringify({
              description: `Email sent to ${validatedBody.recipientEmail}`,
              recipientEmail: validatedBody.recipientEmail,
              matchStatus: travelCase.matchStatus,
              transactionId: travelCase.transactionId,
            }),
          },
        }),
      ]);

      return apiSuccess(updated);
    }

    // Build update data
    const updateFields: Record<string, unknown> = {};
    const auditDetails: Record<string, unknown> = {};

    if (validatedBody.ownerUserId !== undefined) {
      let newOwnerName = "Unassigned";
      if (validatedBody.ownerUserId) {
        const emp = await prisma.employee.findUnique({
          where: { id: validatedBody.ownerUserId },
          select: { name: true },
        });
        if (!emp) {
          return apiValidationError("Invalid employee ID");
        }
        newOwnerName = emp.name;
      }
      updateFields.ownerUserId = validatedBody.ownerUserId || null;

      auditDetails.ownerChange = {
        previous: travelCase.ownerUserId,
        new: validatedBody.ownerUserId,
        newName: newOwnerName,
      };
      auditDetails.description = `Assigned to ${newOwnerName}`;

      if (validatedBody.ownerUserId && travelCase.status === "Open") {
        updateFields.status = "Investigating";
      }
    }

    if (validatedBody.status) {
      const allowed = TRAVEL_RULE_TRANSITIONS[travelCase.status] ?? [];
      if (!allowed.includes(validatedBody.status)) {
        return apiConflictError(
          `Cannot transition from "${travelCase.status}" to "${validatedBody.status}". ` +
          `Allowed: ${allowed.length ? allowed.join(", ") : "none (case is terminal)"}.`
        );
      }
      updateFields.status = validatedBody.status;
      auditDetails.statusChange = {
        previous: travelCase.status,
        new: validatedBody.status,
      };
      auditDetails.description = `Status: ${travelCase.status} → ${validatedBody.status}`;
      if (validatedBody.status === "Resolved") {
        updateFields.resolvedAt = new Date();
        updateFields.resolutionType = validatedBody.resolutionType || null;
        updateFields.resolutionNote = validatedBody.resolutionNote || "";
        const typeLabel = validatedBody.resolutionType === "info_obtained" ? "Information Obtained"
          : validatedBody.resolutionType === "email_sent" ? "Resolved via Email"
          : validatedBody.resolutionType === "not_required" ? "Travel Rule Not Required"
          : validatedBody.resolutionType === "escalated" ? "Escalated"
          : validatedBody.resolutionType || "Resolved";
        auditDetails.description = `Resolved — ${typeLabel}`;
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return apiSuccess(travelCase);
    }

    // Optimistic locking: reject stale writes
    if (validatedBody.updatedAt) {
      const clientUpdatedAt = new Date(validatedBody.updatedAt).getTime();
      const serverUpdatedAt = travelCase.updatedAt
        ? new Date(travelCase.updatedAt).getTime()
        : 0;
      if (clientUpdatedAt < serverUpdatedAt) {
        return apiConflictError(
          "This case was modified by another user. Please refresh and try again."
        );
      }
    }

    const updated = await prisma.travelRuleCase.update({
      where: { id: params.id },
      data: updateFields,
    });

    if (Object.keys(auditDetails).length > 0) {
      await prisma.auditLog.create({
        data: {
          action: "travel_rule_case_updated",
          entityType: "travel_rule_case",
          entityId: params.id,
          userId: actorId,
          details: JSON.stringify(auditDetails),
        },
      });
    }

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "PATCH /api/travel-rule/cases/[id]");
  }
}

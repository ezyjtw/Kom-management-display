import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { sendTravelRuleEmail } from "@/lib/travel-rule-email";
import { apiSuccess, apiValidationError, apiForbiddenError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/travel-rule/cases/:id
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    // Resolve owner name
    let ownerName: string | null = null;
    if (travelCase.ownerUserId) {
      const emp = await prisma.employee.findUnique({
        where: { id: travelCase.ownerUserId },
        select: { name: true },
      });
      ownerName = emp?.name ?? null;
    }

    // Look up VASP contact if we have a Notabene transfer
    let vaspContact = null;
    if (travelCase.notabeneTransferId) {
      // Try to find by the transfer's counterparty VASP
      // For now return all contacts so the UI can pick one
      vaspContact = null;
    }

    return apiSuccess({ ...travelCase, ownerName });
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

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const actorId = auth.employeeId || auth.id;

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    // RBAC: owner, lead, admin can update
    const isPrivileged = ["admin", "lead"].includes(auth.role);
    const isOwner = travelCase.ownerUserId === actorId;
    if (!isPrivileged && !isOwner && travelCase.ownerUserId) {
      return apiForbiddenError("Only the assigned owner or a lead/admin can update this case");
    }

    // Handle send_email action
    if (body.action === "send_email") {
      if (!body.recipientEmail) {
        return apiValidationError("recipientEmail is required");
      }

      await sendTravelRuleEmail({
        recipientEmail: body.recipientEmail,
        recipientName: body.recipientName || "",
        travelCase,
        senderName: auth.name || "Ops Team",
      });

      const [updated] = await prisma.$transaction([
        prisma.travelRuleCase.update({
          where: { id: params.id },
          data: {
            status: "PendingResponse",
            emailSentTo: body.recipientEmail,
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
              description: `Email sent to ${body.recipientEmail}`,
              recipientEmail: body.recipientEmail,
              matchStatus: travelCase.matchStatus,
              transactionId: travelCase.transactionId,
            }),
          },
        }),
      ]);

      return apiSuccess(updated);
    }

    // Build update data
    const data: Record<string, unknown> = {};
    const auditDetails: Record<string, unknown> = {};

    if (body.ownerUserId !== undefined) {
      // Validate employee exists before assignment
      let newOwnerName = "Unassigned";
      if (body.ownerUserId) {
        const emp = await prisma.employee.findUnique({
          where: { id: body.ownerUserId },
          select: { name: true },
        });
        if (!emp) {
          return apiValidationError("Invalid employee ID");
        }
        newOwnerName = emp.name;
      }
      data.ownerUserId = body.ownerUserId || null;

      auditDetails.ownerChange = {
        previous: travelCase.ownerUserId,
        new: body.ownerUserId,
        newName: newOwnerName,
      };
      auditDetails.description = `Assigned to ${newOwnerName}`;

      // Auto-move from Open to Investigating when assigned
      if (body.ownerUserId && travelCase.status === "Open") {
        data.status = "Investigating";
      }
    }

    if (body.status) {
      data.status = body.status;
      auditDetails.statusChange = {
        previous: travelCase.status,
        new: body.status,
      };
      auditDetails.description = `Status: ${travelCase.status} → ${body.status}`;
      if (body.status === "Resolved") {
        data.resolvedAt = new Date();
        data.resolutionType = body.resolutionType || null;
        data.resolutionNote = body.resolutionNote || "";
        const typeLabel = body.resolutionType === "info_obtained" ? "Information Obtained"
          : body.resolutionType === "email_sent" ? "Resolved via Email"
          : body.resolutionType === "not_required" ? "Travel Rule Not Required"
          : body.resolutionType === "escalated" ? "Escalated"
          : body.resolutionType || "Resolved";
        auditDetails.description = `Resolved — ${typeLabel}`;
      }
    }

    if (Object.keys(data).length === 0) {
      return apiSuccess(travelCase);
    }

    const updated = await prisma.travelRuleCase.update({
      where: { id: params.id },
      data,
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

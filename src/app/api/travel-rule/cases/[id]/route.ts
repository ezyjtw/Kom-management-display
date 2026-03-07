import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import { sendTravelRuleEmail } from "@/lib/travel-rule-email";

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
      return NextResponse.json(
        { success: false, error: "Case not found" },
        { status: 404 },
      );
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

    return NextResponse.json({
      success: true,
      data: { ...travelCase, ownerName },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
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

  try {
    const body = await request.json();
    const actorId = auth.employeeId || auth.id;

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return NextResponse.json(
        { success: false, error: "Case not found" },
        { status: 404 },
      );
    }

    // RBAC: owner, lead, admin can update
    const isPrivileged = ["admin", "lead"].includes(auth.role);
    const isOwner = travelCase.ownerUserId === actorId;
    if (!isPrivileged && !isOwner && travelCase.ownerUserId) {
      return NextResponse.json(
        { success: false, error: "Only the assigned owner or a lead/admin can update this case" },
        { status: 403 },
      );
    }

    // Handle send_email action
    if (body.action === "send_email") {
      if (!body.recipientEmail) {
        return NextResponse.json(
          { success: false, error: "recipientEmail is required" },
          { status: 400 },
        );
      }

      await sendTravelRuleEmail({
        recipientEmail: body.recipientEmail,
        recipientName: body.recipientName || "",
        travelCase,
        senderName: auth.name || "Ops Team",
      });

      const updated = await prisma.travelRuleCase.update({
        where: { id: params.id },
        data: {
          status: "PendingResponse",
          emailSentTo: body.recipientEmail,
          emailSentAt: new Date(),
        },
      });

      await prisma.auditLog.create({
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
      });

      return NextResponse.json({ success: true, data: updated });
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
          return NextResponse.json(
            { success: false, error: "Invalid employee ID" },
            { status: 400 },
          );
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
      return NextResponse.json({ success: true, data: travelCase });
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

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

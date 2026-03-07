import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/screening
 * List screening entries with filters: ?classification=dust&screeningStatus=submitted&asset=ETH
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const classification = searchParams.get("classification");
    const screeningStatus = searchParams.get("screeningStatus");
    const asset = searchParams.get("asset");

    const where: Record<string, unknown> = {};
    if (classification) where.classification = classification;
    if (screeningStatus) where.screeningStatus = screeningStatus;
    if (asset) where.asset = asset;

    const entries = await prisma.screeningEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const summary = {
      total: entries.length,
      submitted: entries.filter((e) => e.screeningStatus === "submitted").length,
      processing: entries.filter((e) => e.screeningStatus === "processing").length,
      notSubmitted: entries.filter((e) => e.screeningStatus === "not_submitted" && !e.isKnownException).length,
      dust: entries.filter((e) => e.classification === "dust").length,
      scam: entries.filter((e) => e.classification === "scam").length,
      openAlerts: entries.filter((e) => e.analyticsStatus === "open" || e.analyticsStatus === "under_review").length,
    };

    return NextResponse.json({ success: true, data: { entries, summary } });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/screening
 * Create a screening entry.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { transactionId, asset } = body;

    if (!transactionId || !asset) {
      return NextResponse.json({ success: false, error: "transactionId and asset are required" }, { status: 400 });
    }

    const entry = await prisma.screeningEntry.create({
      data: {
        transactionId,
        txHash: body.txHash || "",
        asset,
        amount: body.amount || 0,
        direction: body.direction || "IN",
        screeningStatus: body.screeningStatus || "not_submitted",
        classification: body.classification || "unclassified",
        isKnownException: body.isKnownException || false,
        exceptionReason: body.exceptionReason || "",
        analyticsAlertId: body.analyticsAlertId || "",
        analyticsStatus: body.analyticsStatus || "none",
        complianceReviewStatus: body.complianceReviewStatus || "none",
        notes: body.notes || "",
      },
    });

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/screening
 * Update a screening entry (reclassify, update status, add notes).
 * Body: { id, classification?, screeningStatus?, analyticsStatus?, complianceReviewStatus?, notes? }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const actorId = auth.employeeId || auth.id;
    const updateData: Record<string, unknown> = {};

    if (fields.classification !== undefined) {
      updateData.classification = fields.classification;
      updateData.reclassifiedAt = new Date();
      updateData.reclassifiedById = actorId;
    }
    if (fields.screeningStatus !== undefined) updateData.screeningStatus = fields.screeningStatus;
    if (fields.analyticsStatus !== undefined) updateData.analyticsStatus = fields.analyticsStatus;
    if (fields.complianceReviewStatus !== undefined) updateData.complianceReviewStatus = fields.complianceReviewStatus;
    if (fields.notes !== undefined) updateData.notes = fields.notes;
    if (fields.isKnownException !== undefined) {
      updateData.isKnownException = fields.isKnownException;
      updateData.exceptionReason = fields.exceptionReason || "";
    }

    const entry = await prisma.screeningEntry.update({ where: { id }, data: updateData });

    if (fields.classification !== undefined) {
      await prisma.auditLog.create({
        data: {
          action: "screening_reclassified",
          entityType: "screening",
          entityId: id,
          userId: actorId,
          details: JSON.stringify({ classification: fields.classification }),
        },
      });
    }

    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

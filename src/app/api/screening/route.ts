import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, createScreeningSchema, updateScreeningSchema } from "@/lib/validation";

/**
 * GET /api/screening
 * List screening entries with filters: ?classification=dust&screeningStatus=submitted&asset=ETH
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "screening", "view");
  if (authz instanceof NextResponse) return authz;

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

    return apiSuccess({ entries, summary });
  } catch (error) {
    return handleApiError(error, "screening GET");
  }
}

/**
 * POST /api/screening
 * Create a screening entry.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "screening", "create");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = validateBody(createScreeningSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const data = parsed.data;

    const entry = await prisma.screeningEntry.create({
      data: {
        transactionId: data.transactionId,
        txHash: data.txHash ?? "",
        asset: data.asset,
        amount: data.amount ?? 0,
        direction: data.direction ?? "IN",
        screeningStatus: data.screeningStatus ?? "not_submitted",
        classification: data.classification ?? "unclassified",
        isKnownException: data.isKnownException ?? false,
        exceptionReason: data.exceptionReason ?? "",
        analyticsAlertId: data.analyticsAlertId ?? "",
        analyticsStatus: data.analyticsStatus ?? "none",
        complianceReviewStatus: data.complianceReviewStatus ?? "none",
        notes: data.notes ?? "",
      },
    });

    return apiSuccess(entry, undefined, 201);
  } catch (error) {
    return handleApiError(error, "screening POST");
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

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = validateBody(updateScreeningSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const { id, ...fields } = parsed.data;

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

    const [entry] = await prisma.$transaction([
      prisma.screeningEntry.update({ where: { id }, data: updateData }),
      ...(fields.classification !== undefined
        ? [
            prisma.auditLog.create({
              data: {
                action: "screening_reclassified",
                entityType: "screening",
                entityId: id,
                userId: actorId,
                details: JSON.stringify({ classification: fields.classification }),
              },
            }),
          ]
        : []),
    ]);

    return apiSuccess(entry);
  } catch (error) {
    return handleApiError(error, "screening PATCH");
  }
}

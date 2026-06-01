import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization, requireRecordAccess } from "@/modules/auth/services/authorization";
import { buildHtmlEmail } from "@/lib/travel-rule-email";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { z } from "zod";

/**
 * POST /api/travel-rule/cases/:id/preview-email
 *
 * Returns the rendered HTML email for human review before sending.
 * Does NOT send anything.
 *
 * Body: { recipientEmail, recipientName? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "view");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const _parsed = z.object({}).passthrough().safeParse(body);
    if (!_parsed.success) return apiValidationError(_parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { recipientEmail, recipientName } = body;

    if (!recipientEmail) {
      return apiValidationError("recipientEmail is required");
    }

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    if (travelCase.ownerUserId) {
      const ownerEmp = await prisma.employee.findUnique({
        where: { id: travelCase.ownerUserId },
        select: { team: true },
      });
      const accessError = requireRecordAccess(auth, authz.scope, {
        ownerId: travelCase.ownerUserId,
        team: ownerEmp?.team ?? null,
      });
      if (accessError) return accessError;
    }

    const html = buildHtmlEmail({
      recipientEmail,
      recipientName: recipientName || "",
      travelCase,
      senderName: auth.name || "Ops Team",
    });

    const subject = `Travel Rule Information Request — ${travelCase.asset} ${travelCase.direction} ${travelCase.transactionId}`;

    return apiSuccess({
      subject,
      recipientEmail,
      recipientName: recipientName || "",
      html,
    });
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/cases/[id]/preview-email");
  }
}

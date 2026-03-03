import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import { buildHtmlEmail } from "@/lib/travel-rule-email";

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

  try {
    const body = await request.json();
    const { recipientEmail, recipientName } = body;

    if (!recipientEmail) {
      return NextResponse.json(
        { success: false, error: "recipientEmail is required" },
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

    const html = buildHtmlEmail({
      recipientEmail,
      recipientName: recipientName || "",
      travelCase,
      senderName: auth.name || "Ops Team",
    });

    const subject = `Travel Rule Information Request — ${travelCase.asset} ${travelCase.direction} ${travelCase.transactionId}`;

    return NextResponse.json({
      success: true,
      data: {
        subject,
        recipientEmail,
        recipientName: recipientName || "",
        html,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

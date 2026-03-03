import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * POST /api/travel-rule/cases/:id/notes
 *
 * Add a free-text note to a travel rule case.
 * Body: { content: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { success: false, error: "content is required" },
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

    const actorId = auth.employeeId || auth.id;

    const note = await prisma.caseNote.create({
      data: {
        caseId: params.id,
        authorId: actorId,
        content: content.trim(),
      },
      include: { author: { select: { name: true } } },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "case_note_added",
        entityType: "travel_rule_case",
        entityId: params.id,
        userId: actorId,
        details: JSON.stringify({
          description: `Note added by ${auth.name || "analyst"}`,
          noteId: note.id,
        }),
      },
    });

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * POST /api/projects/[id]/members
 * Add a member to a project.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { employeeId, role } = body;

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: "Missing required field: employeeId" },
        { status: 400 }
      );
    }

    const member = await prisma.projectMember.upsert({
      where: {
        projectId_employeeId: { projectId: id, employeeId },
      },
      update: { role: role || "contributor" },
      create: {
        projectId: id,
        employeeId,
        role: role || "contributor",
      },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ success: true, data: member }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

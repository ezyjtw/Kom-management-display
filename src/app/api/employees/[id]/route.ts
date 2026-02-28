import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole, safeErrorMessage } from "@/lib/auth-user";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        scores: {
          include: { period: true },
          orderBy: { period: { startDate: "desc" } },
        },
        knowledgeScores: {
          include: { period: true },
          orderBy: { period: { startDate: "desc" } },
        },
        employeeNotes: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: employee });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/employees/:id
 * Update an employee record. Admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, role, team, region, active } = body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (team !== undefined) data.team = team;
    if (region !== undefined) data.region = region;
    if (active !== undefined) data.active = active;

    const employee = await prisma.employee.update({
      where: { id: params.id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        action: "employee_updated",
        entityType: "employee",
        entityId: params.id,
        userId: auth.id,
        details: JSON.stringify(data),
      },
    });

    return NextResponse.json({ success: true, data: employee });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

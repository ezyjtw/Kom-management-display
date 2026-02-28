import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole, safeErrorMessage } from "@/lib/auth-user";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const role = searchParams.get("role");
    const active = searchParams.get("active") !== "false";

    const where: Record<string, unknown> = { active };
    if (team) where.team = team;
    if (role) where.role = role;

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ success: true, data: employees });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees
 * Create a new employee record. Admin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { name, email, role, team, region } = body;

    if (!name || !email || !role || !team) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: name, email, role, team" },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.create({
      data: { name, email, role, team, region: region || "Global" },
    });

    await prisma.auditLog.create({
      data: {
        action: "employee_created",
        entityType: "employee",
        entityId: employee.id,
        userId: auth.id,
        details: JSON.stringify({ name, email, role, team }),
      },
    });

    return NextResponse.json({ success: true, data: employee }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

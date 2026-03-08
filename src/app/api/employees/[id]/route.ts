import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { apiSuccess, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

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
      return apiNotFoundError("Employee");
    }

    return apiSuccess(employee);
  } catch (error) {
    return handleApiError(error, "employee GET");
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
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.sensitive);
  if (limited) return limited;

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

    return apiSuccess(employee);
  } catch (error) {
    return handleApiError(error, "employee PATCH");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { apiSuccess, apiNotFoundError, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { requireAuthorization, requireRecordAccess, maskSensitiveFields } from "@/modules/auth/services/authorization";
import { validateBody, updateEmployeeSchema } from "@/lib/validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "employee", "view");
  if (authz instanceof NextResponse) return authz;

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

    // Object-level authorization: a lead (team scope) may only read employees
    // on their own team; an employee may only read their own record. The
    // employee record is its own "owner" (matched against the caller's
    // employeeId), and its team gates the team scope.
    const accessError = requireRecordAccess(auth, authz.scope, {
      ownerId: employee.id,
      team: employee.team,
    });
    if (accessError) return accessError;

    // Mask sensitive fields (e.g. email) for non-admin roles
    const safeEmployee = maskSensitiveFields(employee, "employee", auth.role);

    return apiSuccess(safeEmployee);
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
    const parsed = validateBody(updateEmployeeSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
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

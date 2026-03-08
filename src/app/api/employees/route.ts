import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { employeeService } from "@/modules/employees/services/employee-service";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, apiForbiddenError, handleApiError } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "employee", "view");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team") || undefined;
    const role = searchParams.get("role") || undefined;
    const active = searchParams.get("active") !== "false";

    const { employees } = await employeeService.getEmployees(
      { team, role, active },
      { orderBy: "name", order: "asc" },
      {
        userRole: auth.role,
        userTeam: auth.team ?? undefined,
        userEmployeeId: auth.employeeId ?? undefined,
      },
    );

    return apiSuccess(employees);
  } catch (error) {
    return handleApiError(error, "GET /api/employees");
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
      return apiValidationError("Missing required fields: name, email, role, team");
    }

    const employee = await employeeService.createEmployee(
      { name, email, role, team, region },
      {
        userRole: auth.role,
        userTeam: auth.team ?? undefined,
        userEmployeeId: auth.employeeId ?? undefined,
      },
    );

    return apiSuccess(employee, undefined, 201);
  } catch (error) {
    return handleApiError(error, "POST /api/employees");
  }
}

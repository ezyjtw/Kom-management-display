/**
 * Employee Domain Service
 *
 * Business logic for employee management including CRUD with team/scope
 * awareness, enriched employee detail views (scores, threads, alerts),
 * and field-level masking for sensitive data.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { maskSensitiveFields } from "@/modules/auth/services/authorization";
import {
  employeeRepository,
  type EmployeeFilters,
  type EmployeePagination,
  type CreateEmployeeData,
  type UpdateEmployeeData,
  type EmployeeRecord,
  type EmployeeDetailRecord,
} from "@/modules/employees/repositories/employee-repository";

// ─── Types ───

export interface EmployeeServiceContext {
  /** Role of the requesting user (admin, lead, employee, auditor). */
  userRole: string;
  /** Team of the requesting user, for scope filtering. */
  userTeam?: string;
  /** Employee ID of the requesting user, for "own" scope. */
  userEmployeeId?: string;
}

export interface EmployeeDetailView {
  employee: EmployeeRecord;
  scores: Array<{
    id: string;
    category: string;
    score: number;
    rawIndex: number;
    periodLabel: string;
    periodType: string;
  }>;
  activeThreads: Array<{
    id: string;
    subject: string;
    status: string;
    priority: string;
  }>;
  activeAlerts: Array<{
    id: string;
    type: string;
    status: string;
    message: string;
    createdAt: string;
  }>;
  counts: {
    totalScores: number;
    totalThreads: number;
    totalAlerts: number;
    totalNotes: number;
  };
}

/** Fields considered sensitive on employee records. */
const SENSITIVE_EMPLOYEE_FIELDS = ["email"] as const;

// ─── Service ───

export const employeeService = {
  /**
   * List employees with scope-aware filtering. Leads only see their
   * team's employees. Regular employees only see themselves.
   */
  async getEmployees(
    filters: EmployeeFilters = {},
    pagination: EmployeePagination = {},
    context?: EmployeeServiceContext,
  ): Promise<{ employees: EmployeeRecord[]; total: number }> {
    const scopedFilters = applyScopeToFilters(filters, context);

    const result = await employeeRepository.getEmployees(scopedFilters, pagination);

    // Apply field-level masking if not admin
    if (context && context.userRole !== "admin") {
      result.employees = result.employees.map((emp) =>
        maskEmployeeFields(emp, context.userRole),
      );
    }

    return result;
  },

  /**
   * Get a single employee by ID with enriched detail view including
   * recent scores, active threads, and active alerts.
   */
  async getEmployeeById(
    id: string,
    context?: EmployeeServiceContext,
  ): Promise<EmployeeDetailView | null> {
    // Scope check: employees can only view their own profile
    if (context) {
      if (context.userRole === "employee" && context.userEmployeeId !== id) {
        logger.warn("employeeService.getEmployeeById: scope violation", {
          requestedId: id,
          userId: context.userEmployeeId,
        });
        return null;
      }
      // Leads can only view team members
      if (context.userRole === "lead" && context.userTeam) {
        const employee = await prisma.employee.findUnique({
          where: { id },
          select: { team: true },
        });
        if (employee && employee.team !== context.userTeam) {
          return null;
        }
      }
    }

    const detail = await employeeRepository.getEmployeeById(id);
    if (!detail) return null;

    const employeeRecord = maskEmployeeFields(
      {
        id: detail.id,
        name: detail.name,
        email: detail.email,
        role: detail.role,
        team: detail.team,
        region: detail.region,
        active: detail.active,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      },
      context?.userRole ?? "admin",
    );

    return {
      employee: employeeRecord,
      scores: detail.scores.map((s) => ({
        id: s.id,
        category: s.category,
        score: s.score,
        rawIndex: s.rawIndex,
        periodLabel: s.period.label,
        periodType: s.period.type,
      })),
      activeThreads: detail.ownedThreads,
      activeAlerts: detail.alerts.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
      counts: {
        totalScores: detail._count.scores,
        totalThreads: detail._count.ownedThreads,
        totalAlerts: detail._count.alerts,
        totalNotes: detail._count.employeeNotes,
      },
    };
  },

  /**
   * Create a new employee. Only admins and leads (for their team) can create.
   */
  async createEmployee(
    data: CreateEmployeeData,
    context?: EmployeeServiceContext,
  ): Promise<EmployeeRecord> {
    // Leads can only create employees in their own team
    if (context?.userRole === "lead" && context.userTeam && data.team !== context.userTeam) {
      throw new Error(`Leads can only create employees in their own team (${context.userTeam})`);
    }

    // Check for duplicate email
    const existing = await prisma.employee.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existing) {
      throw new Error(`An employee with email ${data.email} already exists`);
    }

    const employee = await employeeRepository.createEmployee(data);

    await writeAuditLog("employee_created", "employee", employee.id, context?.userEmployeeId ?? "system", {
      name: data.name,
      team: data.team,
      role: data.role,
    });

    return employee;
  },

  /**
   * Update an existing employee. Respects scope: leads can only update
   * team members, employees cannot update others.
   */
  async updateEmployee(
    id: string,
    data: UpdateEmployeeData,
    context?: EmployeeServiceContext,
  ): Promise<EmployeeRecord> {
    if (context) {
      // Employees can only update their own record (limited fields)
      if (context.userRole === "employee") {
        if (context.userEmployeeId !== id) {
          throw new Error("Employees can only update their own record");
        }
        // Employees cannot change role, team, or active status
        if (data.role || data.team || data.active !== undefined) {
          throw new Error("Employees cannot change role, team, or active status");
        }
      }

      // Leads can only update members of their team
      if (context.userRole === "lead" && context.userTeam) {
        const employee = await prisma.employee.findUnique({
          where: { id },
          select: { team: true },
        });
        if (employee && employee.team !== context.userTeam) {
          throw new Error("Leads can only update employees in their own team");
        }
        // Leads cannot change team assignment (admin only)
        if (data.team && data.team !== context.userTeam) {
          throw new Error("Leads cannot reassign employees to other teams");
        }
      }
    }

    const employee = await employeeRepository.updateEmployee(id, data);

    await writeAuditLog("employee_updated", "employee", id, context?.userEmployeeId ?? "system", {
      updatedFields: Object.keys(data),
    });

    return employee;
  },

  /**
   * Deactivate an employee (soft delete). Sets active=false.
   */
  async deactivateEmployee(
    id: string,
    context?: EmployeeServiceContext,
  ): Promise<EmployeeRecord> {
    const employee = await employeeRepository.updateEmployee(id, { active: false });

    await writeAuditLog("employee_deactivated", "employee", id, context?.userEmployeeId ?? "system", {});

    logger.info("employeeService.deactivateEmployee", { id });
    return employee;
  },
};

// ─── Internal Helpers ───

/**
 * Apply scope-based filtering to employee queries based on the
 * requesting user's role.
 */
function applyScopeToFilters(
  filters: EmployeeFilters,
  context?: EmployeeServiceContext,
): EmployeeFilters {
  if (!context) return filters;

  switch (context.userRole) {
    case "admin":
    case "auditor":
      // No additional filtering
      return filters;

    case "lead":
      // Leads see only their team
      if (context.userTeam) {
        return { ...filters, team: context.userTeam };
      }
      return filters;

    case "employee":
      // Employees see only themselves (handled in getEmployeeById)
      // For list views, return empty result by setting impossible filter
      return { ...filters, search: context.userEmployeeId ?? "__none__" };

    default:
      return filters;
  }
}

/**
 * Mask sensitive fields on an employee record based on the user's role.
 * Admins and leads see all fields. Employees and auditors get masked emails.
 */
function maskEmployeeFields(
  employee: EmployeeRecord,
  userRole: string,
): EmployeeRecord {
  if (userRole === "admin" || userRole === "lead") return employee;

  return maskSensitiveFields(
    employee as unknown as Record<string, unknown>,
    "employee",
    userRole,
  ) as unknown as EmployeeRecord;
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId,
        details: JSON.stringify(details),
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", { action, entityType, entityId, error: String(err) });
  }
}

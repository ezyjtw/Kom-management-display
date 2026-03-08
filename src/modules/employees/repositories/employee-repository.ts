/**
 * Employee Repository
 *
 * Data access layer for the Employee model. Handles all Prisma queries
 * for employee CRUD operations with support for filtering, pagination,
 * and relation loading.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─── Types ───

export interface EmployeeFilters {
  team?: string;
  role?: string;
  region?: string;
  active?: boolean;
  /** Free-text search across name and email. */
  search?: string;
}

export interface EmployeePagination {
  page?: number;
  pageSize?: number;
  orderBy?: "name" | "createdAt" | "team" | "role";
  order?: "asc" | "desc";
}

export interface CreateEmployeeData {
  name: string;
  email: string;
  role: string;
  team: string;
  region?: string;
}

export interface UpdateEmployeeData {
  name?: string;
  email?: string;
  role?: string;
  team?: string;
  region?: string;
  active?: boolean;
}

export interface EmployeeRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  region: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeDetailRecord extends EmployeeRecord {
  scores: Array<{
    id: string;
    category: string;
    score: number;
    rawIndex: number;
    periodId: string;
    period: { label: string; type: string };
  }>;
  ownedThreads: Array<{
    id: string;
    subject: string;
    status: string;
    priority: string;
  }>;
  alerts: Array<{
    id: string;
    type: string;
    status: string;
    message: string;
    createdAt: Date;
  }>;
  _count: {
    scores: number;
    ownedThreads: number;
    alerts: number;
    employeeNotes: number;
  };
}

// ─── Repository ───

export const employeeRepository = {
  /**
   * List employees with optional filters and pagination.
   */
  async getEmployees(
    filters: EmployeeFilters = {},
    pagination: EmployeePagination = {},
  ): Promise<{ employees: EmployeeRecord[]; total: number }> {
    const where = buildEmployeeWhere(filters);
    const page = Math.max(1, pagination.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 50));

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [pagination.orderBy ?? "name"]: pagination.order ?? "asc" },
      }),
      prisma.employee.count({ where }),
    ]);

    logger.debug("employeeRepository.getEmployees", { total, filters: Object.keys(filters) });
    return { employees: employees as EmployeeRecord[], total };
  },

  /**
   * Get a single employee by ID with related scores, threads, and alerts.
   */
  async getEmployeeById(id: string): Promise<EmployeeDetailRecord | null> {
    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        scores: {
          orderBy: { createdAt: "desc" },
          take: 25,
          include: {
            period: { select: { label: true, type: true } },
          },
        },
        ownedThreads: {
          where: { status: { notIn: ["Closed"] } },
          orderBy: { lastMessageAt: "desc" },
          take: 10,
          select: { id: true, subject: true, status: true, priority: true },
        },
        alerts: {
          where: { status: { in: ["active", "acknowledged"] } },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, type: true, status: true, message: true, createdAt: true },
        },
        _count: {
          select: {
            scores: true,
            ownedThreads: true,
            alerts: true,
            employeeNotes: true,
          },
        },
      },
    });

    return employee as unknown as EmployeeDetailRecord | null;
  },

  /**
   * Create a new employee record.
   */
  async createEmployee(data: CreateEmployeeData): Promise<EmployeeRecord> {
    const employee = await prisma.employee.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        team: data.team,
        region: data.region ?? "Global",
      },
    });

    logger.info("employeeRepository.createEmployee", {
      id: employee.id,
      name: data.name,
      team: data.team,
    });
    return employee as EmployeeRecord;
  },

  /**
   * Update an existing employee record.
   */
  async updateEmployee(id: string, data: UpdateEmployeeData): Promise<EmployeeRecord> {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.team !== undefined) updateData.team = data.team;
    if (data.region !== undefined) updateData.region = data.region;
    if (data.active !== undefined) updateData.active = data.active;

    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
    });

    logger.info("employeeRepository.updateEmployee", { id, fields: Object.keys(data) });
    return employee as EmployeeRecord;
  },

  /**
   * Check if an employee exists by ID.
   */
  async exists(id: string): Promise<boolean> {
    const count = await prisma.employee.count({ where: { id } });
    return count > 0;
  },

  /**
   * Get employees by team. Useful for scope-filtered queries.
   */
  async getEmployeesByTeam(team: string): Promise<EmployeeRecord[]> {
    const employees = await prisma.employee.findMany({
      where: { team, active: true },
      orderBy: { name: "asc" },
    });
    return employees as EmployeeRecord[];
  },

  /**
   * Get employee IDs for a given team. Used for scope filtering in other services.
   */
  async getEmployeeIdsByTeam(team: string): Promise<string[]> {
    const employees = await prisma.employee.findMany({
      where: { team, active: true },
      select: { id: true },
    });
    return employees.map((e) => e.id);
  },
};

// ─── Helpers ───

function buildEmployeeWhere(filters: EmployeeFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.team) where.team = filters.team;
  if (filters.role) where.role = filters.role;
  if (filters.region) where.region = filters.region;
  if (filters.active !== undefined) where.active = filters.active;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return where;
}

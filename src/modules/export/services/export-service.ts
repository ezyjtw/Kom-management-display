/**
 * Export Domain Service
 *
 * Handles data export with role-based restrictions, watermarking,
 * audit logging, row limits, sensitivity controls, and multiple
 * format support (CSV, JSON).
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Role } from "@/modules/auth/types";

// ─── Constants ───

/** Maximum rows per export by role. */
const ROW_LIMITS: Record<Role, number> = {
  admin: 50_000,
  lead: 10_000,
  employee: 0, // Cannot export
  auditor: 50_000,
};

/** Resources that each role can export. */
const EXPORTABLE_RESOURCES: Record<Role, string[]> = {
  admin: [
    "employees",
    "scores",
    "threads",
    "alerts",
    "incidents",
    "travel_rule_cases",
    "audit_logs",
    "settlements",
    "screening",
  ],
  lead: [
    "employees",
    "scores",
    "threads",
    "alerts",
  ],
  employee: [],
  auditor: [
    "employees",
    "scores",
    "threads",
    "alerts",
    "incidents",
    "travel_rule_cases",
    "audit_logs",
    "settlements",
    "screening",
  ],
};

/** Fields to exclude from exports for non-admin roles. */
const SENSITIVE_EXPORT_FIELDS: Record<string, string[]> = {
  employees: ["email"],
  threads: ["participants"],
  travel_rule_cases: ["senderAddress", "receiverAddress", "emailSentTo"],
  settlements: ["collateralWallet", "custodyWallet"],
  screening: [],
};

// ─── Types ───

export type ExportFormat = "csv" | "json";

export interface ExportRequest {
  /** The resource/entity type to export. */
  resource: string;
  /** Output format. */
  format: ExportFormat;
  /** Filters to apply to the data query. */
  filters?: Record<string, unknown>;
  /** Specific columns to include. If omitted, all non-sensitive columns. */
  columns?: string[];
  /** Maximum number of rows to export. Capped by role limit. */
  maxRows?: number;
}

export interface ExportContext {
  userId: string;
  userRole: Role;
  userName: string;
  userTeam?: string;
  userEmployeeId?: string;
}

export interface ExportResult {
  /** The exported data as a string (CSV or JSON). */
  content: string;
  /** MIME type for the response. */
  mimeType: string;
  /** Suggested filename. */
  filename: string;
  /** Number of rows exported. */
  rowCount: number;
  /** Watermark text embedded in the export. */
  watermark: string;
  /** Whether any fields were redacted due to sensitivity. */
  fieldsRedacted: boolean;
  /** Audit log entry ID for this export. */
  auditLogId: string;
}

export interface ExportAuditEntry {
  id: string;
  userId: string;
  userName: string;
  resource: string;
  format: ExportFormat;
  rowCount: number;
  filters: Record<string, unknown>;
  timestamp: string;
  watermark: string;
}

// ─── Service ───

export const exportService = {
  /**
   * Execute a data export with full validation, masking, watermarking,
   * and audit logging.
   */
  async exportData(
    request: ExportRequest,
    context: ExportContext,
  ): Promise<ExportResult> {
    // 1. Validate permissions
    validateExportPermissions(request.resource, context);

    // 2. Determine row limit
    const roleLimit = ROW_LIMITS[context.userRole] ?? 0;
    const effectiveLimit = Math.min(request.maxRows ?? roleLimit, roleLimit);

    if (effectiveLimit <= 0) {
      throw new Error(`Role '${context.userRole}' is not permitted to export data`);
    }

    // 3. Fetch data
    const rawData = await fetchExportData(request.resource, request.filters ?? {}, effectiveLimit, context);

    // 4. Apply sensitivity controls
    const { data, fieldsRedacted } = applySensitivityControls(
      rawData,
      request.resource,
      context.userRole,
      request.columns,
    );

    // 5. Generate watermark
    const watermark = generateWatermark(context);

    // 6. Format output
    const content = formatExport(data, request.format, watermark);
    const mimeType = request.format === "csv" ? "text/csv" : "application/json";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${request.resource}_export_${timestamp}.${request.format}`;

    // 7. Audit the export
    const auditLogId = await auditExport(request, context, data.length, watermark);

    logger.info("exportService.exportData", {
      resource: request.resource,
      format: request.format,
      rowCount: data.length,
      userId: context.userId,
      fieldsRedacted,
    });

    return {
      content,
      mimeType,
      filename,
      rowCount: data.length,
      watermark,
      fieldsRedacted,
      auditLogId,
    };
  },

  /**
   * Check if a user can export a specific resource without performing
   * the export. Useful for UI to show/hide export buttons.
   */
  canExport(resource: string, role: Role): boolean {
    const allowed = EXPORTABLE_RESOURCES[role] ?? [];
    return allowed.includes(resource);
  },

  /**
   * Get the row limit for a given role.
   */
  getRowLimit(role: Role): number {
    return ROW_LIMITS[role] ?? 0;
  },

  /**
   * Get the list of resources a role can export.
   */
  getExportableResources(role: Role): string[] {
    return EXPORTABLE_RESOURCES[role] ?? [];
  },

  /**
   * Get recent export audit entries for review.
   */
  async getExportHistory(
    filters: { userId?: string; resource?: string; limit?: number } = {},
  ): Promise<ExportAuditEntry[]> {
    const logs = await prisma.auditLog.findMany({
      where: {
        action: "export",
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.resource ? { entityType: filters.resource } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 50,
      include: {
        user: { select: { name: true } },
      },
    });

    return logs.map((log) => {
      const details = safeParseJson(log.details);
      return {
        id: log.id,
        userId: log.userId,
        userName: (log as unknown as { user: { name: string } }).user.name,
        resource: log.entityType,
        format: (details.format ?? "csv") as ExportFormat,
        rowCount: (details.rowCount ?? 0) as number,
        filters: (details.filters ?? {}) as Record<string, unknown>,
        timestamp: log.createdAt.toISOString(),
        watermark: (details.watermark ?? "") as string,
      };
    });
  },
};

// ─── Internal Helpers ───

/**
 * Validate that the user's role permits exporting the requested resource.
 */
function validateExportPermissions(resource: string, context: ExportContext): void {
  const allowed = EXPORTABLE_RESOURCES[context.userRole] ?? [];
  if (!allowed.includes(resource)) {
    throw new Error(
      `Role '${context.userRole}' is not permitted to export '${resource}'. ` +
      `Allowed resources: ${allowed.join(", ") || "none"}`,
    );
  }
}

/**
 * Fetch data for export from the appropriate Prisma model.
 * Applies scope filtering (leads see only their team).
 */
async function fetchExportData(
  resource: string,
  filters: Record<string, unknown>,
  limit: number,
  context: ExportContext,
): Promise<Record<string, unknown>[]> {
  const scopeWhere = buildScopeWhere(resource, context);
  const combinedWhere = { ...scopeWhere, ...filters };

  switch (resource) {
    case "employees":
      return prisma.employee.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { name: "asc" },
      }) as unknown as Record<string, unknown>[];

    case "scores":
      return prisma.categoryScore.findMany({
        where: combinedWhere,
        include: {
          employee: { select: { name: true, role: true, team: true } },
          period: { select: { label: true, type: true } },
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "threads":
      return prisma.commsThread.findMany({
        where: combinedWhere,
        include: {
          owner: { select: { name: true, team: true } },
        },
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "alerts":
      return prisma.alert.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "incidents":
      return prisma.incident.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "travel_rule_cases":
      return prisma.travelRuleCase.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "audit_logs":
      return prisma.auditLog.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "settlements":
      return prisma.oesSettlement.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    case "screening":
      return prisma.screeningEntry.findMany({
        where: combinedWhere,
        take: limit,
        orderBy: { createdAt: "desc" },
      }) as unknown as Record<string, unknown>[];

    default:
      throw new Error(`Unknown export resource: ${resource}`);
  }
}

/**
 * Build scope-based where clause for the requesting user.
 * Leads are filtered to their team's data only.
 */
function buildScopeWhere(
  resource: string,
  context: ExportContext,
): Record<string, unknown> {
  if (context.userRole === "admin" || context.userRole === "auditor") {
    return {};
  }

  if (context.userRole === "lead" && context.userTeam) {
    switch (resource) {
      case "employees":
        return { team: context.userTeam };
      case "scores":
        return { employee: { team: context.userTeam } };
      case "threads":
        return { owner: { team: context.userTeam } };
      case "alerts":
        return { employee: { team: context.userTeam } };
      default:
        return {};
    }
  }

  return {};
}

/**
 * Remove or mask sensitive fields from export data.
 */
function applySensitivityControls(
  data: Record<string, unknown>[],
  resource: string,
  userRole: string,
  requestedColumns?: string[],
): { data: Record<string, unknown>[]; fieldsRedacted: boolean } {
  if (userRole === "admin") {
    if (requestedColumns) {
      return {
        data: data.map((row) => pickFields(row, requestedColumns)),
        fieldsRedacted: false,
      };
    }
    return { data, fieldsRedacted: false };
  }

  const sensitiveFields = SENSITIVE_EXPORT_FIELDS[resource] ?? [];
  let fieldsRedacted = false;

  const processed = data.map((row) => {
    const filtered = requestedColumns ? pickFields(row, requestedColumns) : { ...row };

    for (const field of sensitiveFields) {
      if (field in filtered) {
        filtered[field] = "[REDACTED]";
        fieldsRedacted = true;
      }
    }

    return filtered;
  });

  return { data: processed, fieldsRedacted };
}

/**
 * Pick only specified fields from a record.
 */
function pickFields(
  row: Record<string, unknown>,
  columns: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const col of columns) {
    if (col in row) {
      result[col] = row[col];
    }
  }
  return result;
}

/**
 * Generate a watermark string that identifies who exported the data and when.
 */
function generateWatermark(context: ExportContext): string {
  const timestamp = new Date().toISOString();
  return `Exported by ${context.userName} (${context.userId}) at ${timestamp}`;
}

/**
 * Format data as CSV or JSON with watermark embedded.
 */
function formatExport(
  data: Record<string, unknown>[],
  format: ExportFormat,
  watermark: string,
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        _watermark: watermark,
        _exportedAt: new Date().toISOString(),
        _rowCount: data.length,
        data,
      },
      null,
      2,
    );
  }

  // CSV format
  if (data.length === 0) {
    return `# ${watermark}\n`;
  }

  const headers = Object.keys(data[0]);
  const lines: string[] = [
    `# ${watermark}`,
    headers.join(","),
  ];

  for (const row of data) {
    const values = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      const str = String(val);
      // Escape CSV values that contain commas, quotes, or newlines
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

/**
 * Record the export in the audit log.
 */
async function auditExport(
  request: ExportRequest,
  context: ExportContext,
  rowCount: number,
  watermark: string,
): Promise<string> {
  try {
    const log = await prisma.auditLog.create({
      data: {
        action: "export",
        entityType: request.resource,
        entityId: `export_${Date.now()}`,
        userId: context.userEmployeeId ?? context.userId,
        details: JSON.stringify({
          format: request.format,
          rowCount,
          filters: request.filters ?? {},
          columns: request.columns ?? "all",
          watermark,
          userRole: context.userRole,
        }),
      },
    });

    return log.id;
  } catch (err) {
    logger.error("Failed to audit export", {
      resource: request.resource,
      userId: context.userId,
      error: String(err),
    });
    return "audit_failed";
  }
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

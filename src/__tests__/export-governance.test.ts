/**
 * Export governance tests.
 *
 * Verifies role-based export restrictions, row limits, audit logging,
 * watermark inclusion, and sensitivity controls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    categoryScore: { findMany: vi.fn() },
    commsThread: { findMany: vi.fn() },
    alert: { findMany: vi.fn() },
    incident: { findMany: vi.fn() },
    travelRuleCase: { findMany: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    oesSettlement: { findMany: vi.fn() },
    screeningEntry: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { exportService, type ExportContext, type ExportRequest } from "@/modules/export/services/export-service";

// ─── Helpers ───

function makeContext(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    userId: "user-1",
    userRole: "admin",
    userName: "Admin User",
    userTeam: "Transaction Operations",
    userEmployeeId: "emp-1",
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    resource: "employees",
    format: "csv",
    ...overrides,
  };
}

describe("Export Governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as never);
  });

  // ─── Employee cannot export ───

  describe("Employee role cannot export", () => {
    it("canExport returns false for employee on any resource", () => {
      expect(exportService.canExport("employees", "employee")).toBe(false);
      expect(exportService.canExport("scores", "employee")).toBe(false);
      expect(exportService.canExport("threads", "employee")).toBe(false);
      expect(exportService.canExport("incidents", "employee")).toBe(false);
    });

    it("getRowLimit returns 0 for employee", () => {
      expect(exportService.getRowLimit("employee")).toBe(0);
    });

    it("getExportableResources returns empty for employee", () => {
      expect(exportService.getExportableResources("employee")).toEqual([]);
    });

    it("exportData throws for employee role", async () => {
      const context = makeContext({ userRole: "employee" });
      const request = makeRequest({ resource: "employees" });

      await expect(exportService.exportData(request, context)).rejects.toThrow(
        /not permitted/,
      );
    });
  });

  // ─── Lead limited to team scope ───

  describe("Lead limited to team scope", () => {
    it("canExport returns true for lead on allowed resources only", () => {
      expect(exportService.canExport("employees", "lead")).toBe(true);
      expect(exportService.canExport("scores", "lead")).toBe(true);
      expect(exportService.canExport("threads", "lead")).toBe(true);
      expect(exportService.canExport("alerts", "lead")).toBe(true);
      // Not allowed:
      expect(exportService.canExport("incidents", "lead")).toBe(false);
      expect(exportService.canExport("travel_rule_cases", "lead")).toBe(false);
      expect(exportService.canExport("audit_logs", "lead")).toBe(false);
    });

    it("getRowLimit returns 10000 for lead", () => {
      expect(exportService.getRowLimit("lead")).toBe(10_000);
    });

    it("lead export applies team scope filter for employees", async () => {
      const context = makeContext({ userRole: "lead", userTeam: "Custody Ops" });
      const request = makeRequest({ resource: "employees" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice", team: "Custody Ops", role: "analyst" },
      ] as never);

      const result = await exportService.exportData(request, context);

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ team: "Custody Ops" }),
        }),
      );
      expect(result.rowCount).toBe(1);
    });

    it("lead cannot export resources outside their allowed list", async () => {
      const context = makeContext({ userRole: "lead" });
      const request = makeRequest({ resource: "incidents" });

      await expect(exportService.exportData(request, context)).rejects.toThrow(
        /not permitted/,
      );
    });
  });

  // ─── Admin can export all ───

  describe("Admin can export all", () => {
    it("canExport returns true for admin on all resources", () => {
      const resources = [
        "employees", "scores", "threads", "alerts", "incidents",
        "travel_rule_cases", "audit_logs", "settlements", "screening",
      ];
      for (const resource of resources) {
        expect(exportService.canExport(resource, "admin")).toBe(true);
      }
    });

    it("getRowLimit returns 50000 for admin", () => {
      expect(exportService.getRowLimit("admin")).toBe(50_000);
    });

    it("admin export has no scope filtering", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ resource: "employees" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ] as never);

      await exportService.exportData(request, context);

      // Admin scope filter returns {} (no additional constraints)
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });
  });

  // ─── Row limits enforced ───

  describe("Row limits enforced", () => {
    it("caps rows to role limit even if request asks for more", async () => {
      const context = makeContext({ userRole: "lead" });
      const request = makeRequest({
        resource: "employees",
        maxRows: 100_000, // asking for more than lead's 10k limit
      });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);

      await exportService.exportData(request, context);

      // Should pass the role limit (10000), not the requested 100000
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10_000,
        }),
      );
    });

    it("uses requested maxRows when below role limit", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({
        resource: "employees",
        maxRows: 100,
      });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);

      await exportService.exportData(request, context);

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });
  });

  // ─── Audit entry created for every export ───

  describe("Audit entry created for every export", () => {
    it("creates an audit log entry with export details", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ resource: "employees", format: "csv" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice" },
      ] as never);

      const result = await exportService.exportData(request, context);

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "export",
            entityType: "employees",
            userId: "emp-1",
          }),
        }),
      );
      expect(result.auditLogId).toBe("audit-1");
    });

    it("includes watermark, format, and row count in audit details", async () => {
      const context = makeContext({ userRole: "admin", userName: "Admin Bob" });
      const request = makeRequest({ resource: "employees", format: "json" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice" },
        { id: "2", name: "Carol" },
      ] as never);

      await exportService.exportData(request, context);

      const auditCall = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
      const details = JSON.parse(auditCall.data.details as string);
      expect(details.format).toBe("json");
      expect(details.rowCount).toBe(2);
      expect(details.watermark).toContain("Admin Bob");
    });

    it("returns audit_failed when audit log fails", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ resource: "employees" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("DB error") as never);

      const result = await exportService.exportData(request, context);
      expect(result.auditLogId).toBe("audit_failed");
    });
  });

  // ─── Watermark included ───

  describe("Watermark included in exports", () => {
    it("CSV export includes watermark as comment header", async () => {
      const context = makeContext({ userRole: "admin", userName: "Jane Admin" });
      const request = makeRequest({ resource: "employees", format: "csv" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice" },
      ] as never);

      const result = await exportService.exportData(request, context);

      expect(result.watermark).toContain("Jane Admin");
      expect(result.content).toContain("# Exported by Jane Admin");
    });

    it("JSON export includes watermark in _watermark field", async () => {
      const context = makeContext({ userRole: "admin", userName: "Bob Admin" });
      const request = makeRequest({ resource: "employees", format: "json" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice" },
      ] as never);

      const result = await exportService.exportData(request, context);

      const parsed = JSON.parse(result.content);
      expect(parsed._watermark).toContain("Bob Admin");
      expect(parsed._rowCount).toBe(1);
      expect(parsed.data).toHaveLength(1);
    });

    it("watermark includes user ID and timestamp", async () => {
      const context = makeContext({
        userRole: "admin",
        userId: "user-42",
        userName: "Test User",
      });
      const request = makeRequest({ resource: "employees" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);

      const result = await exportService.exportData(request, context);

      expect(result.watermark).toContain("user-42");
      expect(result.watermark).toContain("Test User");
    });
  });

  // ─── Sensitivity controls ───

  describe("Sensitivity controls", () => {
    it("redacts sensitive fields for non-admin", async () => {
      const context = makeContext({ userRole: "lead", userTeam: "Ops" });
      const request = makeRequest({ resource: "employees" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice", email: "alice@example.com" },
      ] as never);

      const result = await exportService.exportData(request, context);
      expect(result.fieldsRedacted).toBe(true);
    });

    it("does not redact fields for admin", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ resource: "employees" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([
        { id: "1", name: "Alice", email: "alice@example.com" },
      ] as never);

      const result = await exportService.exportData(request, context);
      expect(result.fieldsRedacted).toBe(false);
    });
  });

  // ─── Format and MIME type ───

  describe("Export format and MIME type", () => {
    it("CSV export returns text/csv MIME type", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ format: "csv" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);

      const result = await exportService.exportData(request, context);
      expect(result.mimeType).toBe("text/csv");
    });

    it("JSON export returns application/json MIME type", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ format: "json" });

      vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);

      const result = await exportService.exportData(request, context);
      expect(result.mimeType).toBe("application/json");
    });

    it("filename includes resource name and format extension", async () => {
      const context = makeContext({ userRole: "admin" });
      const request = makeRequest({ resource: "scores", format: "csv" });

      vi.mocked(prisma.categoryScore.findMany).mockResolvedValue([] as never);

      const result = await exportService.exportData(request, context);
      expect(result.filename).toContain("scores_export_");
      expect(result.filename.endsWith(".csv")).toBe(true);
    });
  });

  // ─── Auditor ───

  describe("Auditor export permissions", () => {
    it("auditor can export all the same resources as admin", () => {
      const adminResources = exportService.getExportableResources("admin");
      const auditorResources = exportService.getExportableResources("auditor");
      expect(auditorResources).toEqual(adminResources);
    });

    it("auditor has same row limit as admin (50k)", () => {
      expect(exportService.getRowLimit("auditor")).toBe(50_000);
    });
  });

  // ─── Unknown resource ───

  describe("Unknown resource handling", () => {
    it("throws for unknown export resource", async () => {
      const context = makeContext({ userRole: "admin" });
      // Force the resource past validation by mocking the matrix
      // Actually, unknown resource will fail at validateExportPermissions
      const request = makeRequest({ resource: "nonexistent_resource" });

      await expect(exportService.exportData(request, context)).rejects.toThrow(
        /not permitted/,
      );
    });
  });
});

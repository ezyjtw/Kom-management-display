/**
 * Import templates (spec §8.6): nothing is parsed until a template is defined
 * from a real export. Filenames and data dates are checked first (spec §12
 * CHK-09): a mismatch is refused, never imported silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const settings = vi.hoisted(() => ({ patterns: {} as Record<string, string> }));
vi.mock("@/lib/auth-user", () => ({ requireRole: vi.fn(async () => ({ id: "u", role: "admin", employeeId: "e" })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(async () => ({ key: "imports.filenamePatterns", value: settings.patterns })) },
    auditLog: { create: vi.fn(async () => ({})) }, // uploads are audited fail-closed
  },
}));

import { GET, POST } from "@/app/api/admin/imports/route";
import { filenameIssues } from "@/modules/imports/templates";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/imports", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  settings.patterns = { travel_rule_recon: "^TR_Reconciliation_(?<date>\\d{8})\\.csv$", chainalysis: "^chainalysis_(?<date>\\d{4}-\\d{2}-\\d{2})\\.csv$" };
});

describe("imports", () => {
  it("lists each source with its CONFIRM blocker", async () => {
    const json = await (await GET()).json();
    expect(json.data.map((t: { confirmId: string; status: string }) => [t.confirmId, t.status])).toEqual([
      ["CONFIRM-CHAINALYSIS-EXPORT", "template_not_defined"],
      ["CONFIRM-MTD-EXTRACT", "template_not_defined"],
      ["CONFIRM-TATUM", "template_not_defined"],
      ["CONFIRM-INBOUND-EXTRACT", "template_not_defined"],
      ["CONFIRM-TR-RECON-EXPORT", "template_not_defined"],
    ]);
  });

  it("refuses uploads for undefined templates with 422", async () => {
    const res = await post({ template: "chainalysis", filename: "chainalysis_2026-09-23.csv", dataDate: "2026-09-23" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("CONFIRM-CHAINALYSIS-EXPORT");
  });

  it("rejects a file whose name does not match the expected pattern", async () => {
    const res = await post({ template: "travel_rule_recon", filename: "TR_Recon_final_v2.csv", dataDate: "2026-09-23" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('File name "TR_Recon_final_v2.csv" does not match the expected pattern for travel_rule_recon. The file was not imported.');
  });

  it("rejects a file whose name date is not the data date", async () => {
    expect(await filenameIssues("travel_rule_recon", "C:\\exports\\TR_Reconciliation_20260922.csv", "2026-09-23")).toEqual([
      "File name date 2026-09-22 does not match the data date 2026-09-23. The file was not imported.",
    ]);
    expect(await filenameIssues("travel_rule_recon", "TR_Reconciliation_20260923.csv", "2026-09-23")).toEqual([]);
  });

  it("refuses files for templates with no configured filename pattern", async () => {
    expect(await filenameIssues("tatum", "tatum.csv", "2026-09-23")).toEqual([
      'No expected filename pattern is configured for "tatum" (CONFIRM-IMPORT-FILENAMES). The file was not imported.',
    ]);
  });
});

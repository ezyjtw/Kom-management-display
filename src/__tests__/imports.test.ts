/**
 * Import templates (spec §8.6): nothing is parsed until a template is defined from a real export.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-user", () => ({ requireRole: vi.fn(async () => ({ id: "u", role: "admin", employeeId: "e" })) }));

import { GET, POST } from "@/app/api/admin/imports/route";

describe("imports", () => {
  it("lists each source with its CONFIRM blocker", async () => {
    const json = await (await GET()).json();
    expect(json.data.map((t: { confirmId: string; status: string }) => [t.confirmId, t.status])).toEqual([
      ["CONFIRM-CHAINALYSIS-EXPORT", "template_not_defined"],
      ["CONFIRM-MTD-EXTRACT", "template_not_defined"],
      ["CONFIRM-TATUM", "template_not_defined"],
      ["CONFIRM-INBOUND-EXTRACT", "template_not_defined"],
    ]);
  });

  it("refuses uploads for undefined templates with 422", async () => {
    const res = await POST(new NextRequest("http://localhost/api/admin/imports", { method: "POST", body: JSON.stringify({ template: "chainalysis" }) }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("CONFIRM-CHAINALYSIS-EXPORT");
  });
});

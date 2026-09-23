import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth-user";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { filenameIssues, IMPORT_TEMPLATES, templateStatus } from "@/modules/imports/templates";

/** GET /api/admin/imports — import templates and whether each is usable yet. */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;
  return apiSuccess(
    IMPORT_TEMPLATES.map((t) => ({ id: t.id, source: t.source, purpose: t.purpose, confirmId: t.confirmId, status: templateStatus(t) })),
  );
}

const uploadSchema = z.object({
  template: z.string().max(50),
  filename: z.string().min(1).max(300),
  dataDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/admin/imports — the filename and data date are checked first and a
 * mismatch is refused with the reason (CF-22); the upload is then refused until
 * the template exists (spec §8.6, §0 rule 4).
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;
  const parsed = uploadSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiValidationError("template, filename and dataDate (YYYY-MM-DD) are required");
  const template = IMPORT_TEMPLATES.find((t) => t.id === parsed.data.template);
  if (!template) return apiValidationError("Unknown import template");
  const issues = await filenameIssues(template.id, parsed.data.filename, parsed.data.dataDate);
  if (issues.length) return NextResponse.json({ success: false, error: issues.join(" "), issues }, { status: 422 });
  if (!template.parse) {
    return NextResponse.json(
      { success: false, error: `Import template "${template.id}" is not defined yet (${template.confirmId}). A real export is needed to build it.` },
      { status: 422 },
    );
  }
  return apiValidationError("Uploads are enabled per template once defined");
}

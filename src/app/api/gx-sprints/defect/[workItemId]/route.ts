/**
 * GET  /api/gx-sprints/defect/:workItemId — pre-filled GXS defect for a failed UAT item.
 * POST /api/gx-sprints/defect/:workItemId { summary, description, confirm: true } — create it after
 * the tester has reviewed it (spec §16.5). Audited fail-closed.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";
import { createDefect, defectDraft, DefectError, defectSchema } from "@/modules/gx-sprints/outcome";

const mapError = (error: unknown, context: string) =>
  error instanceof DefectError ? NextResponse.json({ success: false, error: error.message }, { status: error.status }) : handleApiError(error, context);

export async function GET(request: NextRequest, { params }: { params: Promise<{ workItemId: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.read);
  if (limited) return limited;
  try {
    return apiSuccess(await defectDraft((await params).workItemId));
  } catch (error) {
    return mapError(error, "gx defect draft");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ workItemId: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const parsed = validateBody(defectSchema, await request.json().catch(() => ({})));
    if (!parsed.success) return apiValidationError(parsed.error);
    const { workItemId } = await params;
    const actor = auditActor(auth);
    const created = await auditedAction(
      { action: "gx_defect_created", entityType: "work_item", entityId: workItemId, userId: actor.userId, summary: `Create GXS defect: ${parsed.data.summary}`, metadata: actor.metadata },
      () => createDefect(workItemId, parsed.data),
      (r) => ({ key: r.key }),
    );
    return apiSuccess(created, undefined, 201);
  } catch (error) {
    return mapError(error, "gx defect create");
  }
}

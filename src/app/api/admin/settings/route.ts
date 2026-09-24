/**
 * GET/PUT /api/admin/settings — runtime settings (intake route, etc.).
 * Changes need admin, are validated per key, guarded, and audit-logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { SETTINGS, isSettingKey, type SettingKey } from "@/modules/settings/registry";
import { getSetting, writeSetting } from "@/modules/settings/settings";
import { checkSettingChange } from "@/modules/settings/intake-guards";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "app_setting", "view");
  if (authz instanceof NextResponse) return authz;
  try {
    const keys = Object.keys(SETTINGS) as SettingKey[];
    const rows = await Promise.all(keys.map(async (key) => ({ key, label: SETTINGS[key].label, value: await getSetting(key), default: SETTINGS[key].default })));
    return apiSuccess(rows);
  } catch (error) {
    return handleApiError(error, "admin settings GET");
  }
}

const putSchema = z.object({ key: z.string(), value: z.unknown() });

export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "app_setting", "configure");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = putSchema.safeParse(await request.json());
    if (!body.success || !isSettingKey(body.data.key)) return apiValidationError("Unknown setting");
    const key = body.data.key;
    const parsed = SETTINGS[key].schema.safeParse(body.data.value);
    if (!parsed.success) return apiValidationError(parsed.error.issues.map((i) => i.message).join("; "));

    const problems = await checkSettingChange(key, parsed.data);
    if (problems.length) {
      return NextResponse.json({ success: false, error: problems.join(" ") }, { status: 422 });
    }

    const before = await getSetting(key);
    const actor = auditActor(auth);
    await auditedAction(
      {
        action: "app_setting_updated",
        entityType: "app_setting",
        entityId: key,
        userId: actor.userId,
        summary: `Change setting ${key}`,
        before: { value: before },
        after: { value: parsed.data },
        metadata: actor.metadata,
      },
      async () => writeSetting(key, parsed.data as never, actor.userId),
    );
    return apiSuccess({ key, value: parsed.data });
  } catch (error) {
    return handleApiError(error, "admin settings PUT");
  }
}

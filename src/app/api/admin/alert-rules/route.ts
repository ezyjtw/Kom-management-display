import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { syncRuleCatalogue } from "@/modules/alerting/engine";
import { effectiveParams, missingConfirmParams, RULE_CATALOGUE } from "@/modules/alerting/catalogue";

/** GET /api/admin/alert-rules — the catalogue (spec §11.2) with each rule's stored configuration. */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "alert_rule", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    await syncRuleCatalogue();
    const rules = await prisma.alertRule.findMany({ orderBy: { code: "asc" } });
    return apiSuccess(rules.map((r) => {
      const def = RULE_CATALOGUE[r.code];
      return {
        ...r,
        name: def?.name ?? r.code,
        ownerTeam: def?.ownerTeam ?? null,
        clock: def?.clock ?? null,
        autoResolve: def?.autoResolve ?? false,
        evaluated: !!def?.evaluate,
        effectiveParams: effectiveParams(r.code, r.params),
        missingConfirm: missingConfirmParams(r.code, r.params),
      };
    }));
  } catch (error) {
    return handleApiError(error, "admin alert-rules GET");
  }
}

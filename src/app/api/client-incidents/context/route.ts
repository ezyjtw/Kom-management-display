/**
 * GET /api/client-incidents/context?kind=slack&channelId=&ts= | kind=email&messageRecordId= | kind=work_item&workItemId=
 * Pre-fills the "Raise incident / risk" form (spec §9.7): the resolved client,
 * whether it has portal users, and the categories. 422 when the source is not
 * mapped to exactly one client with a JSM organisation.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { resolveSource, sourceSchema } from "@/modules/client-incidents/resolve";
import { NO_PORTAL_USERS, portalUsers } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  try {
    const q = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = sourceSchema.safeParse(q);
    if (!parsed.success) return apiValidationError("A source is required: kind=slack (channelId, ts), kind=email (messageRecordId) or kind=work_item (workItemId).");
    const resolved = await resolveSource(parsed.data);
    const users = await portalUsers(resolved.client.jsmOrganizationId);
    const categories = await prisma.incidentCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }], select: { code: true, label: true, complianceSensitive: true } });
    return apiSuccess({
      client: { id: resolved.client.id, displayName: resolved.client.displayName },
      portalUsers: users ? users.length : null,
      warning: users && users.length === 0 ? NO_PORTAL_USERS : null,
      canNotify: !!resolved.replyTarget,
      replyChannel: resolved.replyTarget?.channel ?? null,
      categories,
    });
  } catch (error) {
    return clientIncidentError(error, "client-incident context");
  }
}

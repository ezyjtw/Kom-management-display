/** POST /api/client-incidents/:id/status — move the client request through the client-visible statuses only (spec §9.7). */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";
import { setClientStatus } from "@/modules/client-incidents/service";
import { clientIncidentError } from "@/modules/client-incidents/http";

const bodySchema = z.object({ status: z.string().min(1).max(40) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const { id } = await params;
    const parsed = validateBody(bodySchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const item = await setClientStatus(id, parsed.data.status);
    return apiSuccess({ id: item.id, clientStatus: parsed.data.status });
  } catch (error) {
    return clientIncidentError(error, "client status POST");
  }
}

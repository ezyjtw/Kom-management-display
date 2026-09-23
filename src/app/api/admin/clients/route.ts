import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization, maskSensitiveFields } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, createClientSchema } from "@/lib/validation";
import { auditActor } from "@/modules/core-data/audit-actor";

/** GET /api/admin/clients — clients with their channels (?active=true|false). */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "client", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const active = new URL(request.url).searchParams.get("active");
    const clients = await prisma.client.findMany({
      where: active === null ? {} : { isActive: active === "true" },
      include: { channels: { orderBy: [{ kind: "asc" }, { ref: "asc" }] } },
      orderBy: { displayName: "asc" },
    });
    return apiSuccess(clients.map((c) => maskSensitiveFields(c, "client", auth.role)));
  } catch (error) {
    return handleApiError(error, "admin clients GET");
  }
}

/** POST /api/admin/clients — create a client and its channels (admin). */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "client", "create");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const parsed = validateBody(createClientSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const { channels, ...fields } = parsed.data;

    const client = await prisma.client.create({
      data: { ...fields, channels: { create: channels } },
      include: { channels: true },
    });

    const actor = auditActor(auth);
    await createAuditEntry({
      action: "client_created",
      entityType: "client",
      entityId: client.id,
      userId: actor.userId,
      summary: `Client created: ${client.displayName}`,
      after: { displayName: client.displayName, jurisdiction: client.jurisdiction, channels: channels.length },
      metadata: actor.metadata,
    });

    return apiSuccess(client, undefined, 201);
  } catch (error) {
    return handleApiError(error, "admin clients POST");
  }
}

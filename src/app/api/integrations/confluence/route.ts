import { NextRequest, NextResponse } from "next/server";
import { syncConfluenceSpace } from "@/lib/integrations/confluence";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { z } from "zod";
import { env } from "@/lib/env";

const syncSchema = z.object({
  spaceKey: z.string().min(1).max(20),
  queue: z.string().max(100).optional(),
});

/**
 * POST /api/integrations/confluence
 * Trigger a sync of a Confluence space. Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const body = await request.json();
    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));

    const { spaceKey, queue } = parsed.data;
    const result = await syncConfluenceSpace(spaceKey, queue);

    await prisma.auditLog.create({
      data: {
        action: "integration_sync",
        entityType: "confluence_space",
        entityId: spaceKey,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          spaceKey,
          queue: queue || "Transaction Operations",
          threadsSynced: result.threadsSynced,
          totalPages: result.totalPages,
        }),
      },
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "confluence sync");
  }
}

/**
 * GET /api/integrations/confluence
 * Get current Confluence integration status. Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const configured =
    !!env("CONFLUENCE_BASE_URL") &&
    !!env("CONFLUENCE_EMAIL") &&
    !!env("CONFLUENCE_API_TOKEN");

  return apiSuccess({
    configured,
    baseUrl: configured ? env("CONFLUENCE_BASE_URL") : null,
  });
}

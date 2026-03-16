import { NextRequest, NextResponse } from "next/server";
import { syncEmailInbox } from "@/lib/integrations/email";
import { requireRole } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, emailSyncSchema } from "@/lib/validation";
import { env } from "@/lib/env";

/**
 * POST /api/integrations/email
 * Trigger a sync of the configured email inbox. Admin only.
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
    const parsed = validateBody(emailSyncSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const { queue } = body;

    const result = await syncEmailInbox(queue);

    // Audit: log integration sync
    await prisma.auditLog.create({
      data: {
        action: "integration_sync",
        entityType: "email_inbox",
        entityId: result.inbox || "default",
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({
          inbox: result.inbox,
          queue: queue || "Transaction Operations",
          threadsSynced: result.threadsSynced,
        }),
      },
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "email sync");
  }
}

/**
 * GET /api/integrations/email
 * Get current email integration status. Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const configured =
    !!env("IMAP_HOST") &&
    !!env("IMAP_USER") &&
    !!env("IMAP_PASSWORD");

  return apiSuccess({
    configured,
    inbox: configured ? env("IMAP_USER") : null,
    smtpConfigured:
      !!env("SMTP_HOST") &&
      !!env("SMTP_USER") &&
      !!env("SMTP_PASSWORD"),
  });
}

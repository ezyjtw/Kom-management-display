import { NextRequest, NextResponse } from "next/server";
import { syncEmailInbox } from "@/lib/integrations/email";
import { requireRole } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * POST /api/integrations/email
 * Trigger a sync of the configured email inbox. Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
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
    !!process.env.IMAP_HOST &&
    !!process.env.IMAP_USER &&
    !!process.env.IMAP_PASSWORD;

  return apiSuccess({
    configured,
    inbox: configured ? process.env.IMAP_USER : null,
    smtpConfigured:
      !!process.env.SMTP_HOST &&
      !!process.env.SMTP_USER &&
      !!process.env.SMTP_PASSWORD,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { env } from "@/lib/env";
import { enqueueJob } from "@/lib/background-jobs";
import { getMailboxes, isGraphConfigured } from "@/lib/integrations/graph/client";

/**
 * POST /api/integrations/email
 * Queue a Microsoft Graph mail sync (the worker runs it). Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const jobId = await enqueueJob("graph_mail_sync", {}, { deduplicationKey: "manual_graph_mail_sync" });
    await prisma.auditLog.create({
      data: {
        action: "integration_sync_requested",
        entityType: "graph_mail",
        entityId: "all",
        userId: auth.employeeId ?? "system",
        details: JSON.stringify({ jobId, actorUserId: auth.id }),
      },
    });
    return apiSuccess({ queued: true, jobId });
  } catch (error) {
    return handleApiError(error, "email sync");
  }
}

/**
 * GET /api/integrations/email
 * Mail integration status: Graph mailboxes (inbound) and SMTP (outbound). Admin only.
 */
export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const mailboxes = getMailboxes().map((m) => ({ label: m.label, purpose: m.purpose }));
  return apiSuccess({
    configured: isGraphConfigured() && mailboxes.length > 0,
    mailboxes,
    smtpConfigured: !!env("SMTP_HOST") && !!env("SMTP_USER") && !!env("SMTP_PASSWORD"),
  });
}

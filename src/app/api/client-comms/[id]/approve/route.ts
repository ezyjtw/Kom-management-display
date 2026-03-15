/**
 * POST /api/client-comms/[id]/approve — Approve + dispatch a client comms draft
 *
 * Auth: requireAuth + checkAuthorization(client_comms, approve)
 * Body: { finalMessage: string, recipients: [{ channel, address }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { dispatchClientComms } from "@/lib/comms-dispatcher";
import { createAuditEntry } from "@/lib/api/audit";

const approveSchema = z.object({
  finalMessage: z.string().min(1).max(5000),
  recipients: z.array(
    z.object({
      channel: z.enum(["slack", "email"]),
      address: z.string().min(1).max(500),
    }),
  ).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

    const authzResult = requireAuthorization(authResult, "client_comms", "approve");
    if (authzResult instanceof NextResponse) return authzResult;

    const { id } = await params;
    const body = await request.json();

    // Validate
    const validation = validateBody(approveSchema, body);
    if (!validation.success) {
      return apiValidationError(validation.error);
    }

    const { finalMessage, recipients } = validation.data;

    // Dispatch
    const result = await dispatchClientComms(
      id,
      authResult.employeeId || authResult.id,
      finalMessage,
      recipients,
    );

    // Audit
    await createAuditEntry({
      action: "client_comms_approved",
      entityType: "client_comms_draft",
      entityId: id,
      userId: authResult.id,
      summary: `Approved and dispatched client comms draft ${id}`,
      metadata: {
        recipientCount: recipients.length,
        failedCount: result.failedCount,
      },
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error, "POST /api/client-comms/[id]/approve");
  }
}

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError, apiForbiddenError } from "@/lib/api/response";
import { enqueueJob } from "@/lib/background-jobs";
import { createAuditEntry } from "@/lib/api/audit";
import { NextResponse } from "next/server";

/**
 * POST /api/comms/threads/[id]/classify
 * Enqueue an AI classification job for the given thread.
 * Lead and admin roles only.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const authz = requireAuthorization(auth, "thread", "update");
    if (authz instanceof NextResponse) return authz;

    // Only leads and admins can trigger classification
    if (!["admin", "lead"].includes(auth.role)) {
      return apiForbiddenError("Only leads and admins can trigger AI classification");
    }

    const { id: threadId } = await params;

    const jobId = await enqueueJob("classify_thread", { threadId });

    await createAuditEntry({
      action: "thread_classify_enqueued",
      entityType: "thread",
      entityId: threadId,
      userId: auth.id,
      summary: `Enqueued AI classification for thread ${threadId}`,
      metadata: { jobId },
    });

    return apiSuccess({ jobId, threadId, message: "Classification job enqueued" });
  } catch (error) {
    return handleApiError(error, "POST /api/comms/threads/[id]/classify");
  }
}

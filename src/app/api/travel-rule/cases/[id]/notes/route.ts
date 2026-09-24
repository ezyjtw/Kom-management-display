import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization, requireRecordAccess } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, createTravelRuleCaseNoteSchema } from "@/lib/validation";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

/**
 * POST /api/travel-rule/cases/:id/notes
 *
 * Add a free-text note to a travel rule case.
 * Body: { content: string }
 */
export async function POST(
  request: NextRequest,
  { params: routeParams }: { params: Promise<{ id: string }> },
) {
  const params = await routeParams;
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "update");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "travel_rule_case_note_added", entityType: "travel_rule_case", entityId: new URL(request.url).pathname, userId: auditActorInfo.userId, summary: "Add a travel-rule case note", metadata: auditActorInfo.metadata },
      async () => {
        const body = await request.json();
        const parsed = validateBody(createTravelRuleCaseNoteSchema, body);
        if (!parsed.success) return apiValidationError(parsed.error);
        const { content } = body;

        if (!content || typeof content !== "string" || !content.trim()) {
          return apiValidationError("content is required");
        }

        const travelCase = await prisma.travelRuleCase.findUnique({
          where: { id: params.id },
        });

        if (!travelCase) {
          return apiNotFoundError("Case");
        }

        if (travelCase.ownerUserId) {
          const ownerEmp = await prisma.employee.findUnique({
            where: { id: travelCase.ownerUserId },
            select: { team: true },
          });
          const accessError = requireRecordAccess(auth, authz.scope, {
            ownerId: travelCase.ownerUserId,
            team: ownerEmp?.team ?? null,
          });
          if (accessError) return accessError;
        }

        const actorId = auth.employeeId || auth.id;

        const [note] = await prisma.$transaction([
          prisma.caseNote.create({
            data: {
              caseId: params.id,
              authorId: actorId,
              content: content.trim(),
            },
            include: { author: { select: { name: true } } },
          }),
          prisma.auditLog.create({
            data: {
              action: "case_note_added",
              entityType: "travel_rule_case",
              entityId: params.id,
              userId: actorId,
              details: JSON.stringify({
                description: `Note added by ${auth.name || "analyst"}`,
              }),
            },
          }),
        ]);

        return apiSuccess(note, undefined, 201);
      },
    );
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/cases/[id]/notes");
  }
}

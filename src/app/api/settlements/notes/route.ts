/** POST /api/settlements/notes — add a note to a portfolio's row in a settlement window (spec §12 CHK-10). */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/validation";

const noteSchema = z.object({
  windowKey: z.string().regex(/^\d{4}-\d{2}-\d{2}:[a-z0-9_-]+:\d{2}:\d{2}Z$/),
  portfolioId: z.string().min(1).max(200),
  text: z.string().trim().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "update");
  if (authz instanceof NextResponse) return authz;
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;
  try {
    const parsed = validateBody(noteSchema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const note = await prisma.settlementNote.create({ data: { ...parsed.data, authorId: auth.employeeId ?? auth.id } });
    return apiSuccess(note, undefined, 201);
  } catch (error) {
    return handleApiError(error, "settlement note POST");
  }
}

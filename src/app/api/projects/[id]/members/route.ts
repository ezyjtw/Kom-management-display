import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * POST /api/projects/[id]/members
 * Add a member to a project.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const { employeeId, role } = body;

    if (!employeeId) {
      return apiValidationError("Missing required field: employeeId");
    }

    const member = await prisma.projectMember.upsert({
      where: {
        projectId_employeeId: { projectId: id, employeeId },
      },
      update: { role: role || "contributor" },
      create: {
        projectId: id,
        employeeId,
        role: role || "contributor",
      },
      include: {
        employee: { select: { id: true, name: true } },
      },
    });

    return apiSuccess(member, undefined, 201);
  } catch (error) {
    return handleApiError(error, "project members POST");
  }
}

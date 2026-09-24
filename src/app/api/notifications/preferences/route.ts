/** GET/PUT /api/notifications/preferences — my notify.on_assign.projects (spec §12 TASK-OTC). */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody } from "@/lib/validation";
import { projectsFor } from "@/modules/notifications/on-assign";

const schema = z.object({ onAssignProjects: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)).max(20) });

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    return apiSuccess({ onAssignProjects: await projectsFor(auth.id) });
  } catch (error) {
    return handleApiError(error, "notification preferences GET");
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const parsed = validateBody(schema, await request.json());
    if (!parsed.success) return apiValidationError(parsed.error);
    const value = [...new Set(parsed.data.onAssignProjects)] as Prisma.InputJsonValue;
    await prisma.userNotificationPreference.upsert({ where: { userId: auth.id }, update: { onAssignProjects: value }, create: { userId: auth.id, onAssignProjects: value } });
    return apiSuccess({ onAssignProjects: value });
  } catch (error) {
    return handleApiError(error, "notification preferences PUT");
  }
}

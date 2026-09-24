/** GET /api/notifications — my unread in-app notifications; PATCH marks them read. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    return apiSuccess(await prisma.inAppNotification.findMany({ where: { userId: auth.id, readAt: null }, orderBy: { createdAt: "desc" }, take: 50 }));
  } catch (error) {
    return handleApiError(error, "notifications GET");
  }
}

export async function PATCH() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  try {
    const { count } = await prisma.inAppNotification.updateMany({ where: { userId: auth.id, readAt: null }, data: { readAt: new Date() } });
    return apiSuccess({ read: count });
  } catch (error) {
    return handleApiError(error, "notifications PATCH");
  }
}

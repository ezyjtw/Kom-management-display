import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "active";
    const type = searchParams.get("type");
    const employeeId = searchParams.get("employeeId");

    const where: Record<string, unknown> = {};
    if (status !== "all") where.status = status;
    if (type) where.type = type;
    if (employeeId) where.employeeId = employeeId;

    const alerts = await prisma.alert.findMany({
      where,
      include: {
        thread: { select: { id: true, subject: true, priority: true } },
        employee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ success: true, data: alerts });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { alertId, action } = body;

    if (!alertId || !action) {
      return NextResponse.json(
        { success: false, error: "Missing alertId or action" },
        { status: 400 }
      );
    }

    if (!["acknowledge", "resolve"].includes(action)) {
      return NextResponse.json(
        { success: false, error: "Invalid action. Must be acknowledge or resolve" },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (action === "acknowledge") {
      data.status = "acknowledged";
      data.acknowledgedAt = new Date();
    } else if (action === "resolve") {
      data.status = "resolved";
      data.resolvedAt = new Date();
    }

    const alert = await prisma.alert.update({
      where: { id: alertId },
      data,
    });

    await prisma.auditLog.create({
      data: {
        action: `alert_${action}`,
        entityType: "alert",
        entityId: alertId,
        userId: auth.id,
        details: JSON.stringify({
          alertType: alert.type,
          alertMessage: alert.message,
          threadId: alert.threadId,
        }),
      },
    });

    return NextResponse.json({ success: true, data: alert });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

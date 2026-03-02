import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/comms/threads/:id/secondaries
 * Return the list of secondary (collaborator) owners for a thread.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
      select: { secondaryOwnerIds: true },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 },
      );
    }

    const ids: string[] = JSON.parse(thread.secondaryOwnerIds || "[]");

    // Resolve names
    const employees = ids.length
      ? await prisma.employee.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true },
        })
      : [];

    return NextResponse.json({ success: true, data: employees });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/comms/threads/:id/secondaries
 * Add or remove a secondary owner.
 *
 * Body: { employeeId: string, action: "add" | "remove" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { employeeId, action } = body;

    if (!employeeId || !["add", "remove"].includes(action)) {
      return NextResponse.json(
        { success: false, error: "employeeId and action (add|remove) are required" },
        { status: 400 },
      );
    }

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 },
      );
    }

    // RBAC: owner, secondary owners, and leads/admins can manage secondaries
    const actorId = auth.employeeId || auth.id;
    const isPrivileged = ["admin", "lead"].includes(auth.role);
    const isOwner = thread.ownerUserId === actorId;
    const currentIds: string[] = JSON.parse(thread.secondaryOwnerIds || "[]");
    const isSecondary = currentIds.includes(actorId);

    if (!isPrivileged && !isOwner && !isSecondary) {
      return NextResponse.json(
        { success: false, error: "Only the thread owner, a secondary owner, or a lead/admin can manage collaborators" },
        { status: 403 },
      );
    }

    let updatedIds: string[];
    if (action === "add") {
      if (currentIds.includes(employeeId)) {
        return NextResponse.json(
          { success: false, error: "Employee is already a secondary owner" },
          { status: 409 },
        );
      }
      updatedIds = [...currentIds, employeeId];
    } else {
      updatedIds = currentIds.filter((id) => id !== employeeId);
    }

    await prisma.commsThread.update({
      where: { id: params.id },
      data: { secondaryOwnerIds: JSON.stringify(updatedIds) },
    });

    // Audit
    await prisma.auditLog.create({
      data: {
        action: `secondary_owner_${action}`,
        entityType: "thread",
        entityId: params.id,
        userId: actorId,
        details: JSON.stringify({
          employeeId,
          action,
          threadSubject: thread.subject,
        }),
      },
    });

    // Resolve updated list
    const employees = updatedIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: updatedIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

    return NextResponse.json({ success: true, data: employees });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

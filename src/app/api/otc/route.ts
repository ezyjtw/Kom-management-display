/** GET /api/otc?filter=all|unassigned|overdue&owner=<employeeId> — OTC ticket queue (spec §12 TASK-OTC). */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";

const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "work_item", "view");
  if (authz instanceof NextResponse) return authz;
  try {
    const params = new URL(request.url).searchParams;
    const filter = params.get("filter") ?? "all";
    if (!["all", "unassigned", "overdue"].includes(filter)) return apiValidationError("filter must be all, unassigned or overdue");
    const owner = params.get("owner");
    const def = await prisma.dailyCheckDefinition.findUnique({ where: { code: "TASK-OTC" }, select: { evidenceSpec: true } });
    const overdueDays = typeof (def?.evidenceSpec as Record<string, unknown> | undefined)?.overdueDays === "number" ? ((def!.evidenceSpec as Record<string, number>).overdueDays) : 5; // TODO(CONFIRM-OTC-OVERDUE)
    const cutoff = new Date(Date.now() - overdueDays * 86_400_000);
    const items = await prisma.workItem.findMany({
      where: {
        ticketKey: { startsWith: "OTC-" },
        state: { in: [...OPEN] },
        ...(filter === "unassigned" ? { ownerEmployeeId: null } : {}),
        ...(filter === "overdue" ? { clockStartedAt: { lt: cutoff } } : {}),
        ...(owner ? { ownerEmployeeId: owner } : {}),
      },
      orderBy: { clockStartedAt: "asc" },
      take: 500,
      select: { id: true, title: true, ticketKey: true, ticketUrl: true, state: true, priority: true, ownerEmployeeId: true, clockStartedAt: true, kind: true, metadata: true, owner: { select: { name: true } } },
    });
    return apiSuccess({ overdueDays, items: items.map((i) => ({ ...i, overdue: i.clockStartedAt < cutoff })) });
  } catch (error) {
    return handleApiError(error, "otc GET");
  }
}

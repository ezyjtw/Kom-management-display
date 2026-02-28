import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSlaStatus } from "@/lib/sla";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const ownerUserId = searchParams.get("ownerUserId");
    const queue = searchParams.get("queue");
    const priority = searchParams.get("priority");
    const source = searchParams.get("source");
    const view = searchParams.get("view"); // my_threads, unassigned, overdue, all

    const isPrivileged = ["admin", "lead"].includes(auth.role);
    const actorEmployeeId = auth.employeeId || auth.id;

    const where: Record<string, unknown> = {};

    if (view === "unassigned") {
      where.status = "Unassigned";
      // Employees can only see unassigned threads in their team's queue
      if (auth.role === "employee" && auth.team) {
        where.queue = auth.team;
      }
      // Leads see unassigned across their team's queue (unless queue filter overrides)
      if (auth.role === "lead" && auth.team && !queue) {
        where.queue = auth.team;
      }
    } else if (view === "my_threads") {
      where.ownerUserId = actorEmployeeId;
      where.status = { notIn: ["Done", "Closed"] };
    } else if (view === "overdue") {
      // Employees: only their own overdue threads
      if (auth.role === "employee") {
        where.ownerUserId = actorEmployeeId;
      }
      // Leads: their team's queue
      if (auth.role === "lead" && auth.team && !queue) {
        where.queue = auth.team;
      }
      // Admin: unrestricted
    } else {
      // Default / "all" view — scoped by role
      if (auth.role === "employee") {
        // Employees see only their own threads + unassigned in their queue
        where.OR = [
          { ownerUserId: actorEmployeeId },
          { status: "Unassigned", ...(auth.team ? { queue: auth.team } : {}) },
        ];
      } else if (auth.role === "lead") {
        // Leads see their team's queue (all statuses)
        if (auth.team && !queue) {
          where.queue = auth.team;
        }
        // Leads can also filter by a specific user's threads
        if (ownerUserId) {
          where.ownerUserId = ownerUserId;
        }
      } else {
        // Admin: unrestricted, can filter by ownerUserId
        if (status) where.status = status;
        if (ownerUserId) where.ownerUserId = ownerUserId;
      }
    }

    // Queue/priority/source filters (admin/lead can override, employees constrained above)
    if (queue) {
      // If employee tries to filter a queue that isn't their team, ignore
      if (auth.role === "employee" && auth.team && queue !== auth.team) {
        // Don't apply — employee can't see other queues
      } else {
        where.queue = queue;
      }
    }
    if (priority) where.priority = priority;
    if (source) where.source = source;
    // Admin/lead status filter (employees constrained by the OR above)
    if (status && isPrivileged) where.status = status;

    const threads = await prisma.commsThread.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true } },
        messages: {
          orderBy: { timestamp: "desc" },
          take: 1,
        },
        _count: {
          select: { messages: true, ownershipChanges: true },
        },
      },
      orderBy: [{ priority: "asc" }, { lastMessageAt: "desc" }],
    });

    // Compute SLA status for each thread
    const threadsWithSla = threads.map((thread) => {
      const slaStatus = computeSlaStatus({
        createdAt: thread.createdAt,
        ownerUserId: thread.ownerUserId,
        lastActionAt: thread.lastActionAt,
        status: thread.status,
        priority: thread.priority,
        ttoDeadline: thread.ttoDeadline,
        ttfaDeadline: thread.ttfaDeadline,
        tslaDeadline: thread.tslaDeadline,
      });

      return {
        id: thread.id,
        source: thread.source,
        subject: thread.subject,
        clientOrPartnerTag: thread.clientOrPartnerTag,
        status: thread.status,
        priority: thread.priority,
        ownerName: thread.owner?.name ?? null,
        ownerUserId: thread.ownerUserId,
        queue: thread.queue,
        lastMessageAt: thread.lastMessageAt.toISOString(),
        lastActionAt: thread.lastActionAt?.toISOString() ?? null,
        createdAt: thread.createdAt.toISOString(),
        slaStatus,
        messageCount: thread._count.messages,
        ownershipChangeCount: thread._count.ownershipChanges,
        latestMessage: thread.messages[0] ?? null,
      };
    });

    // If view is "overdue", filter to breached SLAs
    const filtered =
      view === "overdue"
        ? threadsWithSla.filter(
            (t) =>
              t.slaStatus.isTtoBreached ||
              t.slaStatus.isTtfaBreached ||
              t.slaStatus.isTslaBreached
          )
        : threadsWithSla;

    return NextResponse.json({ success: true, data: filtered });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authPost = await requireAuth();
  if (authPost instanceof NextResponse) return authPost;

  try {
    const body = await request.json();
    const {
      source,
      sourceThreadRef,
      participants,
      clientOrPartnerTag,
      subject,
      priority,
      queue,
      initialMessage,
    } = body;

    if (!source || !sourceThreadRef || !subject) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: source, sourceThreadRef, subject" },
        { status: 400 }
      );
    }

    const thread = await prisma.commsThread.create({
      data: {
        source,
        sourceThreadRef,
        participants: JSON.stringify(participants || []),
        clientOrPartnerTag: clientOrPartnerTag || "",
        subject,
        priority: priority || "P2",
        queue: queue || "Ops",
        status: "Unassigned",
      },
    });

    // Create initial message if provided
    if (initialMessage) {
      await prisma.commsMessage.create({
        data: {
          threadId: thread.id,
          authorName: initialMessage.authorName,
          authorEmail: initialMessage.authorEmail || "",
          authorType: initialMessage.authorType || "external",
          bodySnippet: initialMessage.bodySnippet,
          bodyLink: initialMessage.bodyLink || "",
          attachments: JSON.stringify(initialMessage.attachments || []),
        },
      });
    }

    return NextResponse.json({ success: true, data: thread }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

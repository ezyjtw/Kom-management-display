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

    const where: Record<string, unknown> = {};

    if (view === "unassigned") {
      where.status = "Unassigned";
    } else if (view === "my_threads") {
      // Use session user's employeeId for "my threads" filtering
      const effectiveOwnerId = auth.employeeId || auth.id;
      where.ownerUserId = effectiveOwnerId;
      where.status = { notIn: ["Done", "Closed"] };
    } else {
      if (status) where.status = status;
      if (ownerUserId) where.ownerUserId = ownerUserId;
    }

    if (queue) where.queue = queue;
    if (priority) where.priority = priority;
    if (source) where.source = source;

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

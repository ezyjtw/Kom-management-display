import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { threadService } from "@/modules/comms/services/thread-service";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { computeSlaStatus } from "@/lib/sla";
import { normaliseSubject, deriveAutoPriority } from "@/lib/thread-utils";
import type { ThreadFilters } from "@/modules/comms/repositories/thread-repository";

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
    const view = searchParams.get("view");

    const isPrivileged = ["admin", "lead"].includes(auth.role);
    const actorEmployeeId = auth.employeeId || auth.id;

    // Build filters based on view and role
    const filters: ThreadFilters = {};

    if (view === "unassigned") {
      filters.status = "Unassigned" as never;
      if (auth.role === "employee" && auth.team) filters.queue = auth.team;
      if (auth.role === "lead" && auth.team && !queue) filters.queue = auth.team;
    } else if (view === "my_threads") {
      filters.ownerUserId = actorEmployeeId;
    } else if (view === "overdue") {
      if (auth.role === "employee") filters.ownerUserId = actorEmployeeId;
      if (auth.role === "lead" && auth.team && !queue) filters.queue = auth.team;
      filters.slaBreached = true;
    } else {
      // Default / "all" view -- scoped by role
      if (auth.role === "employee") {
        filters.ownerUserId = actorEmployeeId;
      } else if (auth.role === "lead") {
        if (auth.team && !queue) filters.queue = auth.team;
        if (ownerUserId) filters.ownerUserId = ownerUserId;
      } else {
        if (status) filters.status = status as never;
        if (ownerUserId) filters.ownerUserId = ownerUserId;
      }
    }

    if (queue) {
      if (!(auth.role === "employee" && auth.team && queue !== auth.team)) {
        filters.queue = queue;
      }
    }
    if (priority) filters.priority = priority as never;
    if (source) filters.source = source as never;
    if (status && isPrivileged) filters.status = status as never;

    const { threads } = await threadService.getThreads(filters, {
      orderBy: "lastMessageAt",
      order: "desc",
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
        messageCount: thread._count?.messages ?? 0,
        ownershipChangeCount: thread._count?.ownershipChanges ?? 0,
        latestMessage: thread.messages?.[0] ?? null,
      };
    });

    // If view is "overdue", filter to breached SLAs
    const filtered =
      view === "overdue"
        ? threadsWithSla.filter(
            (t) =>
              t.slaStatus.isTtoBreached ||
              t.slaStatus.isTtfaBreached ||
              t.slaStatus.isTslaBreached,
          )
        : threadsWithSla;

    return apiSuccess(filtered);
  } catch (error) {
    return handleApiError(error, "GET /api/comms/threads");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { source, sourceThreadRef, participants, clientOrPartnerTag, subject, priority, queue, initialMessage } = body;

    if (!source || !sourceThreadRef || !subject) {
      return apiValidationError("Missing required fields: source, sourceThreadRef, subject");
    }

    const cleanSubject = normaliseSubject(subject);
    const effectivePriority =
      priority ||
      deriveAutoPriority({
        subject,
        body: initialMessage?.bodySnippet,
        senderEmail: initialMessage?.authorEmail,
      }) ||
      "P2";

    const thread = await threadService.createThread({
      source,
      sourceThreadRef,
      subject: cleanSubject,
      priority: effectivePriority,
      queue: queue || "Transaction Operations",
      clientOrPartnerTag: clientOrPartnerTag || "",
      participants: participants || [],
    });

    // Create initial message if provided (threadService.createThread doesn't handle this)
    if (initialMessage) {
      const { prisma } = await import("@/lib/prisma");
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

    await createAuditEntry({
      action: "thread_created",
      entityType: "thread",
      entityId: thread.id,
      userId: auth.employeeId || auth.id,
      summary: `Thread created: ${cleanSubject}`,
      after: {
        source,
        subject: cleanSubject,
        priority: effectivePriority,
        queue: queue || "Transaction Operations",
      },
    });

    return apiSuccess(thread, undefined, 201);
  } catch (error) {
    return handleApiError(error, "POST /api/comms/threads");
  }
}

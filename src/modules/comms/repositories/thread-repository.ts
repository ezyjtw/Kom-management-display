/**
 * Thread Repository
 *
 * Data access layer for communication threads, messages, ownership changes,
 * and thread notes. All Prisma calls for the comms domain are centralized here.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ThreadStatus, ThreadPriority, CommsSource } from "@/types";

// ─── Filter & Input Types ───

export interface ThreadFilters {
  status?: ThreadStatus | ThreadStatus[];
  priority?: ThreadPriority | ThreadPriority[];
  source?: CommsSource;
  queue?: string;
  ownerUserId?: string;
  clientOrPartnerTag?: string;
  /** Free-text search across subject and clientOrPartnerTag. */
  search?: string;
  /** Only threads with SLA breaches. */
  slaBreached?: boolean;
  /** Only threads created after this date. */
  createdAfter?: Date;
  /** Only threads created before this date. */
  createdBefore?: Date;
}

export interface ThreadPagination {
  page?: number;
  pageSize?: number;
  orderBy?: "createdAt" | "lastMessageAt" | "lastActionAt" | "priority";
  order?: "asc" | "desc";
}

export interface CreateThreadData {
  source: string;
  sourceThreadRef: string;
  subject: string;
  priority?: string;
  status?: string;
  ownerUserId?: string;
  queue?: string;
  clientOrPartnerTag?: string;
  participants?: string[];
  ttoDeadline?: Date;
  ttfaDeadline?: Date;
}

export interface UpdateThreadData {
  subject?: string;
  priority?: string;
  status?: string;
  ownerUserId?: string | null;
  queue?: string;
  clientOrPartnerTag?: string;
  participants?: string[];
  secondaryOwnerIds?: string[];
  lastMessageAt?: Date;
  lastActionAt?: Date;
  ttoDeadline?: Date;
  ttfaDeadline?: Date;
  tslaDeadline?: Date;
  linkedRecords?: unknown[];
}

/** A single entry in a thread's unified timeline. */
export interface TimelineEntry {
  id: string;
  type: "message" | "note" | "ownership_change" | "status_change" | "alert";
  timestamp: Date;
  actor: string;
  actorType?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ThreadRecord {
  id: string;
  source: string;
  sourceThreadRef: string;
  participants: string;
  clientOrPartnerTag: string;
  subject: string;
  priority: string;
  status: string;
  ownerUserId: string | null;
  secondaryOwnerIds: string;
  queue: string;
  createdAt: Date;
  lastMessageAt: Date;
  lastActionAt: Date | null;
  ttoDeadline: Date | null;
  ttfaDeadline: Date | null;
  tslaDeadline: Date | null;
  linkedRecords: string;
  owner?: { id: string; name: string; team: string } | null;
  messages?: Array<Record<string, unknown>>;
  ownershipChanges?: Array<Record<string, unknown>>;
  notes?: Array<Record<string, unknown>>;
  alerts?: Array<Record<string, unknown>>;
  _count?: { messages: number; ownershipChanges: number; notes: number; alerts: number };
}

// ─── Repository ───

export const threadRepository = {
  /**
   * List threads with filtering, pagination, and counts.
   */
  async getThreads(
    filters: ThreadFilters = {},
    pagination: ThreadPagination = {},
  ): Promise<{ threads: ThreadRecord[]; total: number }> {
    const where = buildThreadWhere(filters);
    const { skip, take } = buildPagination(pagination);
    const orderField = pagination.orderBy ?? "lastMessageAt";
    const orderDir = pagination.order ?? "desc";

    const [threads, total] = await Promise.all([
      prisma.commsThread.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, team: true } },
          _count: { select: { messages: true, ownershipChanges: true, notes: true, alerts: true } },
        },
        skip,
        take,
        orderBy: { [orderField]: orderDir },
      }),
      prisma.commsThread.count({ where }),
    ]);

    logger.debug("threadRepository.getThreads", { total, filters: Object.keys(filters) });
    return { threads: threads as unknown as ThreadRecord[], total };
  },

  /**
   * Get a single thread by ID with all related data.
   */
  async getThreadById(id: string): Promise<ThreadRecord | null> {
    const thread = await prisma.commsThread.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, team: true } },
        messages: { orderBy: { timestamp: "asc" } },
        ownershipChanges: {
          orderBy: { changedAt: "asc" },
          include: {
            oldOwner: { select: { id: true, name: true } },
            newOwner: { select: { id: true, name: true } },
            changedBy: { select: { id: true, name: true } },
          },
        },
        notes: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, name: true } } },
        },
        alerts: { orderBy: { createdAt: "desc" } },
      },
    });

    return thread as unknown as ThreadRecord | null;
  },

  /**
   * Create a new thread.
   */
  async createThread(data: CreateThreadData): Promise<ThreadRecord> {
    const thread = await prisma.commsThread.create({
      data: {
        source: data.source as unknown as import("@prisma/client").CommsSource,
        sourceThreadRef: data.sourceThreadRef,
        subject: data.subject,
        priority: (data.priority ?? "P2") as unknown as import("@prisma/client").ThreadPriority,
        status: (data.status ?? "Unassigned") as unknown as import("@prisma/client").ThreadStatus,
        ownerUserId: data.ownerUserId ?? null,
        queue: data.queue ?? "Transaction Operations",
        clientOrPartnerTag: data.clientOrPartnerTag ?? "",
        participants: JSON.stringify(data.participants ?? []),
        ttoDeadline: data.ttoDeadline ?? null,
        ttfaDeadline: data.ttfaDeadline ?? null,
      },
      include: {
        owner: { select: { id: true, name: true, team: true } },
      },
    });

    logger.info("threadRepository.createThread", {
      id: thread.id,
      source: data.source,
      subject: data.subject,
    });
    return thread as unknown as ThreadRecord;
  },

  /**
   * Update an existing thread.
   */
  async updateThread(id: string, data: UpdateThreadData): Promise<ThreadRecord> {
    const updateData: Record<string, unknown> = {};

    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.ownerUserId !== undefined) updateData.ownerUserId = data.ownerUserId;
    if (data.queue !== undefined) updateData.queue = data.queue;
    if (data.clientOrPartnerTag !== undefined) updateData.clientOrPartnerTag = data.clientOrPartnerTag;
    if (data.participants !== undefined) updateData.participants = JSON.stringify(data.participants);
    if (data.secondaryOwnerIds !== undefined) updateData.secondaryOwnerIds = JSON.stringify(data.secondaryOwnerIds);
    if (data.lastMessageAt !== undefined) updateData.lastMessageAt = data.lastMessageAt;
    if (data.lastActionAt !== undefined) updateData.lastActionAt = data.lastActionAt;
    if (data.ttoDeadline !== undefined) updateData.ttoDeadline = data.ttoDeadline;
    if (data.ttfaDeadline !== undefined) updateData.ttfaDeadline = data.ttfaDeadline;
    if (data.tslaDeadline !== undefined) updateData.tslaDeadline = data.tslaDeadline;
    if (data.linkedRecords !== undefined) updateData.linkedRecords = JSON.stringify(data.linkedRecords);

    const thread = await prisma.commsThread.update({
      where: { id },
      data: updateData,
      include: {
        owner: { select: { id: true, name: true, team: true } },
      },
    });

    logger.info("threadRepository.updateThread", { id, fields: Object.keys(data) });
    return thread as unknown as ThreadRecord;
  },

  /**
   * Build a unified timeline for a thread by merging messages, notes,
   * ownership changes, and alerts into a single chronological list.
   */
  async getThreadTimeline(threadId: string): Promise<TimelineEntry[]> {
    const [messages, notes, changes, alerts] = await Promise.all([
      prisma.commsMessage.findMany({
        where: { threadId },
        orderBy: { timestamp: "asc" },
      }),
      prisma.threadNote.findMany({
        where: { threadId },
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      }),
      prisma.ownershipChange.findMany({
        where: { threadId },
        orderBy: { changedAt: "asc" },
        include: {
          oldOwner: { select: { id: true, name: true } },
          newOwner: { select: { id: true, name: true } },
          changedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.alert.findMany({
        where: { threadId },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const timeline: TimelineEntry[] = [];

    for (const msg of messages) {
      timeline.push({
        id: msg.id,
        type: "message",
        timestamp: msg.timestamp,
        actor: msg.authorName,
        actorType: msg.authorType,
        content: msg.bodySnippet,
        metadata: {
          authorEmail: msg.authorEmail,
          attachments: safeParseJson(msg.attachments),
          bodyLink: msg.bodyLink,
        },
      });
    }

    for (const note of notes) {
      timeline.push({
        id: note.id,
        type: "note",
        timestamp: note.createdAt,
        actor: (note as unknown as { author: { name: string } }).author?.name ?? note.authorId,
        content: note.content,
      });
    }

    for (const change of changes) {
      const c = change as unknown as {
        id: string;
        changedAt: Date;
        reason: string;
        handoverNote: string;
        oldOwner?: { name: string };
        newOwner?: { name: string };
        changedBy: { name: string };
      };
      timeline.push({
        id: c.id,
        type: "ownership_change",
        timestamp: c.changedAt,
        actor: c.changedBy.name,
        content: `Reassigned from ${c.oldOwner?.name ?? "unassigned"} to ${c.newOwner?.name ?? "unassigned"}`,
        metadata: {
          reason: c.reason,
          handoverNote: c.handoverNote,
          oldOwner: c.oldOwner?.name ?? null,
          newOwner: c.newOwner?.name ?? null,
        },
      });
    }

    for (const alert of alerts) {
      timeline.push({
        id: alert.id,
        type: "alert",
        timestamp: alert.createdAt,
        actor: "system",
        content: alert.message,
        metadata: {
          alertType: alert.type,
          priority: alert.priority,
          status: alert.status,
        },
      });
    }

    // Sort chronologically
    timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    logger.debug("threadRepository.getThreadTimeline", { threadId, entries: timeline.length });
    return timeline;
  },

  /**
   * Get all threads with no owner assigned.
   */
  async getUnownedThreads(): Promise<ThreadRecord[]> {
    const threads = await prisma.commsThread.findMany({
      where: {
        ownerUserId: null,
        status: { notIn: ["Done", "Closed"] },
      },
      include: {
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return threads as unknown as ThreadRecord[];
  },

  /**
   * Get all threads that have breached at least one SLA deadline.
   */
  async getBreachedSlaThreads(): Promise<ThreadRecord[]> {
    const now = new Date();
    const threads = await prisma.commsThread.findMany({
      where: {
        status: { notIn: ["Done", "Closed"] },
        OR: [
          { ttoDeadline: { lt: now } },
          { ttfaDeadline: { lt: now } },
          { tslaDeadline: { lt: now } },
        ],
      },
      include: {
        owner: { select: { id: true, name: true, team: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return threads as unknown as ThreadRecord[];
  },

  /**
   * Record an ownership change for audit trail.
   */
  async createOwnershipChange(data: {
    threadId: string;
    oldOwnerId: string | null;
    newOwnerId: string | null;
    changedById: string;
    reason: string;
    handoverNote?: string;
  }): Promise<void> {
    await prisma.ownershipChange.create({
      data: {
        threadId: data.threadId,
        oldOwnerId: data.oldOwnerId,
        newOwnerId: data.newOwnerId,
        changedById: data.changedById,
        reason: data.reason,
        handoverNote: data.handoverNote ?? "",
      },
    });
  },

  /**
   * Get ownership changes for a thread within a time window.
   * Used for bounce detection.
   */
  async getOwnershipChangesInWindow(
    threadId: string,
    since: Date,
  ): Promise<Array<{ id: string; changedAt: Date; oldOwnerId: string | null; newOwnerId: string | null }>> {
    const changes = await prisma.ownershipChange.findMany({
      where: {
        threadId,
        changedAt: { gte: since },
      },
      orderBy: { changedAt: "asc" },
    });
    return changes;
  },

  /**
   * Add a note to a thread.
   */
  async createThreadNote(data: {
    threadId: string;
    authorId: string;
    content: string;
  }): Promise<{ id: string; threadId: string; authorId: string; content: string; createdAt: Date }> {
    return prisma.threadNote.create({ data });
  },
};

// ─── Helpers ───

function buildThreadWhere(filters: ThreadFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
  }
  if (filters.priority) {
    where.priority = Array.isArray(filters.priority) ? { in: filters.priority } : filters.priority;
  }
  if (filters.source) where.source = filters.source;
  if (filters.queue) where.queue = filters.queue;
  if (filters.ownerUserId) where.ownerUserId = filters.ownerUserId;
  if (filters.clientOrPartnerTag) {
    where.clientOrPartnerTag = { contains: filters.clientOrPartnerTag, mode: "insensitive" };
  }
  if (filters.search) {
    where.OR = [
      { subject: { contains: filters.search, mode: "insensitive" } },
      { clientOrPartnerTag: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  if (filters.createdAfter || filters.createdBefore) {
    const createdAt: Record<string, Date> = {};
    if (filters.createdAfter) createdAt.gte = filters.createdAfter;
    if (filters.createdBefore) createdAt.lte = filters.createdBefore;
    where.createdAt = createdAt;
  }
  if (filters.slaBreached) {
    const now = new Date();
    where.OR = [
      { ttoDeadline: { lt: now } },
      { ttfaDeadline: { lt: now } },
      { tslaDeadline: { lt: now } },
    ];
  }

  return where;
}

function buildPagination(opts: ThreadPagination): { skip: number; take: number } {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  return { skip: (page - 1) * pageSize, take: pageSize };
}

function safeParseJson(value: unknown): unknown {
  if (value === null || value === undefined) return [];
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

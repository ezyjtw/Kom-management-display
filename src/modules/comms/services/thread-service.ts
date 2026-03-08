/**
 * Thread Domain Service
 *
 * Business logic for communication thread management including assignment
 * with forced reason capture, bounce detection, handover workflows,
 * collaborator/watcher roles, and unified timeline generation.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { ThreadStatus, ThreadPriority } from "@/types";
import {
  threadRepository,
  type ThreadFilters,
  type ThreadPagination,
  type CreateThreadData,
  type UpdateThreadData,
  type TimelineEntry,
  type ThreadRecord,
} from "@/modules/comms/repositories/thread-repository";

// ─── Constants ───

/** Maximum ownership changes in a 24h window before flagging as excessive. */
const BOUNCE_THRESHOLD = 2;

/** Duration (ms) for the bounce detection window. */
const BOUNCE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Types ───

export interface AssignThreadInput {
  threadId: string;
  newOwnerId: string;
  /** Required reason for the assignment or reassignment. */
  reason: string;
  /** Optional handover note for the incoming owner. */
  handoverNote?: string;
  /** ID of the user performing the assignment. */
  performedById: string;
}

export interface AssignThreadResult {
  thread: ThreadRecord;
  bounceDetected: boolean;
  bounceCount: number;
  handoverPending: boolean;
}

export interface HandoverStatus {
  threadId: string;
  fromOwnerId: string | null;
  toOwnerId: string;
  reason: string;
  handoverNote: string;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

/** Role a secondary participant plays on a thread. */
export type SecondaryRole = "collaborator" | "watcher";

export interface SecondaryParticipant {
  employeeId: string;
  role: SecondaryRole;
}

export interface BounceInfo {
  threadId: string;
  changeCount: number;
  isExcessive: boolean;
  windowStart: Date;
  changes: Array<{
    changedAt: Date;
    oldOwnerId: string | null;
    newOwnerId: string | null;
  }>;
}

// ─── Service ───

export const threadService = {
  // ──────────────────────────────
  // CRUD (delegates to repository)
  // ──────────────────────────────

  /**
   * List threads with filters and pagination.
   */
  async getThreads(filters?: ThreadFilters, pagination?: ThreadPagination) {
    return threadRepository.getThreads(filters, pagination);
  },

  /**
   * Get a single thread by ID with all related data.
   */
  async getThreadById(id: string) {
    return threadRepository.getThreadById(id);
  },

  /**
   * Create a new communication thread.
   */
  async createThread(data: CreateThreadData) {
    return threadRepository.createThread(data);
  },

  /**
   * Update thread fields (non-ownership fields).
   */
  async updateThread(id: string, data: UpdateThreadData) {
    return threadRepository.updateThread(id, data);
  },

  /**
   * Get threads with no owner.
   */
  async getUnownedThreads() {
    return threadRepository.getUnownedThreads();
  },

  /**
   * Get threads with breached SLAs.
   */
  async getBreachedSlaThreads() {
    return threadRepository.getBreachedSlaThreads();
  },

  // ──────────────────────────────
  // Thread assignment with forced reason
  // ──────────────────────────────

  /**
   * Assign or reassign a thread to an owner. Requires a reason for the
   * change and optionally a handover note. Records the ownership change
   * for audit, checks for excessive bouncing, and sets the thread status
   * to "Assigned" if it was previously "Unassigned".
   */
  async assignThread(input: AssignThreadInput): Promise<AssignThreadResult> {
    const { threadId, newOwnerId, reason, handoverNote, performedById } = input;

    if (!reason || reason.trim().length === 0) {
      throw new Error("A reason is required for thread assignment changes");
    }

    const thread = await threadRepository.getThreadById(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const oldOwnerId = thread.ownerUserId;

    // Record the ownership change
    await threadRepository.createOwnershipChange({
      threadId,
      oldOwnerId,
      newOwnerId,
      changedById: performedById,
      reason: reason.trim(),
      handoverNote: handoverNote?.trim(),
    });

    // Update the thread owner and status
    const newStatus: ThreadStatus =
      thread.status === "Unassigned" ? "Assigned" : (thread.status as ThreadStatus);

    const updated = await threadRepository.updateThread(threadId, {
      ownerUserId: newOwnerId,
      status: newStatus,
      lastActionAt: new Date(),
    });

    // Check for bounce
    const bounceInfo = await this.getBounceCount(threadId);

    // Create audit log
    await writeAuditLog("ownership_change", "thread", threadId, performedById, {
      oldOwnerId,
      newOwnerId,
      reason,
      handoverNote: handoverNote ?? "",
      bounceCount: bounceInfo.changeCount,
    });

    if (bounceInfo.isExcessive) {
      logger.warn("threadService.assignThread: excessive bouncing detected", {
        threadId,
        bounceCount: bounceInfo.changeCount,
      });
    }

    logger.info("threadService.assignThread", {
      threadId,
      oldOwnerId,
      newOwnerId,
      performedById,
      bounceCount: bounceInfo.changeCount,
    });

    return {
      thread: updated,
      bounceDetected: bounceInfo.isExcessive,
      bounceCount: bounceInfo.changeCount,
      handoverPending: !!handoverNote && handoverNote.trim().length > 0,
    };
  },

  // ──────────────────────────────
  // Bounce detection
  // ──────────────────────────────

  /**
   * Count ownership changes for a thread within the last 24 hours.
   * More than 2 changes is flagged as excessive bouncing.
   */
  async getBounceCount(threadId: string): Promise<BounceInfo> {
    const windowStart = new Date(Date.now() - BOUNCE_WINDOW_MS);
    const changes = await threadRepository.getOwnershipChangesInWindow(threadId, windowStart);

    return {
      threadId,
      changeCount: changes.length,
      isExcessive: changes.length > BOUNCE_THRESHOLD,
      windowStart,
      changes: changes.map((c) => ({
        changedAt: c.changedAt,
        oldOwnerId: c.oldOwnerId,
        newOwnerId: c.newOwnerId,
      })),
    };
  },

  // ──────────────────────────────
  // Handover acknowledgement
  // ──────────────────────────────

  /**
   * Get the pending handover status for a thread, if any.
   * A handover is "pending" when the most recent ownership change has a
   * handover note but has not been acknowledged by the new owner.
   */
  async getPendingHandover(threadId: string): Promise<HandoverStatus | null> {
    const changes = await prisma.ownershipChange.findMany({
      where: { threadId },
      orderBy: { changedAt: "desc" },
      take: 1,
    });

    if (changes.length === 0) return null;

    const latest = changes[0];
    if (!latest.handoverNote || latest.handoverNote.trim() === "") return null;

    // Check if there's an acknowledgement note from the new owner after the change
    const ackNote = latest.newOwnerId
      ? await prisma.threadNote.findFirst({
          where: {
            threadId,
            authorId: latest.newOwnerId,
            createdAt: { gt: latest.changedAt },
            content: { startsWith: "[HANDOVER_ACK]" },
          },
        })
      : null;

    return {
      threadId,
      fromOwnerId: latest.oldOwnerId,
      toOwnerId: latest.newOwnerId ?? "",
      reason: latest.reason,
      handoverNote: latest.handoverNote,
      acknowledged: !!ackNote,
      acknowledgedAt: ackNote?.createdAt ?? null,
      createdAt: latest.changedAt,
    };
  },

  /**
   * Acknowledge a pending handover. Creates a thread note with a special
   * prefix so the system can detect acknowledgement.
   */
  async acknowledgeHandover(
    threadId: string,
    acknowledgedById: string,
    message = "",
  ): Promise<void> {
    const content = `[HANDOVER_ACK] ${message}`.trim();
    await threadRepository.createThreadNote({
      threadId,
      authorId: acknowledgedById,
      content,
    });

    logger.info("threadService.acknowledgeHandover", { threadId, acknowledgedById });
  },

  // ──────────────────────────────
  // Collaborator vs watcher roles
  // ──────────────────────────────

  /**
   * Get secondary participants (collaborators and watchers) for a thread.
   * The secondaryOwnerIds field stores a JSON array. Roles are differentiated
   * by a prefix convention: "collab:id" vs "watch:id".
   */
  async getSecondaryParticipants(threadId: string): Promise<SecondaryParticipant[]> {
    const thread = await prisma.commsThread.findUnique({
      where: { id: threadId },
      select: { secondaryOwnerIds: true },
    });
    if (!thread) return [];

    return parseSecondaryOwnerIds(thread.secondaryOwnerIds);
  },

  /**
   * Add a secondary participant with a specific role.
   */
  async addSecondaryParticipant(
    threadId: string,
    employeeId: string,
    role: SecondaryRole,
  ): Promise<SecondaryParticipant[]> {
    const thread = await prisma.commsThread.findUnique({
      where: { id: threadId },
      select: { secondaryOwnerIds: true },
    });
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const participants = parseSecondaryOwnerIds(thread.secondaryOwnerIds);

    // Remove existing entry for this employee (in case they're changing roles)
    const filtered = participants.filter((p) => p.employeeId !== employeeId);
    filtered.push({ employeeId, role });

    await prisma.commsThread.update({
      where: { id: threadId },
      data: { secondaryOwnerIds: serializeSecondaryOwnerIds(filtered) },
    });

    logger.info("threadService.addSecondaryParticipant", { threadId, employeeId, role });
    return filtered;
  },

  /**
   * Remove a secondary participant from a thread.
   */
  async removeSecondaryParticipant(
    threadId: string,
    employeeId: string,
  ): Promise<SecondaryParticipant[]> {
    const thread = await prisma.commsThread.findUnique({
      where: { id: threadId },
      select: { secondaryOwnerIds: true },
    });
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    const participants = parseSecondaryOwnerIds(thread.secondaryOwnerIds);
    const filtered = participants.filter((p) => p.employeeId !== employeeId);

    await prisma.commsThread.update({
      where: { id: threadId },
      data: { secondaryOwnerIds: serializeSecondaryOwnerIds(filtered) },
    });

    logger.info("threadService.removeSecondaryParticipant", { threadId, employeeId });
    return filtered;
  },

  // ──────────────────────────────
  // Thread timeline
  // ──────────────────────────────

  /**
   * Generate a unified timeline for a thread. Merges messages, notes,
   * ownership changes, alerts, SLA breaches, and status changes into a
   * single chronological view.
   */
  async getThreadTimeline(threadId: string): Promise<TimelineEntry[]> {
    return threadRepository.getThreadTimeline(threadId);
  },

  // ──────────────────────────────
  // Thread notes
  // ──────────────────────────────

  /**
   * Add a note to a thread.
   */
  async addNote(threadId: string, authorId: string, content: string) {
    return threadRepository.createThreadNote({ threadId, authorId, content });
  },
};

// ─── Internal Helpers ───

/**
 * Parse the secondaryOwnerIds JSON string into structured participants.
 * Supports two formats:
 *   - New: ["collab:id1", "watch:id2"]
 *   - Legacy: ["id1", "id2"] (treated as collaborators)
 */
function parseSecondaryOwnerIds(raw: unknown): SecondaryParticipant[] {
  let parsed: string[];
  if (Array.isArray(raw)) {
    parsed = raw as string[];
  } else if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  } else {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.map((entry) => {
    if (entry.startsWith("collab:")) {
      return { employeeId: entry.slice(7), role: "collaborator" as SecondaryRole };
    }
    if (entry.startsWith("watch:")) {
      return { employeeId: entry.slice(6), role: "watcher" as SecondaryRole };
    }
    // Legacy format: bare ID treated as collaborator
    return { employeeId: entry, role: "collaborator" as SecondaryRole };
  });
}

function serializeSecondaryOwnerIds(participants: SecondaryParticipant[]): string {
  return JSON.stringify(
    participants.map((p) =>
      p.role === "watcher" ? `watch:${p.employeeId}` : `collab:${p.employeeId}`,
    ),
  );
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string,
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        userId,
        details: JSON.stringify(details),
      },
    });
  } catch (err) {
    logger.error("Failed to write audit log", { action, entityType, entityId, error: String(err) });
  }
}

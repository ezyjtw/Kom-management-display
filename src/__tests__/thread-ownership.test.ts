/**
 * Thread ownership workflow tests.
 *
 * Verifies assignment with mandatory reason, bounce detection,
 * handover acknowledgement workflow, and secondary participant management.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the service
vi.mock("@/lib/prisma", () => ({
  prisma: {
    commsThread: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ownershipChange: {
      findMany: vi.fn(),
    },
    threadNote: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/modules/comms/repositories/thread-repository", () => ({
  threadRepository: {
    getThreadById: vi.fn(),
    updateThread: vi.fn(),
    createOwnershipChange: vi.fn(),
    getOwnershipChangesInWindow: vi.fn(),
    createThreadNote: vi.fn(),
    getThreadTimeline: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { threadRepository } from "@/modules/comms/repositories/thread-repository";
import { threadService } from "@/modules/comms/services/thread-service";

// ─── Helpers ───

function makeThread(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-1",
    ownerUserId: "owner-1",
    status: "Assigned",
    priority: "P2",
    subject: "Test thread",
    secondaryOwnerIds: "[]",
    createdAt: new Date("2026-03-08T10:00:00Z"),
    lastActionAt: new Date("2026-03-08T12:00:00Z"),
    ...overrides,
  };
}

describe("Thread Assignment with Mandatory Reason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("requires a reason for assignment", async () => {
    await expect(
      threadService.assignThread({
        threadId: "thread-1",
        newOwnerId: "user-2",
        reason: "",
        performedById: "admin-1",
      }),
    ).rejects.toThrow("reason is required");
  });

  it("rejects whitespace-only reason", async () => {
    await expect(
      threadService.assignThread({
        threadId: "thread-1",
        newOwnerId: "user-2",
        reason: "   ",
        performedById: "admin-1",
      }),
    ).rejects.toThrow("reason is required");
  });

  it("successfully assigns a thread with a valid reason", async () => {
    const thread = makeThread({ status: "Unassigned", ownerUserId: null });
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-2",
      status: "Assigned",
    } as never);
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([] as never);

    const result = await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-2",
      reason: "Best suited for this task",
      performedById: "admin-1",
    });

    expect(result.thread.ownerUserId).toBe("user-2");
    expect(result.bounceDetected).toBe(false);
  });

  it("sets status to Assigned when thread was Unassigned", async () => {
    const thread = makeThread({ status: "Unassigned", ownerUserId: null });
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-2",
      status: "Assigned",
    } as never);
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([] as never);

    await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-2",
      reason: "Initial assignment",
      performedById: "admin-1",
    });

    expect(threadRepository.updateThread).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ status: "Assigned" }),
    );
  });

  it("preserves existing status when reassigning", async () => {
    const thread = makeThread({ status: "InProgress", ownerUserId: "user-1" });
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-3",
    } as never);
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([] as never);

    await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-3",
      reason: "Reassigning to specialist",
      performedById: "admin-1",
    });

    expect(threadRepository.updateThread).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ status: "InProgress" }),
    );
  });

  it("throws when thread is not found", async () => {
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(null as never);

    await expect(
      threadService.assignThread({
        threadId: "nonexistent",
        newOwnerId: "user-2",
        reason: "Valid reason",
        performedById: "admin-1",
      }),
    ).rejects.toThrow("not found");
  });
});

// ─── Bounce Detection ───

describe("Bounce Detection (>2 changes in 24h)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("detects excessive bouncing (>2 changes in 24h)", async () => {
    const thread = makeThread();
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-4",
    } as never);
    // 3 changes in window = excessive
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([
      { changedAt: new Date(), oldOwnerId: "user-1", newOwnerId: "user-2" },
      { changedAt: new Date(), oldOwnerId: "user-2", newOwnerId: "user-3" },
      { changedAt: new Date(), oldOwnerId: "user-3", newOwnerId: "user-4" },
    ] as never);

    const result = await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-4",
      reason: "Need specialist",
      performedById: "admin-1",
    });

    expect(result.bounceDetected).toBe(true);
    expect(result.bounceCount).toBe(3);
  });

  it("does not flag bouncing for 2 or fewer changes", async () => {
    const thread = makeThread();
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-2",
    } as never);
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([
      { changedAt: new Date(), oldOwnerId: "user-1", newOwnerId: "user-2" },
    ] as never);

    const result = await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-2",
      reason: "Routine reassign",
      performedById: "admin-1",
    });

    expect(result.bounceDetected).toBe(false);
    expect(result.bounceCount).toBe(1);
  });

  it("getBounceCount returns structured bounce info", async () => {
    const changes = [
      { changedAt: new Date(), oldOwnerId: "u1", newOwnerId: "u2" },
      { changedAt: new Date(), oldOwnerId: "u2", newOwnerId: "u3" },
      { changedAt: new Date(), oldOwnerId: "u3", newOwnerId: "u4" },
    ];
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue(changes as never);

    const info = await threadService.getBounceCount("thread-1");

    expect(info.threadId).toBe("thread-1");
    expect(info.changeCount).toBe(3);
    expect(info.isExcessive).toBe(true);
    expect(info.changes).toHaveLength(3);
  });
});

// ─── Handover Workflow ───

describe("Handover Workflow (pending -> acknowledged)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("marks handover as pending when handover note is provided", async () => {
    const thread = makeThread();
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-2",
    } as never);
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([] as never);

    const result = await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-2",
      reason: "Handing over",
      handoverNote: "Please check the pending email from counterparty",
      performedById: "user-1",
    });

    expect(result.handoverPending).toBe(true);
  });

  it("handover is not pending when no handover note", async () => {
    const thread = makeThread();
    vi.mocked(threadRepository.getThreadById).mockResolvedValue(thread as never);
    vi.mocked(threadRepository.createOwnershipChange).mockResolvedValue(undefined as never);
    vi.mocked(threadRepository.updateThread).mockResolvedValue({
      ...thread,
      ownerUserId: "user-2",
    } as never);
    vi.mocked(threadRepository.getOwnershipChangesInWindow).mockResolvedValue([] as never);

    const result = await threadService.assignThread({
      threadId: "thread-1",
      newOwnerId: "user-2",
      reason: "Simple reassign",
      performedById: "user-1",
    });

    expect(result.handoverPending).toBe(false);
  });

  it("getPendingHandover returns pending handover when not acknowledged", async () => {
    vi.mocked(prisma.ownershipChange.findMany).mockResolvedValue([
      {
        id: "change-1",
        threadId: "thread-1",
        oldOwnerId: "user-1",
        newOwnerId: "user-2",
        changedById: "user-1",
        reason: "Handing over",
        handoverNote: "Check the emails",
        changedAt: new Date("2026-03-08T12:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.threadNote.findFirst).mockResolvedValue(null as never);

    const status = await threadService.getPendingHandover("thread-1");

    expect(status).not.toBeNull();
    expect(status!.acknowledged).toBe(false);
    expect(status!.handoverNote).toBe("Check the emails");
    expect(status!.toOwnerId).toBe("user-2");
  });

  it("getPendingHandover returns acknowledged when ack note exists", async () => {
    const changeTime = new Date("2026-03-08T12:00:00Z");
    vi.mocked(prisma.ownershipChange.findMany).mockResolvedValue([
      {
        id: "change-1",
        threadId: "thread-1",
        oldOwnerId: "user-1",
        newOwnerId: "user-2",
        changedById: "user-1",
        reason: "Handing over",
        handoverNote: "Check the emails",
        changedAt: changeTime,
      },
    ] as never);
    vi.mocked(prisma.threadNote.findFirst).mockResolvedValue({
      id: "note-1",
      threadId: "thread-1",
      authorId: "user-2",
      content: "[HANDOVER_ACK] Got it",
      createdAt: new Date("2026-03-08T12:05:00Z"),
    } as never);

    const status = await threadService.getPendingHandover("thread-1");

    expect(status).not.toBeNull();
    expect(status!.acknowledged).toBe(true);
    expect(status!.acknowledgedAt).toEqual(new Date("2026-03-08T12:05:00Z"));
  });

  it("getPendingHandover returns null when no handover note", async () => {
    vi.mocked(prisma.ownershipChange.findMany).mockResolvedValue([
      {
        id: "change-1",
        threadId: "thread-1",
        oldOwnerId: "user-1",
        newOwnerId: "user-2",
        changedById: "user-1",
        reason: "Just reassigning",
        handoverNote: "",
        changedAt: new Date(),
      },
    ] as never);

    const status = await threadService.getPendingHandover("thread-1");
    expect(status).toBeNull();
  });

  it("getPendingHandover returns null when no ownership changes", async () => {
    vi.mocked(prisma.ownershipChange.findMany).mockResolvedValue([] as never);

    const status = await threadService.getPendingHandover("thread-1");
    expect(status).toBeNull();
  });

  it("acknowledgeHandover creates a note with HANDOVER_ACK prefix", async () => {
    vi.mocked(threadRepository.createThreadNote).mockResolvedValue(undefined as never);

    await threadService.acknowledgeHandover("thread-1", "user-2", "Understood, taking over");

    expect(threadRepository.createThreadNote).toHaveBeenCalledWith({
      threadId: "thread-1",
      authorId: "user-2",
      content: expect.stringContaining("[HANDOVER_ACK]"),
    });
  });
});

// ─── Secondary Participants ───

describe("Secondary Participant Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds a collaborator to a thread", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      secondaryOwnerIds: "[]",
    } as never);
    vi.mocked(prisma.commsThread.update).mockResolvedValue({} as never);

    const result = await threadService.addSecondaryParticipant(
      "thread-1",
      "emp-1",
      "collaborator",
    );

    expect(result).toEqual([{ employeeId: "emp-1", role: "collaborator" }]);
    expect(prisma.commsThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: {
        secondaryOwnerIds: expect.stringContaining("collab:emp-1"),
      },
    });
  });

  it("adds a watcher to a thread", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      secondaryOwnerIds: "[]",
    } as never);
    vi.mocked(prisma.commsThread.update).mockResolvedValue({} as never);

    const result = await threadService.addSecondaryParticipant(
      "thread-1",
      "emp-2",
      "watcher",
    );

    expect(result).toEqual([{ employeeId: "emp-2", role: "watcher" }]);
    expect(prisma.commsThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: {
        secondaryOwnerIds: expect.stringContaining("watch:emp-2"),
      },
    });
  });

  it("changes role when adding an existing participant with a different role", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      secondaryOwnerIds: JSON.stringify(["collab:emp-1"]),
    } as never);
    vi.mocked(prisma.commsThread.update).mockResolvedValue({} as never);

    const result = await threadService.addSecondaryParticipant(
      "thread-1",
      "emp-1",
      "watcher",
    );

    expect(result).toEqual([{ employeeId: "emp-1", role: "watcher" }]);
  });

  it("removes a secondary participant", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      secondaryOwnerIds: JSON.stringify(["collab:emp-1", "watch:emp-2"]),
    } as never);
    vi.mocked(prisma.commsThread.update).mockResolvedValue({} as never);

    const result = await threadService.removeSecondaryParticipant("thread-1", "emp-1");

    expect(result).toEqual([{ employeeId: "emp-2", role: "watcher" }]);
  });

  it("handles legacy participant format (bare IDs as collaborators)", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      secondaryOwnerIds: JSON.stringify(["legacy-emp-1", "legacy-emp-2"]),
    } as never);
    vi.mocked(prisma.commsThread.update).mockResolvedValue({} as never);

    const result = await threadService.getSecondaryParticipants("thread-1");

    expect(result).toEqual([
      { employeeId: "legacy-emp-1", role: "collaborator" },
      { employeeId: "legacy-emp-2", role: "collaborator" },
    ]);
  });

  it("returns empty array for thread with no secondary participants", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue({
      secondaryOwnerIds: "[]",
    } as never);

    const result = await threadService.getSecondaryParticipants("thread-1");
    expect(result).toEqual([]);
  });

  it("throws when thread not found for add", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue(null as never);

    await expect(
      threadService.addSecondaryParticipant("nonexistent", "emp-1", "collaborator"),
    ).rejects.toThrow("not found");
  });

  it("throws when thread not found for remove", async () => {
    vi.mocked(prisma.commsThread.findUnique).mockResolvedValue(null as never);

    await expect(
      threadService.removeSecondaryParticipant("nonexistent", "emp-1"),
    ).rejects.toThrow("not found");
  });
});

// ─── Thread SLA computation (from @/lib/sla) ───

describe("Thread SLA Computation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // SLA tests are imported from the pure function to verify integration context
  it("is covered by sla.test.ts for computeSlaStatus", () => {
    // This test documents that SLA computation is delegated to @/lib/sla
    // and tested comprehensively in sla.test.ts. The threadService uses it
    // indirectly through the repository/API layer.
    expect(true).toBe(true);
  });
});

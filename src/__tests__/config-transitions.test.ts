/**
 * Scoring config state machine tests.
 *
 * Verifies valid and invalid transitions through the config approval
 * workflow: draft -> review -> approved -> active -> archived.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the service
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scoringConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
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
import { scoringService, type ConfigStatus } from "@/modules/scoring/services/scoring-service";

// ─── Helpers ───

function makeScoringConfigRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "config-1",
    version: "v2.0",
    config: JSON.stringify({ version: "v2.0", weights: {} }),
    active: false,
    createdBy: "user-1",
    createdAt: new Date(),
    notes: JSON.stringify({ status: "draft" }),
    ...overrides,
  };
}

describe("Scoring Config State Machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: audit log succeeds
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  // ─── Valid transitions ───

  describe("Valid transitions", () => {
    it("draft -> review", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "draft" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        notes: JSON.stringify({ status: "review" }),
      } as never);

      const result = await scoringService.transitionConfig("config-1", "review", "user-1", "Ready for review");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("draft");
      expect(result.newStatus).toBe("review");
    });

    it("review -> approved", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "review" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        notes: JSON.stringify({ status: "approved" }),
      } as never);

      const result = await scoringService.transitionConfig("config-1", "approved", "user-1", "Looks good");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("review");
      expect(result.newStatus).toBe("approved");
    });

    it("approved -> active (deactivates other configs)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "approved" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.updateMany).mockResolvedValue({ count: 1 } as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        active: true,
        notes: JSON.stringify({ status: "active" }),
      } as never);

      const result = await scoringService.transitionConfig("config-1", "active", "user-1", "Go live");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("approved");
      expect(result.newStatus).toBe("active");
      // Ensure all other active configs were deactivated
      expect(prisma.scoringConfig.updateMany).toHaveBeenCalledWith({
        where: { active: true },
        data: { active: false },
      });
    });

    it("active -> archived", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "active" }),
        active: true,
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        active: false,
        notes: JSON.stringify({ status: "archived" }),
      } as never);

      const result = await scoringService.transitionConfig("config-1", "archived", "user-1", "Replacing with v3");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("active");
      expect(result.newStatus).toBe("archived");
    });

    it("draft -> archived (shortcut to retire a draft)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "draft" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        notes: JSON.stringify({ status: "archived" }),
      } as never);

      const result = await scoringService.transitionConfig("config-1", "archived", "user-1", "No longer needed");

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("archived");
    });

    it("review -> draft (send back for rework)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "review" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        notes: JSON.stringify({ status: "draft" }),
      } as never);

      const result = await scoringService.transitionConfig("config-1", "draft", "user-1", "Needs changes");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("review");
      expect(result.newStatus).toBe("draft");
    });
  });

  // ─── Invalid transitions ───

  describe("Invalid transitions", () => {
    it("draft -> active (cannot skip review and approval)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "draft" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);

      const result = await scoringService.transitionConfig("config-1", "active", "user-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
      expect(result.error).toContain("draft -> active");
      expect(result.newStatus).toBe("draft"); // unchanged
    });

    it("archived -> active (cannot reactivate archived config)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "archived" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);

      const result = await scoringService.transitionConfig("config-1", "active", "user-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
      expect(result.error).toContain("archived -> active");
    });

    it("active -> draft (cannot go back to draft from active)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "active" }),
        active: true,
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);

      const result = await scoringService.transitionConfig("config-1", "draft", "user-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
      expect(result.error).toContain("active -> draft");
    });

    it("draft -> approved (cannot skip review)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "draft" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);

      const result = await scoringService.transitionConfig("config-1", "approved", "user-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
    });

    it("archived -> review (archived is terminal)", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "archived" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);

      const result = await scoringService.transitionConfig("config-1", "review", "user-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
    });
  });

  // ─── Only one active config ───

  describe("Only one active config at a time", () => {
    it("deactivates all existing active configs when activating a new one", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "approved" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.updateMany).mockResolvedValue({ count: 2 } as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        active: true,
        notes: JSON.stringify({ status: "active" }),
      } as never);

      await scoringService.transitionConfig("config-1", "active", "user-1");

      expect(prisma.scoringConfig.updateMany).toHaveBeenCalledWith({
        where: { active: true },
        data: { active: false },
      });
    });

    it("does not call updateMany when transitioning to non-active status", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "draft" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        notes: JSON.stringify({ status: "review" }),
      } as never);

      await scoringService.transitionConfig("config-1", "review", "user-1");

      expect(prisma.scoringConfig.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─── Audit logging ───

  describe("Audit logging", () => {
    it("records an audit log entry on successful transition", async () => {
      const record = makeScoringConfigRecord({
        notes: JSON.stringify({ status: "draft" }),
      });
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(record as never);
      vi.mocked(prisma.scoringConfig.update).mockResolvedValue({
        ...record,
        notes: JSON.stringify({ status: "review" }),
      } as never);

      await scoringService.transitionConfig("config-1", "review", "user-1", "Submitting");

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "config_transition",
            entityType: "scoring_config",
            entityId: "config-1",
            userId: "user-1",
          }),
        }),
      );
    });
  });

  // ─── Error handling ───

  describe("Error handling", () => {
    it("throws when config is not found", async () => {
      vi.mocked(prisma.scoringConfig.findUnique).mockResolvedValue(null as never);

      await expect(
        scoringService.transitionConfig("nonexistent", "review", "user-1"),
      ).rejects.toThrow("not found");
    });
  });
});

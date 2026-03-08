/**
 * Travel rule case lifecycle tests.
 *
 * Verifies valid and invalid state transitions, SLA deadline management,
 * resolution requirements, and escalation behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    travelRuleCase: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    caseNote: {
      create: vi.fn(),
      findMany: vi.fn(),
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
import { travelRuleService, type CaseStatus } from "@/modules/travel-rule/services/travel-rule-service";

// ─── Helpers ───

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    transactionId: "tx-123",
    txHash: "0xabc",
    direction: "outgoing",
    asset: "BTC",
    amount: 1.5,
    senderAddress: "0xSENDER",
    receiverAddress: "0xRECEIVER",
    matchStatus: "matched",
    notabeneTransferId: null,
    ownerUserId: "user-1",
    status: "Open",
    resolutionType: null,
    resolutionNote: "",
    emailSentTo: null,
    emailSentAt: null,
    slaDeadline: new Date("2026-03-10T10:00:00Z"),
    createdAt: new Date("2026-03-08T10:00:00Z"),
    updatedAt: new Date("2026-03-08T10:00:00Z"),
    resolvedAt: null,
    ...overrides,
  };
}

describe("Travel Rule Case Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.caseNote.create).mockResolvedValue({} as never);
  });

  // ─── Case creation ───

  describe("Case creation", () => {
    it("creates a case with Open status", async () => {
      vi.mocked(prisma.travelRuleCase.create).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );

      const result = await travelRuleService.createCase({
        transactionId: "tx-123",
        direction: "outgoing",
        asset: "BTC",
        amount: 1.5,
        matchStatus: "matched",
      });

      expect(result.status).toBe("Open");
      expect(prisma.travelRuleCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "Open",
          }),
        }),
      );
    });

    it("sets default SLA deadline of 48 hours when not provided", async () => {
      (prisma.travelRuleCase.create as ReturnType<typeof vi.fn>).mockImplementation(async (args: Record<string, unknown>) => {
        return makeCase({ slaDeadline: (args as { data: { slaDeadline: Date } }).data.slaDeadline });
      });

      const result = await travelRuleService.createCase({
        transactionId: "tx-456",
        direction: "incoming",
        asset: "ETH",
        amount: 10,
        matchStatus: "unmatched",
      });

      const deadline = result.slaDeadline as Date;
      const expectedMs = 48 * 60 * 60 * 1000;
      // Deadline should be approximately 48h from now
      const diff = deadline.getTime() - Date.now();
      expect(diff).toBeGreaterThan(expectedMs - 5000);
      expect(diff).toBeLessThanOrEqual(expectedMs + 1000);
    });

    it("uses provided SLA deadline when given", async () => {
      const customDeadline = new Date("2026-03-12T10:00:00Z");
      (prisma.travelRuleCase.create as ReturnType<typeof vi.fn>).mockImplementation(async (args: Record<string, unknown>) => {
        return makeCase({ slaDeadline: (args as { data: { slaDeadline: Date } }).data.slaDeadline });
      });

      const result = await travelRuleService.createCase({
        transactionId: "tx-789",
        direction: "outgoing",
        asset: "USDC",
        amount: 5000,
        matchStatus: "matched",
        slaDeadline: customDeadline,
      });

      expect(result.slaDeadline).toEqual(customDeadline);
    });
  });

  // ─── Valid transitions ───

  describe("Valid state transitions", () => {
    it("Open -> Investigating", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Investigating",
        performedById: "user-1",
        note: "Starting investigation",
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("Open");
      expect(result.newStatus).toBe("Investigating");
    });

    it("Open -> Resolved (with resolution type)", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Resolved" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Resolved",
        performedById: "user-1",
        resolutionType: "not_required",
        resolutionNote: "Travel rule not applicable",
      });

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("Resolved");
    });

    it("Investigating -> PendingResponse", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "PendingResponse" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "PendingResponse",
        performedById: "user-1",
      });

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("PendingResponse");
    });

    it("Investigating -> Resolved", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Resolved" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Resolved",
        performedById: "user-1",
        resolutionType: "info_obtained",
      });

      expect(result.success).toBe(true);
    });

    it("Investigating -> Open (send back)", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Open",
        performedById: "user-1",
        note: "Need more info before investigating",
      });

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("Open");
    });

    it("PendingResponse -> Investigating", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "PendingResponse" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Investigating",
        performedById: "user-1",
      });

      expect(result.success).toBe(true);
    });

    it("PendingResponse -> Resolved", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "PendingResponse" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Resolved" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Resolved",
        performedById: "user-1",
        resolutionType: "email_sent",
      });

      expect(result.success).toBe(true);
    });
  });

  // ─── Invalid transitions ───

  describe("Invalid transitions rejected", () => {
    it("Resolved is terminal - cannot transition out", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Resolved" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Open",
        performedById: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
      expect(result.error).toContain("Resolved -> Open");
    });

    it("Resolved -> Investigating is rejected", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Resolved" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Investigating",
        performedById: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
    });

    it("Open -> PendingResponse is rejected (must go through Investigating)", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "PendingResponse",
        performedById: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
    });

    it("PendingResponse -> Open is rejected", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "PendingResponse" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Open",
        performedById: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid transition");
    });
  });

  // ─── Resolution type requirement ───

  describe("Resolution type requirement", () => {
    it("resolving without resolutionType fails", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );

      const result = await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Resolved",
        performedById: "user-1",
        // no resolutionType
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Resolution type is required");
    });

    it("sets resolvedAt when resolving", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Resolved" }) as never,
      );

      await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Resolved",
        performedById: "user-1",
        resolutionType: "info_obtained",
        resolutionNote: "Got the data",
      });

      expect(prisma.travelRuleCase.update).toHaveBeenCalledWith({
        where: { id: "case-1" },
        data: expect.objectContaining({
          status: "Resolved",
          resolvedAt: expect.any(Date),
          resolutionType: "info_obtained",
          resolutionNote: "Got the data",
        }),
      });
    });
  });

  // ─── SLA deadline management ───

  describe("SLA deadline management", () => {
    it("extendSlaDeadline updates the deadline and creates a note", async () => {
      const newDeadline = new Date("2026-03-15T10:00:00Z");
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ slaDeadline: newDeadline }) as never,
      );

      const result = await travelRuleService.extendSlaDeadline(
        "case-1",
        newDeadline,
        "Counterparty needs more time",
        "user-1",
      );

      expect(result.slaDeadline).toEqual(newDeadline);
      expect(prisma.caseNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("[SLA Extended]"),
          }),
        }),
      );
    });

    it("getOverdueCases finds cases past their SLA deadline", async () => {
      const overdueCase = makeCase({
        status: "Investigating",
        slaDeadline: new Date("2026-03-07T10:00:00Z"), // past
      });
      vi.mocked(prisma.travelRuleCase.findMany).mockResolvedValue([overdueCase] as never);

      const result = await travelRuleService.getOverdueCases();

      expect(result).toHaveLength(1);
      expect(prisma.travelRuleCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: "Resolved" },
            slaDeadline: { lt: expect.any(Date) },
          }),
        }),
      );
    });
  });

  // ─── Escalation ───

  describe("Escalation", () => {
    it("escalates a case and transitions Open to Investigating", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      const result = await travelRuleService.escalateCase(
        "case-1",
        "Compliance Lead",
        "High value transaction needs attention",
        "user-1",
      );

      expect(prisma.travelRuleCase.update).toHaveBeenCalledWith({
        where: { id: "case-1" },
        data: expect.objectContaining({ status: "Investigating" }),
      });
      expect(prisma.caseNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("[ESCALATION to Compliance Lead]"),
          }),
        }),
      );
    });

    it("escalation does not change status if already Investigating", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      await travelRuleService.escalateCase(
        "case-1",
        "Head of Compliance",
        "Needs immediate attention",
        "user-1",
      );

      // Update is called but without status change
      expect(prisma.travelRuleCase.update).toHaveBeenCalledWith({
        where: { id: "case-1" },
        data: {},
      });
    });

    it("throws when case not found for escalation", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(null as never);

      await expect(
        travelRuleService.escalateCase("nonexistent", "Lead", "Reason", "user-1"),
      ).rejects.toThrow("not found");
    });

    it("writes an audit log for escalation", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      await travelRuleService.escalateCase(
        "case-1",
        "Compliance Lead",
        "Urgent",
        "user-1",
      );

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "case_escalated",
            entityType: "travel_rule_case",
          }),
        }),
      );
    });
  });

  // ─── Transition notes ───

  describe("Transition note recording", () => {
    it("creates a case note when note is provided on transition", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Investigating",
        performedById: "user-1",
        note: "Starting deep investigation",
      });

      expect(prisma.caseNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            caseId: "case-1",
            authorId: "user-1",
            content: expect.stringContaining("[Open -> Investigating]"),
          }),
        }),
      );
    });

    it("does not create a note when no note is provided", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(
        makeCase({ status: "Open" }) as never,
      );
      vi.mocked(prisma.travelRuleCase.update).mockResolvedValue(
        makeCase({ status: "Investigating" }) as never,
      );

      await travelRuleService.transitionCase({
        caseId: "case-1",
        targetStatus: "Investigating",
        performedById: "user-1",
      });

      expect(prisma.caseNote.create).not.toHaveBeenCalled();
    });
  });

  // ─── Error handling ───

  describe("Error handling", () => {
    it("throws when case not found for transition", async () => {
      vi.mocked(prisma.travelRuleCase.findUnique).mockResolvedValue(null as never);

      await expect(
        travelRuleService.transitionCase({
          caseId: "nonexistent",
          targetStatus: "Investigating",
          performedById: "user-1",
        }),
      ).rejects.toThrow("not found");
    });
  });
});

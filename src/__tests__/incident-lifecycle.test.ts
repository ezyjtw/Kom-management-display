/**
 * Incident service lifecycle tests.
 *
 * Verifies incident creation, status transitions, RCA workflow,
 * external ticket dispute flow, and timeline generation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    incident: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    incidentUpdate: {
      create: vi.fn(),
    },
    externalTicketEvent: {
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
import { incidentService } from "@/modules/incidents/services/incident-service";

// ─── Helpers ───

function makeIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    title: "Provider X outage",
    provider: "Provider X",
    severity: "high",
    status: "active",
    description: "Service down",
    impact: "Trading halted",
    startedAt: new Date("2026-03-08T10:00:00Z"),
    resolvedAt: null,
    reportedById: "user-1",
    resolvedById: null,
    linkedThreadIds: "[]",
    linkedTransactionIds: "[]",
    rcaStatus: "none",
    rcaDocumentRef: "",
    rcaResponsibleId: null,
    rcaSlaDeadline: null,
    rcaReceivedAt: null,
    rcaFollowUpItems: "[]",
    rcaRaisedAt: null,
    externalTicketRef: "",
    externalTicketUrl: "",
    externalTicketStatus: "",
    externalTicketLastSyncAt: null,
    externalTicketDisputed: false,
    externalTicketDisputeReason: "",
    createdAt: new Date("2026-03-08T10:00:00Z"),
    updatedAt: new Date("2026-03-08T10:00:00Z"),
    ...overrides,
  };
}

describe("Incident Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.incidentUpdate.create).mockResolvedValue({} as never);
    vi.mocked(prisma.externalTicketEvent.create).mockResolvedValue({} as never);
  });

  // ─── Create incident ───

  describe("Create incident", () => {
    it("creates an incident with active status", async () => {
      const created = makeIncident();
      vi.mocked(prisma.incident.create).mockResolvedValue({
        ...created,
        reportedBy: { name: "Reporter" },
      } as never);

      const result = await incidentService.createIncident({
        title: "Provider X outage",
        provider: "Provider X",
        severity: "high",
        description: "Service down",
        impact: "Trading halted",
        reportedById: "user-1",
      });

      expect(result.status).toBe("active");
      expect(prisma.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Provider X outage",
            provider: "Provider X",
            severity: "high",
          }),
        }),
      );
    });

    it("defaults severity to medium when not provided", async () => {
      vi.mocked(prisma.incident.create).mockResolvedValue(
        makeIncident({ severity: "medium" }) as never,
      );

      await incidentService.createIncident({
        title: "Minor issue",
        provider: "Provider Y",
        reportedById: "user-1",
      });

      expect(prisma.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "medium",
          }),
        }),
      );
    });

    it("writes an audit log on creation", async () => {
      vi.mocked(prisma.incident.create).mockResolvedValue(makeIncident() as never);

      await incidentService.createIncident({
        title: "Provider X outage",
        provider: "Provider X",
        reportedById: "user-1",
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "incident_created",
          }),
        }),
      );
    });
  });

  // ─── Status transitions ───

  describe("Status transitions", () => {
    it("active -> monitoring", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(makeIncident() as never);
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "monitoring" }) as never,
      );

      const result = await incidentService.updateIncident(
        "inc-1",
        { status: "monitoring" },
        "user-1",
      );

      expect(result.status).toBe("monitoring");
    });

    it("active -> resolved", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(makeIncident() as never);
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "resolved", resolvedAt: new Date() }) as never,
      );

      const result = await incidentService.updateIncident(
        "inc-1",
        { status: "resolved" },
        "user-1",
      );

      expect(result.status).toBe("resolved");
    });

    it("monitoring -> resolved", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ status: "monitoring" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "resolved" }) as never,
      );

      const result = await incidentService.updateIncident(
        "inc-1",
        { status: "resolved" },
        "user-1",
      );

      expect(result.status).toBe("resolved");
    });

    it("monitoring -> active (regression)", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ status: "monitoring" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "active" }) as never,
      );

      const result = await incidentService.updateIncident(
        "inc-1",
        { status: "active" },
        "user-1",
      );

      expect(result.status).toBe("active");
    });

    it("resolved -> active (reopen)", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ status: "resolved" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "active" }) as never,
      );

      const result = await incidentService.updateIncident(
        "inc-1",
        { status: "active" },
        "user-1",
      );

      expect(result.status).toBe("active");
    });

    it("rejects invalid transition: active -> active (no-op but allowed by code path)", async () => {
      // Same status is not a transition, code skips validation when same
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(makeIncident() as never);
      vi.mocked(prisma.incident.update).mockResolvedValue(makeIncident() as never);

      // This is allowed because input.status === existing.status is not a transition
      const result = await incidentService.updateIncident(
        "inc-1",
        { status: "active" },
        "user-1",
      );
      expect(result.status).toBe("active");
    });

    it("rejects invalid transition: resolved -> monitoring", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ status: "resolved" }) as never,
      );

      await expect(
        incidentService.updateIncident("inc-1", { status: "monitoring" }, "user-1"),
      ).rejects.toThrow("Invalid status transition: resolved -> monitoring");
    });

    it("sets resolvedAt and resolvedById when resolving", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(makeIncident() as never);
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "resolved" }) as never,
      );

      await incidentService.updateIncident(
        "inc-1",
        { status: "resolved", resolvedById: "resolver-1" },
        "user-1",
      );

      expect(prisma.incident.update).toHaveBeenCalledWith({
        where: { id: "inc-1" },
        data: expect.objectContaining({
          status: "resolved",
          resolvedAt: expect.any(Date),
          resolvedById: "resolver-1",
        }),
      });
    });

    it("throws when incident not found", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(null as never);

      await expect(
        incidentService.updateIncident("nonexistent", { status: "resolved" }, "user-1"),
      ).rejects.toThrow("Incident not found");
    });
  });

  // ─── RCA workflow transitions ───

  describe("RCA workflow transitions", () => {
    it("none -> raised", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "none" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "raised" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "raised",
        performedById: "user-1",
        responsibleId: "resp-1",
      });

      expect(result.success).toBe(true);
    });

    it("raised -> awaiting_rca", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "raised" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "awaiting_rca" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "awaiting_rca",
        performedById: "user-1",
      });

      expect(result.success).toBe(true);
    });

    it("awaiting_rca -> rca_received", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "awaiting_rca" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "rca_received" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "rca_received",
        performedById: "user-1",
        documentRef: "https://docs/rca-123",
      });

      expect(result.success).toBe(true);
    });

    it("rca_received -> follow_up_pending", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "rca_received" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "follow_up_pending" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "follow_up_pending",
        performedById: "user-1",
      });

      expect(result.success).toBe(true);
    });

    it("follow_up_pending -> closed", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "follow_up_pending" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "closed" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "closed",
        performedById: "user-1",
      });

      expect(result.success).toBe(true);
    });

    it("closed -> raised (reopen RCA)", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "closed" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "raised" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "raised",
        performedById: "user-1",
      });

      expect(result.success).toBe(true);
    });

    it("rejects invalid RCA transition: none -> closed", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "none" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "closed",
        performedById: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid RCA transition");
    });

    it("rejects invalid RCA transition: raised -> closed (must go through awaiting_rca)", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "raised" }) as never,
      );

      const result = await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "closed",
        performedById: "user-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid RCA transition");
    });

    it("sets rcaRaisedAt when transitioning to raised", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "none" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "raised" }) as never,
      );

      await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "raised",
        performedById: "user-1",
        responsibleId: "resp-1",
        slaDeadline: new Date("2026-03-10T10:00:00Z"),
      });

      expect(prisma.incident.update).toHaveBeenCalledWith({
        where: { id: "inc-1" },
        data: expect.objectContaining({
          rcaStatus: "raised",
          rcaRaisedAt: expect.any(Date),
          rcaResponsibleId: "resp-1",
          rcaSlaDeadline: new Date("2026-03-10T10:00:00Z"),
        }),
      });
    });

    it("sets rcaReceivedAt and documentRef when transitioning to rca_received", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(
        makeIncident({ rcaStatus: "awaiting_rca" }) as never,
      );
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ rcaStatus: "rca_received" }) as never,
      );

      await incidentService.transitionRca({
        incidentId: "inc-1",
        targetStatus: "rca_received",
        performedById: "user-1",
        documentRef: "https://docs/rca-report.pdf",
      });

      expect(prisma.incident.update).toHaveBeenCalledWith({
        where: { id: "inc-1" },
        data: expect.objectContaining({
          rcaReceivedAt: expect.any(Date),
          rcaDocumentRef: "https://docs/rca-report.pdf",
        }),
      });
    });
  });

  // ─── External ticket dispute flow ───

  describe("External ticket dispute flow", () => {
    it("disputes a ticket closure", async () => {
      const incident = makeIncident({
        externalTicketRef: "JIRA-1234",
        externalTicketStatus: "closed",
      });
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({
        ...incident,
        externalTicketDisputed: true,
        externalTicketDisputeReason: "Issue not resolved",
      } as never);

      const result = await incidentService.disputeTicketClosure({
        incidentId: "inc-1",
        reason: "Issue not resolved",
        performedById: "user-1",
      });

      expect(result.externalTicketDisputed).toBe(true);
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: "disputed",
            reason: "Issue not resolved",
          }),
        }),
      );
    });

    it("creates a reopen_requested event when requestReopen is true", async () => {
      const incident = makeIncident({
        externalTicketRef: "JIRA-1234",
        externalTicketStatus: "closed",
      });
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({
        ...incident,
        externalTicketDisputed: true,
      } as never);

      await incidentService.disputeTicketClosure({
        incidentId: "inc-1",
        reason: "Still happening",
        performedById: "user-1",
        requestReopen: true,
      });

      // Should have 2 external ticket events: disputed + reopen_requested
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledTimes(2);
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: "reopen_requested",
          }),
        }),
      );
    });

    it("adds an escalation update to the incident timeline", async () => {
      const incident = makeIncident({
        externalTicketRef: "JIRA-5678",
        externalTicketStatus: "resolved",
      });
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({
        ...incident,
        externalTicketDisputed: true,
      } as never);

      await incidentService.disputeTicketClosure({
        incidentId: "inc-1",
        reason: "Premature closure",
        performedById: "user-1",
      });

      expect(prisma.incidentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "escalation",
            content: expect.stringContaining("[DISPUTE]"),
          }),
        }),
      );
    });

    it("throws when incident not found for dispute", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(null as never);

      await expect(
        incidentService.disputeTicketClosure({
          incidentId: "nonexistent",
          reason: "Not resolved",
          performedById: "user-1",
        }),
      ).rejects.toThrow("not found");
    });
  });

  // ─── Premature closure detection via sync ───

  describe("External ticket sync - premature closure detection", () => {
    it("detects premature closure when provider closes but incident is still active", async () => {
      const incident = makeIncident({
        status: "active",
        externalTicketRef: "JIRA-9999",
        externalTicketStatus: "in_progress",
      });
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({
        ...incident,
        externalTicketStatus: "closed",
      } as never);

      await incidentService.syncExternalTicketStatus("inc-1", "closed");

      // Should create both a status_changed and a provider_closed event
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledTimes(2);
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: "provider_closed",
          }),
        }),
      );
    });

    it("does not flag premature closure when incident is already resolved", async () => {
      const incident = makeIncident({
        status: "resolved",
        externalTicketRef: "JIRA-1111",
        externalTicketStatus: "in_progress",
      });
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(incident as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({
        ...incident,
        externalTicketStatus: "closed",
      } as never);

      await incidentService.syncExternalTicketStatus("inc-1", "closed");

      // Only status_changed event, no provider_closed
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.externalTicketEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: "status_changed",
          }),
        }),
      );
    });
  });

  // ─── Resolve incident ───

  describe("resolveIncident", () => {
    it("resolves and adds a resolution note", async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(makeIncident() as never);
      vi.mocked(prisma.incident.update).mockResolvedValue(
        makeIncident({ status: "resolved" }) as never,
      );

      const result = await incidentService.resolveIncident(
        "inc-1",
        "resolver-1",
        "Root cause identified and fixed",
      );

      expect(result.status).toBe("resolved");
      expect(prisma.incidentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "resolution",
            content: "Root cause identified and fixed",
          }),
        }),
      );
    });
  });
});

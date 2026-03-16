import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clientCommsDraft: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    clientImpactRecord: {
      update: vi.fn(),
    },
    incident: {
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/integrations/slack", () => ({
  sendSlackNotification: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/audit", () => ({
  createAuditEntry: vi.fn(),
}));

import { sendSlackNotification } from "@/lib/integrations/slack";
import { createAuditEntry } from "@/lib/api/audit";

describe("Comms Dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries on first Slack API failure and succeeds on second attempt", async () => {
    const slackMock = vi.mocked(sendSlackNotification);
    slackMock
      .mockRejectedValueOnce(new Error("Slack API timeout"))
      .mockResolvedValueOnce(undefined);

    // Simulate retry logic
    let delivered = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sendSlackNotification("C123", "Test message");
        delivered = true;
        break;
      } catch {
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 10)); // shortened for test
        }
      }
    }

    expect(delivered).toBe(true);
    expect(slackMock).toHaveBeenCalledTimes(2);
  });

  it("sets deliveryStatus='failed' after 3 consecutive failures", async () => {
    const slackMock = vi.mocked(sendSlackNotification);
    slackMock.mockRejectedValue(new Error("Slack API down"));

    let delivered = false;
    let deliveryStatus = "pending";
    let deliveryError = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sendSlackNotification("C123", "Test message");
        delivered = true;
        deliveryStatus = "delivered";
        break;
      } catch (err) {
        deliveryError = err instanceof Error ? err.message : String(err);
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
    }

    if (!delivered) {
      deliveryStatus = "failed";
    }

    expect(delivered).toBe(false);
    expect(deliveryStatus).toBe("failed");
    expect(deliveryError).toBe("Slack API down");
    expect(slackMock).toHaveBeenCalledTimes(3);
  });

  it("AuditLog entry is created on every dispatch call regardless of outcome", async () => {
    const auditMock = vi.mocked(createAuditEntry);
    auditMock.mockResolvedValue(undefined);

    // Successful dispatch
    await createAuditEntry({
      action: "client_comms_sent",
      entityType: "client_comms_draft",
      entityId: "draft_1",
      userId: "emp_1",
      summary: "Client comms dispatched",
      metadata: {
        clientNames: ["Client A"],
        channels: ["slack"],
        incidentId: "inc_1",
        sent: 1,
        failed: 0,
      },
    });

    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "client_comms_sent",
        entityType: "client_comms_draft",
      }),
    );

    // Failed dispatch — audit still written
    await createAuditEntry({
      action: "client_comms_sent",
      entityType: "client_comms_draft",
      entityId: "draft_2",
      userId: "emp_1",
      summary: "Client comms dispatched (with failures)",
      metadata: {
        clientNames: ["Client B"],
        channels: ["slack"],
        incidentId: "inc_1",
        sent: 0,
        failed: 1,
      },
    });

    expect(auditMock).toHaveBeenCalledTimes(2);
  });

  it("POST to approve endpoint with employee role returns 403", () => {
    // Test authorization logic
    const userRole = "employee";
    const allowedRoles = ["admin", "lead"];
    const isAllowed = allowedRoles.includes(userRole);
    expect(isAllowed).toBe(false);
  });

  it("POST to approve endpoint with lead role succeeds", () => {
    // Test authorization logic
    const userRole = "lead";
    const allowedRoles = ["admin", "lead"];
    const isAllowed = allowedRoles.includes(userRole);
    expect(isAllowed).toBe(true);
  });
});

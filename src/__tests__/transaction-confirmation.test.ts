/**
 * Transaction confirmation: read-only tracker of GX items awaiting action in GX (spec §5.2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  transactionConfirmation: {
    findMany: vi.fn(),
    update: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  auditLog: { create: vi.fn() },
}));
const komainu = vi.hoisted(() => ({
  isKomainuConfigured: vi.fn(),
  fetchRequest: vi.fn(),
  fetchTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/komainu-api/client", () => komainu);
vi.mock("@/lib/integrations/slack", () => ({ sendSlackNotification: vi.fn() }));

import * as confirmation from "@/lib/transaction-confirmation";

describe("Transaction confirmation — allowed actions only", () => {
  it("exposes only take ownership, add note and link ticket as human actions", () => {
    expect(typeof confirmation.takeOwnership).toBe("function");
    expect(typeof confirmation.addNote).toBe("function");
    expect(typeof confirmation.linkTicket).toBe("function");
    for (const removed of ["assessRiskLevel", "signOffConfirmation", "acknowledgeConfirmation", "escalateConfirmation", "closeConfirmationInSource"]) {
      expect(removed in confirmation, removed).toBe(false);
    }
  });
});

describe("syncConfirmationsWithSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    komainu.isKomainuConfigured.mockReturnValue(true);
  });

  it("closes items no longer PENDING in the Komainu API and keeps pending ones open", async () => {
    prismaMock.transactionConfirmation.findMany.mockResolvedValue([
      { id: "c1", transactionId: "tx1", requestId: "req1" },
      { id: "c2", transactionId: "tx2", requestId: null },
      { id: "c3", transactionId: "tx3", requestId: "req3" },
    ]);
    komainu.fetchRequest.mockImplementation(async (id: string) => ({ status: id === "req1" ? "APPROVED" : "PENDING" }));
    komainu.fetchTransaction.mockResolvedValue({ status: "CONFIRMED" });

    const closed = await confirmation.syncConfirmationsWithSource();

    expect(closed).toBe(2);
    const updatedIds = prismaMock.transactionConfirmation.update.mock.calls.map((c) => c[0].where.id);
    expect(updatedIds.sort()).toEqual(["c1", "c2"]);
    for (const call of prismaMock.transactionConfirmation.update.mock.calls) {
      expect(call[0].data.status).toBe("closed_in_source");
    }
  });

  it("does nothing when the Komainu API is not configured", async () => {
    komainu.isKomainuConfigured.mockReturnValue(false);
    expect(await confirmation.syncConfirmationsWithSource()).toBe(0);
    expect(prismaMock.transactionConfirmation.findMany).not.toHaveBeenCalled();
  });
});

describe("takeOwnership", () => {
  it("sets status owned and records the owner", async () => {
    await confirmation.takeOwnership("c1", "u1");
    const data = prismaMock.transactionConfirmation.update.mock.calls.at(-1)![0].data;
    expect(data.status).toBe("owned");
    expect(data.ownedById).toBe("u1");
  });
});

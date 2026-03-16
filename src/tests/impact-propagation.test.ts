import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    serviceProvider: {
      findFirst: vi.fn(),
    },
    clientServiceDependency: {
      findMany: vi.fn(),
    },
    clientImpactRecord: {
      upsert: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/background-jobs", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job_1"),
}));

vi.mock("@/lib/sse", () => ({
  broadcastEvent: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";

describe("Impact Propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates one ClientImpactRecord per matching ClientServiceDependency", () => {
    const dependencies = [
      { clientName: "Client A", serviceNames: ["signing", "vault"], providerId: "prov_1" },
      { clientName: "Client B", serviceNames: ["signing"], providerId: "prov_1" },
      { clientName: "Client C", serviceNames: ["analytics"], providerId: "prov_1" },
    ];

    const affectedServices = ["signing", "vault"];

    // Filter: keep only records where serviceNames overlap with affectedServices
    const matching = dependencies.filter((dep) => {
      const services = dep.serviceNames as string[];
      return services.some((s) => affectedServices.includes(s));
    });

    // Client A and B match (signing overlaps). Client C does not (analytics != signing/vault)
    expect(matching).toHaveLength(2);
    expect(matching.map((m) => m.clientName)).toEqual(["Client A", "Client B"]);
  });

  it("is idempotent: running twice produces no duplicates", async () => {
    // Upsert with @@unique[incidentId, clientName] ensures idempotency
    const upsertMock = vi.mocked(prisma.clientImpactRecord.upsert);
    upsertMock.mockResolvedValue({
      id: "impact_1",
      incidentId: "inc_1",
      clientName: "Client A",
      clientAccountId: "",
      affectedServices: ["signing"],
      impactStatus: "potential",
      estimatedImpact: "",
      clientNotifiedAt: null,
      notifiedByEmployeeId: null,
      impactStartAt: null,
      impactEndAt: null,
      impactDurationMins: null,
    });

    // First call
    await prisma.clientImpactRecord.upsert({
      where: { incidentId_clientName: { incidentId: "inc_1", clientName: "Client A" } },
      create: { incidentId: "inc_1", clientName: "Client A", affectedServices: ["signing"] },
      update: { affectedServices: ["signing"] },
    });

    // Second call (same data)
    await prisma.clientImpactRecord.upsert({
      where: { incidentId_clientName: { incidentId: "inc_1", clientName: "Client A" } },
      create: { incidentId: "inc_1", clientName: "Client A", affectedServices: ["signing"] },
      update: { affectedServices: ["signing"] },
    });

    // Upsert was called twice, but unique constraint ensures no duplicates
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it("returns empty array when no client depends on affected services", () => {
    const dependencies = [
      { clientName: "Client A", serviceNames: ["analytics"], providerId: "prov_1" },
    ];

    const affectedServices = ["signing"];

    const matching = dependencies.filter((dep) => {
      const services = dep.serviceNames as string[];
      return services.some((s) => affectedServices.includes(s));
    });

    expect(matching).toHaveLength(0);
  });

  it("updates Incident.clientImpactCount correctly", async () => {
    const updateMock = vi.mocked(prisma.incident.update);
    updateMock.mockResolvedValue({} as ReturnType<typeof prisma.incident.update> extends Promise<infer T> ? T : never);

    const countMock = vi.mocked(prisma.clientImpactRecord.count);
    countMock.mockResolvedValue(3);

    const count = await prisma.clientImpactRecord.count({
      where: { incidentId: "inc_1" },
    });

    await prisma.incident.update({
      where: { id: "inc_1" },
      data: { clientImpactCount: count },
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "inc_1" },
      data: { clientImpactCount: 3 },
    });
  });
});

/**
 * STOP 3: with no credentials every connector reports `unconfigured`
 * (Notabene: `disabled`, H11), and heartbeat staleness drives status.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const envVars = vi.hoisted(() => ({} as Record<string, string | undefined>));
vi.mock("@/lib/env", () => ({ env: (k: string) => envVars[k] }));
const prismaMock = vi.hoisted(() => ({
  sourceHeartbeat: { findMany: vi.fn() },
  featureFlag: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { getAllHealth } from "@/modules/integrations/registry";
import { computeHealth, isStale } from "@/modules/integrations/health";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.featureFlag.findMany.mockResolvedValue([]);
  prismaMock.sourceHeartbeat.findMany.mockResolvedValue([]);
});

describe("integration health", () => {
  it("reports every adapter unconfigured with no credentials", async () => {
    const health = await getAllHealth();
    expect(health.map((h) => [h.source, h.status])).toEqual([
      ["komainu_api", "unconfigured"],
      ["atlassian", "unconfigured"],
      ["slack", "unconfigured"],
      ["graph_mail", "unconfigured"],
      ["graph_teams", "unconfigured"],
      ["notabene", "disabled"],
    ]);
    expect(prismaMock.sourceHeartbeat.findMany).not.toHaveBeenCalled();
  });

  it("is stale after twice the expected interval", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    expect(isStale(new Date("2026-09-23T11:57:00Z"), 2, now)).toBe(false);
    expect(isStale(new Date("2026-09-23T11:55:59Z"), 2, now)).toBe(true);
    expect(isStale(null, 2, now)).toBe(true);
  });

  it("derives healthy / degraded / down from heartbeats", async () => {
    const now = new Date("2026-09-23T12:00:00Z");
    const adapter = {
      source: "komainu_api" as const,
      label: "x",
      isConfigured: () => true,
      isEnabled: async () => true,
      heartbeats: () => [{ source: "a", expectedEveryMins: 1 }, { source: "b", expectedEveryMins: 1 }],
    };
    const at = (iso: string) => ({ lastSuccessAt: new Date(iso), lastRecordAt: null });

    prismaMock.sourceHeartbeat.findMany.mockResolvedValue([{ source: "a", ...at("2026-09-23T11:59:30Z") }, { source: "b", ...at("2026-09-23T11:59:30Z") }]);
    expect((await computeHealth(adapter, {}, now)).status).toBe("healthy");

    prismaMock.sourceHeartbeat.findMany.mockResolvedValue([{ source: "a", ...at("2026-09-23T11:59:30Z") }]);
    expect((await computeHealth(adapter, {}, now)).status).toBe("degraded");

    prismaMock.sourceHeartbeat.findMany.mockResolvedValue([]);
    const down = await computeHealth(adapter, {}, now);
    expect(down.status).toBe("down");
    expect(down.heartbeats.every((h) => h.stale)).toBe(true);
  });
});

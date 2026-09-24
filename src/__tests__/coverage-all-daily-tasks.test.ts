/**
 * Spec §12 coverage acceptance: every check and task code has a definition
 * with team, dueByLocal, evidenceSpec, ticketProject and confluenceUrl (a
 * CONFIRM placeholder is allowed). Fails if a code is missing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));

import { syncDailyCheckDefinitions } from "@/modules/daily-checks/schedule";
import { DEFINITIONS } from "@/modules/daily-checks/definitions";
import { COLLECTORS } from "@/modules/daily-checks/collectors";

/** Every code listed in spec §12 (Team 1, Team 2, Team 3, All teams). */
const SPEC_CODES = [
  "CHK-01", "CHK-09K", "CHK-10", "CHK-11", "CHK-12", "CHK-17", "CHK-08", "TASK-FAB",
  "CHK-02", "CHK-03", "TASK-OTC", "CHK-06", "CHK-07", "CHK-13",
  "CHK-09", "CHK-05", "CHK-04", "CHK-16", "CHK-21", "CHK-22", "CHK-15", "TASK-AVIVA",
  "TASK-CLIENTQ", "TASK-VENDOR", "TASK-BILL", "TASK-RISKVIEW", "TASK-MORNING",
];

beforeEach(() => db.client.__reset());

describe("coverage-all-daily-tasks", () => {
  it("has a definition in the database for every §12 code, with every required field", async () => {
    await syncDailyCheckDefinitions();
    const rows = await db.client.dailyCheckDefinition.findMany();
    const byCode = new Map(rows.map((r) => [r.code as string, r]));
    const missing = SPEC_CODES.filter((c) => !byCode.has(c));
    expect(missing, `missing definitions: ${missing.join(", ")}`).toEqual([]);

    for (const code of SPEC_CODES) {
      const r = byCode.get(code)!;
      expect(r.team, `${code} team`).toMatch(/^(Team [123]|All)$/);
      expect(r.dueByLocal, `${code} dueByLocal`).toMatch(/^(\d{2}:\d{2}|per_window|event|continuous)$/);
      expect(r.evidenceSpec, `${code} evidenceSpec`).toHaveProperty("requiredFields");
      expect(r.ticketProject, `${code} ticketProject`).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(String(r.confluenceUrl), `${code} confluenceUrl`).toMatch(/^(https:\/\/|CONFIRM-CONFLUENCE-URL:)/);
    }
  });

  it("CHK-02 covers dev assets weekly for Team 3 as well", () => {
    const dev = DEFINITIONS.find((d) => d.code === "CHK-02-DEV");
    expect(dev).toMatchObject({ team: "Team 3", frequency: "weekly" });
  });

  it("the FAB module ships behind module.fab", () => {
    for (const code of ["TASK-FAB", "TASK-FAB-REPORT"]) expect(DEFINITIONS.find((d) => d.code === code)?.requiredFlag).toBe("module.fab");
  });

  it("CHK-09K is restricted (kps:view)", () => {
    expect(DEFINITIONS.find((d) => d.code === "CHK-09K")?.restricted).toBe(true);
  });

  it("every definition that claims an automated pull has a collector, and vice versa", () => {
    const claimed = DEFINITIONS.filter((d) => d.collector).map((d) => d.code).sort();
    expect(Object.keys(COLLECTORS).sort()).toEqual(claimed);
  });

  it("does not overwrite admin edits on re-sync", async () => {
    await syncDailyCheckDefinitions();
    await db.client.dailyCheckDefinition.update({ where: { code: "CHK-01" }, data: { confluenceUrl: "https://komainu.atlassian.net/wiki/x" } });
    expect(await syncDailyCheckDefinitions()).toBe(0);
    expect((await db.client.dailyCheckDefinition.findUnique({ where: { code: "CHK-01" } }))!.confluenceUrl).toBe("https://komainu.atlassian.net/wiki/x");
  });
});

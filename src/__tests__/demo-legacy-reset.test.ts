/**
 * Demo tier: a database with the pre-baseline migration history is rebuilt and
 * reseeded; nothing else is ever touched (prisma/demo-legacy-reset.cjs).
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import * as fs from "node:fs";

const { decide, localMigrations } = createRequire(import.meta.url)("../../prisma/demo-legacy-reset.cjs") as {
  decide: (i: { env: Record<string, string | undefined>; applied: string[]; local: string[]; markerPresent: boolean }) => { action: string; reason: string };
  localMigrations: () => string[];
};

const local = ["0001_baseline"];
const legacy = ["0001_init", "0044_idempotency_keys"];

describe("demo-legacy-reset", () => {
  it("never acts outside the demo tier", () => {
    for (const env of [{}, { KOM_ENVIRONMENT: "production" }, { KOM_ENVIRONMENT: "development", KOM_DEMO_RESET_LEGACY: "true" }]) {
      expect(decide({ env, applied: legacy, local, markerPresent: true }).action).toBe("none");
    }
  });

  it("does nothing when the history matches", () => {
    expect(decide({ env: { KOM_ENVIRONMENT: "demo" }, applied: ["0001_baseline"], local, markerPresent: true }).action).toBe("none");
    expect(decide({ env: { KOM_ENVIRONMENT: "demo" }, applied: [], local, markerPresent: false }).action).toBe("none");
  });

  it("rebuilds a legacy demo database that carries the demo marker", () => {
    expect(decide({ env: { KOM_ENVIRONMENT: "demo" }, applied: legacy, local, markerPresent: true }).action).toBe("reset");
  });

  it("refuses without the marker unless the operator opts in", () => {
    expect(decide({ env: { KOM_ENVIRONMENT: "demo" }, applied: legacy, local, markerPresent: false }).action).toBe("refuse");
    expect(decide({ env: { KOM_ENVIRONMENT: "demo", KOM_DEMO_RESET_LEGACY: "true" }, applied: legacy, local, markerPresent: false }).action).toBe("reset");
  });

  it("on Railway, an unset tier is demo and the rebuild is implied (Railway is never production, H10)", () => {
    const railway = { RAILWAY_PROJECT_ID: "p1" };
    expect(decide({ env: railway, applied: legacy, local, markerPresent: false }).action).toBe("reset");
    expect(decide({ env: { ...railway, KOM_DEMO_RESET_LEGACY: "false" }, applied: legacy, local, markerPresent: false }).action).toBe("refuse");
    expect(decide({ env: { ...railway, KOM_ENVIRONMENT: "production" }, applied: legacy, local, markerPresent: true }).action).toBe("none");
    expect(decide({ env: railway, applied: ["0001_baseline"], local, markerPresent: false }).action).toBe("none");
  });

  it("reads the migrations shipped with the build", () => {
    expect(localMigrations()).toContain("0001_baseline");
  });

  it("start.sh runs it for the demo tier only, before migrating, and reseeds after a rebuild", () => {
    const sh = fs.readFileSync("start.sh", "utf8");
    const reset = sh.indexOf("node prisma/demo-legacy-reset.cjs");
    expect(reset).toBeGreaterThan(sh.indexOf('TIER="demo"'));
    expect(reset).toBeLessThan(sh.indexOf("migrate deploy"));
    expect(sh.slice(sh.lastIndexOf("\n", reset - 40), reset)).toContain('[ "${TIER}" = "demo" ]');
    expect(sh).toMatch(/ALLOW_SEED\}" = "true" \] \|\| \[ "\$\{FORCE_SEED\}" = "true" \]/);
  });
});

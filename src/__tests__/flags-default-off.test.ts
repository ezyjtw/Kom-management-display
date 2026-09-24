/**
 * Phase 0 acceptance: flags-default-off (spec §5.3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { featureFlag: { findMany } } }));

import { FLAG_DEFAULTS, SAFETY_FLAG_SEED } from "@/lib/feature-flag-defaults";
import { isFeatureEnabled, invalidateFlagCache } from "@/lib/feature-flags";

const SPEC_FLAGS = [
  "ai.enabled",
  "ai.compliance_bot",
  "people.scoring",
  "people.activity_tracking",
  "module.usdc_ramp",
  "integration.notabene.enabled",
  "module.market_ticker", // spec §6.4
  "module.status_pages", // spec §8.6
  "iai.drafts.enabled", // spec §10.4
  "module.fab", // spec §12 TASK-FAB
  "slack.events_push", // spec v2 §8.4
];

function seededRows() {
  return SAFETY_FLAG_SEED.map((f) => ({
    ...f,
    enabled: FLAG_DEFAULTS[f.key],
    roles: "[]",
    teams: "[]",
    percentage: 100,
  }));
}

describe("flags-default-off", () => {
  beforeEach(() => {
    invalidateFlagCache();
    findMany.mockReset();
  });

  it("seed and defaults cover every spec flag, all false", () => {
    expect(SAFETY_FLAG_SEED.map((f) => f.key).sort()).toEqual([...SPEC_FLAGS].sort());
    expect(Object.keys(FLAG_DEFAULTS).sort()).toEqual([...SPEC_FLAGS].sort());
    expect(Object.values(FLAG_DEFAULTS).every((v) => v === false)).toBe(true);
  });

  it("prisma/seed.ts seeds the safety flags without overwriting existing rows", () => {
    const seed = fs.readFileSync(path.resolve(__dirname, "../../prisma/seed.ts"), "utf8");
    expect(seed).toContain("SAFETY_FLAG_SEED");
    expect(seed).toMatch(/featureFlag\.upsert\([\s\S]*update:\s*\{\s*\}/);
  });

  it.each(SPEC_FLAGS)("%s resolves false on a fresh seed", async (key) => {
    findMany.mockResolvedValue(seededRows());
    expect(await isFeatureEnabled(key, { role: "admin", userId: "u1" })).toBe(false);
  });

  it.each(SPEC_FLAGS)("%s resolves false when the flag row is missing", async (key) => {
    findMany.mockResolvedValue([]);
    expect(await isFeatureEnabled(key)).toBe(false);
  });
});

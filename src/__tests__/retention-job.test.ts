/**
 * Review remediation: retention is an operating control, not just code. The
 * data_retention job runs daily and records its outcome; it deletes nothing
 * until retention.enabled is on (CONFIRM-RETENTION), and a partial run fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ enabled: false, results: [] as Array<{ policy: string; deletedCount: number; cutoffDate: string; durationMs: number; error?: string }> }));
vi.mock("@/modules/settings/settings", () => ({ getSetting: vi.fn(async (k: string) => (k === "retention.enabled" ? state.enabled : undefined)) }));
vi.mock("@/lib/data-retention", () => ({ enforceRetentionPolicies: vi.fn(async () => state.results) }));

import { JOB_HANDLERS } from "@/worker/dispatch";
import { enforceRetentionPolicies } from "@/lib/data-retention";
import { SETTINGS } from "@/modules/settings/registry";

beforeEach(() => { state.enabled = false; state.results = []; vi.mocked(enforceRetentionPolicies).mockClear(); });

describe("data_retention job", () => {
  it("is off by default and records a skipped run without deleting", async () => {
    expect(SETTINGS["retention.enabled"].default).toBe(false);
    const out = await JOB_HANDLERS.data_retention({});
    expect(out).toMatchObject({ skipped: true });
    expect(enforceRetentionPolicies).not.toHaveBeenCalled();
  });

  it("enforces the policies when enabled and returns what it deleted", async () => {
    state.enabled = true;
    state.results = [{ policy: "Expired session metadata", deletedCount: 3, cutoffDate: "2026-08-25", durationMs: 5 }];
    expect(await JOB_HANDLERS.data_retention({})).toEqual({ deleted: [{ policy: "Expired session metadata", deleted: 3, cutoff: "2026-08-25" }] });
  });

  it("fails the run when any policy fails (no false green)", async () => {
    state.enabled = true;
    state.results = [{ policy: "Old alert history", deletedCount: 0, cutoffDate: "x", durationMs: 1, error: "timeout" }];
    await expect(JOB_HANDLERS.data_retention({})).rejects.toThrow(/Old alert history/);
  });
});

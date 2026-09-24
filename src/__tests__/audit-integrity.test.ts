/**
 * Audit integrity (review remediation): fail-closed audited actions, actor
 * fields, orphaned "requested" entries (ALR-AUD-01), and the database
 * triggers that make AuditLog append-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});

import { auditedAction, AuditUnavailableError, createAuditEntry } from "@/lib/api/audit";
import { evaluateAuditOutcomeMissing } from "@/modules/alerting/evaluators/operations";

const p = () => db.client;
const entry = { action: "work_item_owner_changed", entityType: "work_item", entityId: "wi-1", userId: "emp-1", summary: "Took ownership", metadata: { actorUserId: "u-1" } };

beforeEach(() => {
  p().__reset();
  vi.restoreAllMocks();
});

describe("fail-closed audited actions", () => {
  it("writes requested then completed with one correlation id and the outcome", async () => {
    const result = await auditedAction(entry, async () => ({ owner: "emp-1" }), (r) => ({ owner: r.owner }));
    expect(result).toEqual({ owner: "emp-1" });
    const rows = await p().auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.phase)).toEqual(["requested", "completed"]);
    expect(new Set(rows.map((r) => r.correlationId)).size).toBe(1);
    expect(rows[0]).toMatchObject({ actorUserId: "u-1", actorType: "user", userId: "emp-1" });
    expect(JSON.parse(String(rows[1].details)).outcome).toEqual({ owner: "emp-1" });
  });

  it("records a failed outcome and rethrows when the action fails", async () => {
    await expect(auditedAction(entry, async () => { throw new Error("Jira down"); })).rejects.toThrow("Jira down");
    const rows = await p().auditLog.findMany({});
    expect(rows.map((r) => r.phase)).toEqual(["requested", "failed"]);
    expect(JSON.parse(String(rows[1].details)).error).toBe("Jira down");
  });

  it("does not run the action when the audit trail cannot be written", async () => {
    vi.spyOn(p().auditLog, "create").mockRejectedValueOnce(new Error("db unavailable"));
    const run = vi.fn(async () => "done");
    await expect(auditedAction(entry, run)).rejects.toBeInstanceOf(AuditUnavailableError);
    expect(run).not.toHaveBeenCalled();
  });

  it("fail-open entries still carry the actor, and system entries are typed as system", async () => {
    await createAuditEntry({ ...entry, userId: "system", metadata: {} });
    await createAuditEntry({ ...entry, userId: "system" });
    const rows = await p().auditLog.findMany({});
    expect(rows.map((r) => [r.actorType, r.actorUserId ?? null, r.phase])).toEqual([["system", null, "recorded"], ["user", "u-1", "recorded"]]);
  });
});

describe("ALR-AUD-01 audit outcome missing", () => {
  const ctx = (now: Date) => ({ now, params: { graceMins: 10, lookbackHours: 72 } }) as never;

  it("raises for a requested entry with no outcome after the grace period, and clears once the outcome exists", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    await p().auditLog.create({ data: { ...entry, details: "{}", phase: "requested", correlationId: "c1", createdAt: new Date(now.getTime() - 15 * 60_000) } });
    await p().auditLog.create({ data: { ...entry, details: "{}", phase: "requested", correlationId: "c2", createdAt: new Date(now.getTime() - 2 * 60_000) } }); // within grace
    const hits = await evaluateAuditOutcomeMissing(ctx(now));
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("Audit outcome missing for 1 action(s)");
    await p().auditLog.create({ data: { ...entry, details: "{}", phase: "completed", correlationId: "c1" } });
    expect(await evaluateAuditOutcomeMissing(ctx(now))).toEqual([]);
  });
});

describe("append-only audit trail (baseline migration)", () => {
  const sql = readFileSync("prisma/migrations/0001_baseline/migration.sql", "utf8");

  it("rejects UPDATE, DELETE and TRUNCATE on AuditLog with triggers", () => {
    expect(sql).toMatch(/CREATE TRIGGER "AuditLog_no_update_delete" BEFORE DELETE OR UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION kom_audit_append_only\(\)/);
    expect(sql).toMatch(/CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION kom_audit_append_only\(\)/);
    expect(sql).toMatch(/RAISE EXCEPTION 'AuditLog is append-only/);
  });

  it("normalises the actor on insert", () => {
    expect(sql).toMatch(/CREATE TRIGGER "AuditLog_normalise_actor" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION kom_audit_normalise_actor\(\)/);
  });

  it("no application code updates or deletes audit rows", () => {
    const hits = execSync(`grep -rlE "auditLog\\\\.(update|updateMany|delete|deleteMany|upsert)\\\\(" src --include=*.ts || true`, { encoding: "utf8" })
      .split("\n").filter((f) => f && !f.includes("__tests__"));
    expect(hits).toEqual([]);
  });
});

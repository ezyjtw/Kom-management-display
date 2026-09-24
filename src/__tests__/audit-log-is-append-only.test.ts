/**
 * Spec §17.7 / §17.10 `audit-log-is-append-only`. Static checks always run;
 * with TEST_DATABASE_URL set (a disposable local database with the
 * migrations applied) the triggers are exercised for real. Also covers
 * BackgroundJobRun (migration 0042), which is execution evidence.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

const migration = (prefix: string) => {
  const dir = readdirSync("prisma/migrations").find((d) => d.startsWith(prefix));
  if (!dir) throw new Error(`migration ${prefix} not found`);
  return readFileSync(path.join("prisma/migrations", dir, "migration.sql"), "utf8");
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "tests" ? [] : sourceFiles(f);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [f] : [];
  });
}

describe("audit-log-is-append-only", () => {
  it("AuditLog rejects UPDATE, DELETE and TRUNCATE in the database (0037)", () => {
    const sql = migration("0037_");
    expect(sql).toMatch(/CREATE TRIGGER "AuditLog_no_update_delete" BEFORE UPDATE OR DELETE ON "AuditLog"/);
    expect(sql).toMatch(/CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"/);
  });

  it("BackgroundJobRun rejects UPDATE and TRUNCATE, and DELETE inside retention (0042)", () => {
    const sql = migration("0042_");
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "BackgroundJobRun"/);
    expect(sql).toMatch(/BEFORE TRUNCATE ON "BackgroundJobRun"/);
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("interval '400 days'");
  });

  it("no migration after 0037 drops or disables the audit triggers", () => {
    const later = readdirSync("prisma/migrations").filter((d) => /^\d{4}_/.test(d) && d > "0037");
    for (const d of later) {
      const sql = readFileSync(path.join("prisma/migrations", d, "migration.sql"), "utf8");
      expect(sql, d).not.toMatch(/DROP TRIGGER[^;]*"AuditLog_|DISABLE TRIGGER|kom_audit_append_only\(\)[^;]*RETURNS trigger[^;]*RETURN NEW/i);
    }
  });

  it("no application code updates or deletes audit or job-run evidence", () => {
    const offenders = sourceFiles("src").filter((f) => /\.(auditLog|backgroundJobRun)\.(update|updateMany|upsert|delete)\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    // The only deletes of job runs are the retention prune.
    const prune = sourceFiles("src").filter((f) => /backgroundJobRun\.deleteMany\(/.test(readFileSync(f, "utf8")));
    expect(prune).toEqual([path.join("src", "lib", "background-jobs.ts")]);
    expect(sourceFiles("src").filter((f) => /auditLog\.deleteMany\(/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  const live = process.env.TEST_DATABASE_URL;
  it.skipIf(!live)("the triggers reject changes in a real database", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url: live! } } });
    try {
      const row = await db.auditLog.create({ data: { action: "append_only_probe", entityType: "test", entityId: "t", userId: "system" } });
      await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow(/append-only/);
      await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
      await expect(db.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
      const run = await db.backgroundJobRun.create({ data: { jobId: "j", type: "probe", attempt: 1, status: "dead_lettered" } });
      await expect(db.backgroundJobRun.update({ where: { id: run.id }, data: { status: "succeeded" } })).rejects.toThrow(/append-only/);
      await expect(db.backgroundJobRun.delete({ where: { id: run.id } })).rejects.toThrow(/retention/);
    } finally {
      await db.$disconnect();
    }
  });
});

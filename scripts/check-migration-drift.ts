/**
 * Blocking migration-drift check (spec §17.6, review remediation).
 *
 * Diffs the migrations against schema.prisma (via a shadow database) and
 * compares the result with prisma/drift-baseline.sql, the known historical
 * drift awaiting a reviewed reconciliation migration (see
 * docs/phase1/schema-drift.md). Fails on any NEW drift, and on drift that has
 * been resolved but is still in the baseline (so the baseline only shrinks).
 *
 *   SHADOW_DATABASE_URL=postgresql://... npx tsx scripts/check-migration-drift.ts
 *   ... --write-baseline   (only when deliberately accepting the current state)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASELINE = "prisma/drift-baseline.sql";

export function normalise(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort();
}

function currentDrift(shadow: string): string {
  try {
    return execFileSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", shadow, "--script"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw new Error(`prisma migrate diff failed: ${e.stderr ?? e.stdout ?? String(error)}`);
  }
}

function main() {
  const shadow = process.env.SHADOW_DATABASE_URL;
  if (!shadow) {
    console.error("SHADOW_DATABASE_URL is required (an empty database the check may create and drop tables in).");
    process.exit(2);
  }
  const sql = currentDrift(shadow);
  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE, sql);
    console.log(`Wrote ${BASELINE} (${normalise(sql).length} statements). Document every entry in docs/phase1/schema-drift.md.`);
    return;
  }
  const now = normalise(sql);
  const base = existsSync(BASELINE) ? normalise(readFileSync(BASELINE, "utf8")) : [];
  const added = now.filter((s) => !base.includes(s));
  const resolved = base.filter((s) => !now.includes(s));
  if (added.length) {
    console.error(`::error::New migration drift (${added.length} statement(s)): schema.prisma and the migrations disagree. Add a migration.`);
    for (const s of added) console.error(`  + ${s}`);
  }
  if (resolved.length) {
    console.error(`::error::${resolved.length} baseline drift statement(s) are resolved: remove them from ${BASELINE}.`);
    for (const s of resolved) console.error(`  - ${s}`);
  }
  if (added.length || resolved.length) process.exit(1);
  console.log(`No new migration drift (${base.length} known baseline statement(s), see docs/phase1/schema-drift.md).`);
}

if (process.argv[1]?.endsWith("check-migration-drift.ts")) main();

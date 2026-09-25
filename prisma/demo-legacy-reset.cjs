/**
 * Demo tier only: rebuild a demo database whose migration history predates the
 * Phase 12l baseline (0001_baseline). Such a database cannot take the baseline,
 * so start.sh calls this before `migrate deploy`; the schema is dropped and
 * recreated, then start.sh migrates and reseeds the same synthetic data.
 *
 * It acts only when all of these hold:
 *   - the demo tier: KOM_ENVIRONMENT=demo, or Railway with KOM_ENVIRONMENT
 *     unset (a Railway production service sets KOM_ENVIRONMENT=production);
 *   - _prisma_migrations lists a migration that is not in prisma/migrations;
 *   - the database carries the demo-data marker (AppSetting system.dataOrigin),
 *     or KOM_DEMO_RESET_LEGACY=true is set for a demo database seeded before
 *     the marker existed. On Railway this opt-in is implied unless
 *     KOM_DEMO_RESET_LEGACY=false.
 * Otherwise it changes nothing. Exit codes: 0 nothing to do, 10 reset done,
 * 1 refused or failed (start.sh stops).
 */
const fs = require("fs");
const path = require("path");

const RAILWAY_HOST_VARS = ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_SERVICE_ID"];
const onRailway = (env) => RAILWAY_HOST_VARS.some((k) => Boolean(env[k] && String(env[k]).trim()));

/** Same rule as src/lib/deployment-tier.ts. */
function isDemoTier(env) {
  const declared = (env.KOM_ENVIRONMENT || "").trim().toLowerCase();
  if (declared) return declared === "demo";
  return onRailway(env);
}

/** Pure decision, unit-tested in src/__tests__/demo-legacy-reset.test.ts. */
function decide({ env, applied, local, markerPresent }) {
  if (!isDemoTier(env)) return { action: "none", reason: "not the demo tier" };
  const unknown = applied.filter((name) => !local.includes(name));
  if (unknown.length === 0) return { action: "none", reason: "migration history matches" };
  const optedIn = env.KOM_DEMO_RESET_LEGACY === "true" || (onRailway(env) && env.KOM_DEMO_RESET_LEGACY !== "false");
  if (markerPresent || optedIn) {
    return { action: "reset", reason: `${unknown.length} migration(s) from the old history (e.g. ${unknown[0]})` };
  }
  return {
    action: "refuse",
    reason: "the database has an old migration history but no demo-data marker. If it holds only demo data, set KOM_DEMO_RESET_LEGACY=true once and redeploy.",
  };
}

function localMigrations(dir = path.join(__dirname, "migrations")) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

async function main() {
  if (!isDemoTier(process.env)) return 0;
  const { PrismaClient } = require("@prisma/client");
  const db = new PrismaClient();
  try {
    let applied = [];
    try {
      applied = (await db.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations"')).map((r) => r.migration_name);
    } catch {
      return 0; // no migration table: a fresh database
    }
    let markerPresent = false;
    try {
      markerPresent = (await db.$queryRawUnsafe(`SELECT 1 FROM "AppSetting" WHERE "key" = 'system.dataOrigin'`)).length > 0;
    } catch {
      markerPresent = false;
    }
    const d = decide({ env: process.env, applied, local: localMigrations(), markerPresent });
    if (d.action === "none") return 0;
    if (d.action === "refuse") {
      console.error(`FATAL: demo database not rebuilt: ${d.reason}`);
      return 1;
    }
    const [{ schema }] = await db.$queryRawUnsafe("SELECT current_schema() AS schema");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("unexpected schema name");
    console.log(`Demo tier: rebuilding schema "${schema}" (${d.reason}); synthetic data is reseeded.`);
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    return 10;
  } finally {
    await db.$disconnect();
  }
}

module.exports = { decide, localMigrations, isDemoTier };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`FATAL: demo database rebuild failed: ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
}

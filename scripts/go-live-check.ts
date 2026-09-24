/**
 * Go-live check (docs/phase1/go-live.md). Run against the target environment
 * and database before traffic is switched to the production tier:
 *
 *   KOM_ENVIRONMENT=production NODE_ENV=production SECRETS_DIR=/mnt/secrets \
 *     DATABASE_URL=... npx tsx scripts/go-live-check.ts
 *
 * Prints a checklist and exits 1 if any item fails. It reads configuration and
 * the database; it changes nothing.
 */
import * as fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { deploymentTier, DEMO_DATA_MARKER_KEY } from "@/lib/deployment-tier";
import { loadSecrets } from "@/lib/secrets";
import { isAzureAdConfigured, isLocalLoginAllowed } from "@/lib/sso";
import { FLAG_DEFAULTS } from "@/lib/feature-flag-defaults";

export type Status = "PASS" | "FAIL";
export interface Check { area: string; item: string; status: Status; detail?: string }

type Env = Record<string, string | undefined>;

/** Configuration checks (no database). */
export function configChecks(env: Env, readSecrets = loadSecrets): Check[] {
  const out: Check[] = [];
  const add = (area: string, item: string, ok: boolean, detail?: string) => out.push({ area, item, status: ok ? "PASS" : "FAIL", detail });

  const tier = deploymentTier(env);
  add("Tier", "Deployment tier is production", tier === "production", `tier=${tier}`);
  add("Tier", "NODE_ENV is production", env.NODE_ENV === "production");

  const s = readSecrets(env);
  const has = (k: string) => Boolean(s.values[k]);
  add("Secrets", "Secrets are read from SECRETS_DIR (Key Vault files), not environment variables", s.source === "secrets_dir", `source=${s.source} dir=${s.dir ?? "-"}`);
  add("Secrets", "No secret-bearing environment variables", s.leakedEnvKeys.length === 0, s.leakedEnvKeys.join(", ") || undefined);
  add("Secrets", "NEXTAUTH_SECRET present", has("NEXTAUTH_SECRET"));

  const sso = { AZURE_AD_TENANT_ID: env.AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID: env.AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET: s.values.AZURE_AD_CLIENT_SECRET };
  add("Identity", "Entra ID SSO configured", isAzureAdConfigured(sso));
  add("Identity", "ROLE_GROUP_MAP set", Boolean(env.ROLE_GROUP_MAP?.trim()));
  add("Identity", "Local username/password login is off", !isLocalLoginAllowed(env.NODE_ENV, env.ALLOW_LOCAL_LOGIN, env.KOM_ENVIRONMENT) && env.ALLOW_LOCAL_LOGIN !== "true");
  add("Identity", "NEXTAUTH_URL is https", (env.NEXTAUTH_URL ?? "").startsWith("https://"));
  add("Data", "Seeding is off (ALLOW_SEED)", env.ALLOW_SEED !== "true");

  // Every live integration connected (spec §8). Endpoints come from configuration.
  const custodyCreds = Boolean(env.CUSTODY_API_CREDENTIALS?.trim()) || (Boolean(env.CUSTODY_API_USER) && has("CUSTODY_API_SECRET"));
  add("Integrations", "Custody API (read-only): base URL and credentials", Boolean(env.CUSTODY_API_BASE_URL) && custodyCreds);
  let custodyHost = "";
  try { custodyHost = new URL(env.CUSTODY_API_BASE_URL ?? "").hostname; } catch { /* not set or invalid */ }
  add("Integrations", "Custody API base URL is not a demo, sandbox, staging or test host", Boolean(custodyHost) && !/(^|[.-])(demo|sandbox|staging|test)([.-]|$)/i.test(custodyHost), custodyHost || "not set");
  add("Integrations", "Jira / JSM: service account and token", Boolean(env.ATLASSIAN_EMAIL) && has("ATLASSIAN_API_TOKEN"));
  add("Integrations", "Confluence: account and token (Platform release notes)", Boolean(env.CONFLUENCE_EMAIL) && has("CONFLUENCE_API_TOKEN"));
  add("Integrations", "Slack: bot token, signing secret and channels", has("SLACK_BOT_TOKEN") && has("SLACK_SIGNING_SECRET") && Boolean(env.SLACK_CHANNELS?.trim()));
  add("Integrations", "Microsoft Graph: app and mailboxes", Boolean(env.GRAPH_TENANT_ID && env.GRAPH_CLIENT_ID) && has("GRAPH_CLIENT_SECRET") && Boolean(env.GRAPH_MAILBOXES?.trim()));
  add("Integrations", "Jira webhook secret", has("JIRA_WEBHOOK_SECRET"));

  add("Safety", "AI provider is none (H3)", (env.AI_PROVIDER ?? "none") === "none");
  return out;
}

/** Database checks. */
export async function databaseChecks(db: PrismaClient, opts: { migrationsDir?: string; seedFile?: string } = {}): Promise<Check[]> {
  const out: Check[] = [];
  const add = (area: string, item: string, ok: boolean, detail?: string) => out.push({ area, item, status: ok ? "PASS" : "FAIL", detail });

  const marker = await db.appSetting.findUnique({ where: { key: DEMO_DATA_MARKER_KEY } });
  add("Data", "Database has never been seeded with demo data", !marker, marker ? "demo marker present: go live on a fresh database" : undefined);

  const seedFile = opts.seedFile ?? "prisma/seed.ts";
  const seedEmails = fs.existsSync(seedFile) ? [...new Set([...fs.readFileSync(seedFile, "utf8").matchAll(/email: "([^"@]+@[^"]+)"/g)].map((m) => m[1].toLowerCase()))] : [];
  const seeded = seedEmails.length
    ? [
        ...(await db.user.findMany({ where: { email: { in: seedEmails, mode: "insensitive" } }, select: { email: true } })),
        ...(await db.employee.findMany({ where: { email: { in: seedEmails, mode: "insensitive" } }, select: { email: true } })),
      ]
    : [];
  add("Data", "No seeded demo identities (users or employees)", seeded.length === 0, seeded.length ? `${seeded.length} found` : undefined);

  const dir = opts.migrationsDir ?? "prisma/migrations";
  const expected = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => /^\d{4}_/.test(d)) : [];
  const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const appliedSet = new Set(applied.map((r) => r.migration_name));
  const pending = expected.filter((m) => !appliedSet.has(m));
  add("Database", "All migrations applied", pending.length === 0, pending.length ? pending.join(", ") : undefined);

  const flags = await db.featureFlag.findMany({ where: { key: { in: Object.keys(FLAG_DEFAULTS) } }, select: { key: true, enabled: true } });
  const wrong = flags.filter((f) => f.enabled !== (FLAG_DEFAULTS as Record<string, boolean>)[f.key]).map((f) => f.key);
  const safety = ["ai.enabled", "integration.notabene.enabled"].filter((k) => flags.find((f) => f.key === k)?.enabled);
  add("Safety", "AI and Notabene flags are off (H3, H11)", safety.length === 0, safety.join(", ") || undefined);
  add("Safety", "Feature flags at their reviewed defaults", wrong.length === 0, wrong.length ? `changed: ${wrong.join(", ")} (confirm each was approved)` : undefined);
  return out;
}

export function render(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.item.length));
  return checks.map((c) => `${c.status === "PASS" ? "PASS" : "FAIL"}  ${c.area.padEnd(12)} ${c.item.padEnd(width)}${c.detail ? `  (${c.detail})` : ""}`).join("\n");
}

async function main() {
  const checks = configChecks(process.env);
  if (process.env.DATABASE_URL) {
    const db = new PrismaClient();
    try {
      checks.push(...(await databaseChecks(db)));
    } catch (error) {
      checks.push({ area: "Database", item: "Database reachable", status: "FAIL", detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
    } finally {
      await db.$disconnect();
    }
  } else {
    checks.push({ area: "Database", item: "DATABASE_URL set", status: "FAIL" });
  }
  console.log(render(checks));
  const failed = checks.filter((c) => c.status === "FAIL").length;
  console.log(failed ? `\n${failed} item(s) failing: not ready to go live.` : "\nAll checks pass: ready to go live (then follow docs/phase1/go-live.md).");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1]?.endsWith("go-live-check.ts")) void main();

/**
 * Deployment tier, separate from NODE_ENV (a production build runs in both).
 *
 * - production: the live service. Everything strict: secrets only from files
 *   (SECRETS_DIR), Entra SSO only, never seeded, refuses a database that holds
 *   demo data (start.sh, scripts/go-live-check.ts).
 * - demo: a hosted demonstration on synthetic data (e.g. Railway). Secrets may
 *   come from environment variables, local login and seeding may be switched
 *   on explicitly, and every page shows a DEMO banner. Never connect a demo to
 *   production APIs or data (H9). Reviewed exception: docs/phase1/threat-model.md.
 * - development: local work and tests.
 *
 * A production build is production unless KOM_ENVIRONMENT=demo says otherwise,
 * with one exception: on Railway (detected by the variables Railway injects)
 * an unset KOM_ENVIRONMENT means demo, because Railway is never the production
 * host (H10, docs/phase1/go-live.md). KOM_ENVIRONMENT=production still wins.
 * Edge-safe (no Node imports).
 */
export type DeploymentTier = "production" | "demo" | "development";

type Env = Record<string, string | undefined>;

/** Variables Railway sets on every deployment. */
export const RAILWAY_HOST_VARS = ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_SERVICE_ID"] as const;

export function isRailwayHost(env: Env = process.env): boolean {
  return RAILWAY_HOST_VARS.some((k) => Boolean(env[k]?.trim()));
}

export function deploymentTier(env: Env = process.env): DeploymentTier {
  const declared = env.KOM_ENVIRONMENT?.trim().toLowerCase();
  if (declared === "demo") return "demo";
  if (declared === "production") return "production";
  if (isRailwayHost(env)) return "demo";
  return env.NODE_ENV === "production" ? "production" : "development";
}

export const isProductionTier = (env: Env = process.env) => deploymentTier(env) === "production";

/** Marker the demo seed writes; a production-tier start refuses a database that has it. */
export const DEMO_DATA_MARKER_KEY = "system.dataOrigin";

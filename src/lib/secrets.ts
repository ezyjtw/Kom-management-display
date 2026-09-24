/**
 * Secret loader (spec §17.3).
 *
 * Third-party and signing secrets are mounted from Key Vault as files on an
 * in-memory tmpfs volume, one file per config key, in SECRETS_DIR (default
 * /mnt/secrets). They are read into the validated config (src/lib/env.ts) and
 * are never copied into process.env.
 *
 * - Production: secrets come only from SECRETS_DIR. A secret-bearing
 *   environment variable is a misconfiguration and fails startup.
 * - Development, test and the demo tier (KOM_ENVIRONMENT=demo): if SECRETS_DIR
 *   is set, the same rule applies; otherwise secrets fall back to environment
 *   variables (src/lib/deployment-tier.ts).
 */
import * as fs from "fs";
import * as path from "path";
import { deploymentTier } from "@/lib/deployment-tier";

export const DEFAULT_SECRETS_DIR = "/mnt/secrets";

/** Config keys that hold a credential. Anything here must never arrive as an env var in production. */
export const SECRET_KEYS = [
  "NEXTAUTH_SECRET",
  "CRON_SECRET",
  "ENCRYPTION_SECRET",
  // DATABASE_URL is not listed: Prisma and the migration CLI read it from the
  // environment. Production connects with the workload's managed identity, so
  // the URL carries no password (TODO(CONFIRM-DB-IDENTITY), docs/phase1/credentials.md).
  "ATLASSIAN_API_TOKEN",
  "CONFLUENCE_API_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "JIRA_WEBHOOK_SECRET",
  "SMTP_PASSWORD",
  "CUSTODY_API_SECRET",
  "FIREBLOCKS_API_KEY",
  "FIREBLOCKS_API_SECRET",
  "NOTABENE_API_TOKEN",
  "AZURE_AD_CLIENT_SECRET",
  "GRAPH_CLIENT_SECRET",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "SEED_ADMIN_PASSWORD",
  "SEED_USER_PASSWORD",
  "SEED_LEAD_PASSWORD",
] as const;

/** Per-user the custody provider secrets named by CUSTODY_API_CREDENTIALS[].secretRef. */
const SECRET_KEY_PATTERN = /^CUSTODY_API_SECRET_[A-Z0-9_]+$/;

export function isSecretKey(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key) || SECRET_KEY_PATTERN.test(key);
}

export interface SecretSource {
  /** Where secrets were read from. */
  source: "secrets_dir" | "environment";
  dir: string | null;
  values: Record<string, string>;
  /** Secret keys found in the environment while a secrets directory is in force. */
  leakedEnvKeys: string[];
}

type Env = Record<string, string | undefined>;

/** Read every recognised secret file in `dir`. Missing dir → no secrets. */
export function readSecretsDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!isSecretKey(name)) continue; // ignore Kubernetes ..data links and stray files
    const file = path.join(dir, name);
    try {
      if (!fs.statSync(file).isFile()) continue;
      const value = fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
      if (value) out[name] = value;
    } catch {
      // unreadable file: treat as absent; validation reports required keys
    }
  }
  return out;
}

export function loadSecrets(processEnv: Env = process.env): SecretSource {
  // Tier, not NODE_ENV: a demo on a production build may use environment variables.
  const production = deploymentTier(processEnv) === "production";
  const configuredDir = processEnv.SECRETS_DIR?.trim() || null;

  if (!production && !configuredDir) {
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(processEnv)) if (v && isSecretKey(k)) values[k] = v;
    return { source: "environment", dir: null, values, leakedEnvKeys: [] };
  }

  const dir = configuredDir ?? DEFAULT_SECRETS_DIR;
  const leakedEnvKeys = Object.keys(processEnv).filter((k) => isSecretKey(k) && processEnv[k]);
  return { source: "secrets_dir", dir, values: readSecretsDir(dir), leakedEnvKeys: leakedEnvKeys.sort() };
}

/** process.env with secret-bearing keys removed (they come from the loader instead). */
export function nonSecretEnv(processEnv: Env = process.env): Env {
  const out: Env = {};
  for (const [k, v] of Object.entries(processEnv)) if (!isSecretKey(k)) out[k] = v;
  return out;
}

/** Development/test only (no SECRETS_DIR): a secret read live from the environment. */
export function environmentSecret(name: string, processEnv: Env = process.env): string | undefined {
  return isSecretKey(name) ? processEnv[name] || undefined : undefined;
}

/**
 * Environment variable validation using Zod.
 *
 * Validates required and optional env vars on first request.
 * Skipped during `next build` (where env vars may not be available)
 * but enforced at runtime — fails fast on misconfiguration in production.
 *
 * This replaces scattered process.env checks with a single source of truth.
 */

import { z } from "zod";
import { environmentSecret, loadSecrets, nonSecretEnv, type SecretSource } from "@/lib/secrets";

const envSchema = z.object({
  // ─── Required ───
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(16, "NEXTAUTH_SECRET must be at least 16 characters"),
  NEXTAUTH_URL: z.string().transform((v) => {
    // Auto-prepend https:// if the value looks like a bare domain
    if (v && !v.startsWith("http://") && !v.startsWith("https://")) {
      return `https://${v}`;
    }
    return v;
  }).pipe(z.string().url("NEXTAUTH_URL must be a valid URL")),

  // ─── Optional with defaults ───
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Directory of mounted secret files (spec §17.3); see src/lib/secrets.ts
  SECRETS_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // ─── Optional integrations (only validated if present) ───
  CRON_SECRET: z.string().optional(),
  ENCRYPTION_SECRET: z.string().min(32, "ENCRYPTION_SECRET must be at least 32 characters").optional(),
  CSRF_ALLOWED_ORIGINS: z.string().optional(),

  // Seed endpoint
  ALLOW_SEED: z.enum(["true", "false"]).optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_USER_PASSWORD: z.string().optional(),
  SEED_LEAD_PASSWORD: z.string().optional(),

  // Jira / JSM (spec §8.2): ATLASSIAN_BASE_URL is declared with the egress settings below
  ATLASSIAN_EMAIL: z.string().optional(),
  ATLASSIAN_API_TOKEN: z.string().optional(),

  // Confluence
  CONFLUENCE_BASE_URL: z.string().optional(),
  CONFLUENCE_API_TOKEN: z.string().optional(),
  CONFLUENCE_EMAIL: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CHANNELS: z.string().optional(),

  // Email (SMTP, outbound only; inbound mail uses Microsoft Graph)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: z.string().optional(),

  // Custody / Fireblocks / Notabene
  CUSTODY_API_BASE_URL: z.string().optional(),
  CUSTODY_API_USER: z.string().optional(),
  CUSTODY_API_SECRET: z.string().optional(),
  // JSON [{label, user, secretRef}] — secretRef names a CUSTODY_API_SECRET_<SUFFIX> env var (CONFIRM-API-SCOPE)
  CUSTODY_API_CREDENTIALS: z.string().optional(),
  FIREBLOCKS_API_KEY: z.string().optional(),
  FIREBLOCKS_API_SECRET: z.string().optional(),
  NOTABENE_API_BASE_URL: z.string().optional(),
  NOTABENE_API_TOKEN: z.string().optional(),
  NOTABENE_VASP_DID: z.string().optional(),

  // AI
  AI_PROVIDER: z.enum(["none", "groq", "anthropic", "ollama"]).default("none"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  /** Jurisdictions where the deploying firm holds a licence (src/lib/licensed-jurisdictions.ts). */
  NEXT_PUBLIC_LICENSED_JURISDICTIONS: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),

  // Webhook secrets
  JIRA_WEBHOOK_SECRET: z.string().optional(),

  // Fireblocks
  FIREBLOCKS_API_BASE_URL: z.string().optional(),

  // Job runner
  SLACK_OPS_CHANNEL_ID: z.string().optional(),

  // Notification channels
  SLACK_OPS_CHANNEL: z.string().optional(),
  SLACK_COMPLIANCE_CHANNEL: z.string().optional(),
  COMPLIANCE_EMAIL_RECIPIENTS: z.string().optional(),

  // Build metadata
  GIT_COMMIT_SHA: z.string().optional(),
  // Deployment tier (src/lib/deployment-tier.ts): production | demo | development
  KOM_ENVIRONMENT: z.enum(["production", "demo", "development"]).optional(),
  // Which workload this process is (web | worker), recorded with credential use (spec §17.7)
  KOM_WORKLOAD: z.enum(["web", "worker"]).optional(),

  // Single sign-on (Entra ID)
  AZURE_AD_TENANT_ID: z.string().optional(),
  AZURE_AD_CLIENT_ID: z.string().optional(),
  AZURE_AD_CLIENT_SECRET: z.string().optional(),
  ROLE_GROUP_MAP: z.string().optional(),
  ALLOW_LOCAL_LOGIN: z.enum(["true", "false", ""]).optional(),

  // Microsoft Graph (spec §8.5)
  GRAPH_TENANT_ID: z.string().optional(),
  GRAPH_CLIENT_ID: z.string().optional(),
  GRAPH_CLIENT_SECRET: z.string().optional(),
  GRAPH_MAILBOXES: z.string().optional(), // JSON [{label, address, purpose}]
  GRAPH_TEAMS_CHANNELS: z.string().optional(), // JSON [{label, teamId, channelId}]

  // Egress allowlist
  ATLASSIAN_BASE_URL: z.string().optional(),
  EGRESS_EXTRA_HOSTS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables.
 * Throws on first access if validation fails in production.
 */
let _env: Env | null = null;
let _validated = false;
let _secrets: SecretSource | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  // Skip validation during build phase (next build renders pages server-side
  // where runtime env vars like NEXTAUTH_SECRET are not available).
  // The NEXT_PHASE env var is set by Next.js during build.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (isBuildPhase) {
    _env = process.env as unknown as Env;
    return _env;
  }

  // Secrets come from the mounted directory (production) or, in development
  // and test without SECRETS_DIR, from the environment. See src/lib/secrets.ts.
  _secrets = loadSecrets(process.env);
  const source = { ...nonSecretEnv(process.env), ..._secrets.values };
  const result = envSchema.safeParse(source);
  const leaked = _secrets.leakedEnvKeys.map((k) => ({
    path: [k],
    message: "secret-bearing environment variable is not allowed when secrets are read from SECRETS_DIR",
  }));

  if (!result.success || leaked.length) {
    const formatted = [...(result.success ? [] : result.error.issues), ...leaked]
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    console.error(
      `\n❌ Environment validation failed:\n${formatted}\n\n` +
      `Check your .env file against .env.example for required variables.\n`,
    );

    // In development/test, warn but don't crash to allow partial setup
    if (process.env.NODE_ENV !== "production") {
      console.warn("⚠️  Continuing with invalid env in development mode.\n");
      // Environment mode keeps the live process.env view, as before; a secrets
      // directory keeps the merged copy so secrets never enter process.env.
      _env = (_secrets.source === "environment" ? process.env : source) as unknown as Env;
      return _env;
    }

    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  _env = result.data;
  _validated = true;
  return _env;
}

/**
 * A secret by name, for keys not in the schema (per-user the custody provider secrets named
 * by CUSTODY_API_CREDENTIALS[].secretRef). Reads through the secret loader.
 */
export function secret(name: string): string | undefined {
  getEnv();
  if (_secrets?.source === "environment") return environmentSecret(name);
  return _secrets?.values[name];
}

/** Where secrets were loaded from, for the readiness probe (never the values). */
export function secretSourceInfo(): { source: SecretSource["source"]; dir: string | null; keys: string[] } | null {
  getEnv();
  return _secrets ? { source: _secrets.source, dir: _secrets.dir, keys: Object.keys(_secrets.values).sort() } : null;
}

/** Test hook: re-read the environment and secrets. */
export function __resetEnvForTests(): void {
  _env = null;
  _validated = false;
  _secrets = null;
}

/**
 * Whether the environment has been successfully validated.
 * Useful for health checks to report configuration status.
 */
export function isEnvValidated(): boolean {
  return _validated;
}

/**
 * Convenience accessor for a single validated env var.
 * Use this instead of process.env.FOO throughout the codebase.
 */
export function env<K extends keyof Env>(key: K): Env[K] {
  return getEnv()[key];
}

// Validate on module load (skipped during build)
getEnv();

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

const envSchema = z.object({
  // ─── Required ───
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(16, "NEXTAUTH_SECRET must be at least 16 characters"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),

  // ─── Optional with defaults ───
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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

  // Jira
  JIRA_BASE_URL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),

  // Confluence
  CONFLUENCE_BASE_URL: z.string().optional(),
  CONFLUENCE_API_TOKEN: z.string().optional(),
  CONFLUENCE_EMAIL: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CHANNELS: z.string().optional(),

  // Email (IMAP/SMTP)
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.string().optional(),
  IMAP_USER: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  IMAP_TLS: z.string().optional(),
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
  FIREBLOCKS_API_KEY: z.string().optional(),
  FIREBLOCKS_API_SECRET: z.string().optional(),
  NOTABENE_API_BASE_URL: z.string().optional(),
  NOTABENE_API_TOKEN: z.string().optional(),
  NOTABENE_VASP_DID: z.string().optional(),

  // AI
  AI_PROVIDER: z.enum(["groq", "anthropic", "ollama"]).optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),

  // Webhook secrets
  JIRA_WEBHOOK_SECRET: z.string().optional(),

  // Fireblocks
  FIREBLOCKS_API_BASE_URL: z.string().optional(),

  // Job runner
  SLACK_OPS_CHANNEL_ID: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().optional(),

  // Railway deployment
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables.
 * Throws on first access if validation fails in production.
 */
let _env: Env | null = null;
let _validated = false;

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

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i: z.ZodIssue) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    console.error(
      `\n❌ Environment validation failed:\n${formatted}\n\n` +
      `Check your .env file against .env.example for required variables.\n`,
    );

    // In development/test, warn but don't crash to allow partial setup
    if (process.env.NODE_ENV !== "production") {
      console.warn("⚠️  Continuing with invalid env in development mode.\n");
      _env = process.env as unknown as Env;
      return _env;
    }

    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  _env = result.data;
  _validated = true;
  return _env;
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

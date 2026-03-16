/**
 * Environment variable validation using Zod.
 *
 * Validates all required and optional env vars at import time.
 * Imported early in the application lifecycle (e.g., instrumentation.ts or layout.tsx)
 * to catch misconfiguration before any request is served.
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
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),

  // Railway deployment
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables.
 * Throws on first access if validation fails.
 */
let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    console.error(
      `\n❌ Environment validation failed:\n${formatted}\n\n` +
      `Check your .env file against .env.example for required variables.\n`,
    );

    // In development, warn but don't crash to allow partial setup
    if (process.env.NODE_ENV !== "production") {
      console.warn("⚠️  Continuing with invalid env in development mode.\n");
      _env = process.env as unknown as Env;
      return _env;
    }

    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  _env = result.data;
  return _env;
}

// Validate on module load
getEnv();

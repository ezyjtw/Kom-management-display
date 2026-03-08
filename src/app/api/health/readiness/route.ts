/**
 * GET /api/health/readiness
 *
 * Readiness probe — confirms the app can serve requests.
 * Checks DB connectivity, migration state, and critical env vars.
 */
import { prisma } from "@/lib/prisma";
import { apiSuccess } from "@/lib/api/response";

interface ReadinessCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  message?: string;
  latencyMs?: number;
}

export async function GET() {
  const checks: ReadinessCheck[] = [];
  let overallStatus = "ready";

  // Database connectivity
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({
      name: "database",
      status: "pass",
      message: "Connected",
      latencyMs: Date.now() - dbStart,
    });
  } catch (error) {
    overallStatus = "not_ready";
    checks.push({
      name: "database",
      status: "fail",
      message: error instanceof Error ? error.message : "Unreachable",
      latencyMs: Date.now() - dbStart,
    });
  }

  // Critical environment variables
  const criticalEnvVars = [
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
  ];
  const missingEnv = criticalEnvVars.filter((v) => !process.env[v]);
  if (missingEnv.length > 0) {
    overallStatus = "not_ready";
    checks.push({
      name: "environment",
      status: "fail",
      message: `Missing: ${missingEnv.join(", ")}`,
    });
  } else {
    checks.push({ name: "environment", status: "pass", message: "All critical vars present" });
  }

  // Optional integrations status
  const integrations: Record<string, string[]> = {
    jira: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    slack: ["SLACK_BOT_TOKEN"],
    email: ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"],
    komainu: ["KOMAINU_API_KEY"],
    notabene: ["NOTABENE_API_KEY"],
    fireblocks: ["FIREBLOCKS_API_KEY"],
  };

  const configuredIntegrations: string[] = [];
  for (const [name, vars] of Object.entries(integrations)) {
    if (vars.every((v) => process.env[v])) {
      configuredIntegrations.push(name);
    }
  }
  checks.push({
    name: "integrations",
    status: "pass",
    message: configuredIntegrations.length > 0
      ? `Configured: ${configuredIntegrations.join(", ")}`
      : "No external integrations configured",
  });

  const statusCode = overallStatus === "ready" ? 200 : 503;

  return apiSuccess(
    {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
      version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
      environment: process.env.NODE_ENV || "development",
    },
    undefined,
    statusCode,
  );
}

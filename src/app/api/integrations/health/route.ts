/**
 * GET /api/integrations/health
 *
 * Returns health status for all configured integrations.
 * Admin-only endpoint for the integrations dashboard.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-user";
import type { IntegrationHealth } from "@/modules/integrations/types";

// Integration health tracking (in-memory, populated by sync operations)
const healthStore = new Map<string, IntegrationHealth>();

export async function GET() {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const sources = ["jira", "slack", "email", "fireblocks", "komainu", "notabene"] as const;
  const envChecks: Record<string, string[]> = {
    jira: ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"],
    slack: ["SLACK_BOT_TOKEN"],
    email: ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"],
    fireblocks: ["FIREBLOCKS_API_KEY"],
    komainu: ["KOMAINU_API_KEY"],
    notabene: ["NOTABENE_API_KEY"],
  };

  const integrations = sources.map((source) => {
    const stored = healthStore.get(source);
    if (stored) return stored;

    const configured = envChecks[source]?.every((v) => !!process.env[v]) ?? false;
    return {
      source,
      configured,
      lastSuccessfulSync: null,
      lastFailure: null,
      queueBacklog: 0,
      failureCount: 0,
      status: configured ? ("healthy" as const) : ("unconfigured" as const),
    };
  });

  return NextResponse.json({
    success: true,
    data: integrations,
    timestamp: new Date().toISOString(),
  });
}

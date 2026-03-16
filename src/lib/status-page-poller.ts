/**
 * Status Page Poller — Stream 3
 *
 * Polls external service provider status pages for incidents/events.
 * Supports: Atlassian Statuspage, PagerDuty, custom REST endpoints.
 * Normalizes results and correlates with existing Slack threads.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { CircuitBreaker } from "@/lib/circuit-breaker";

interface StatusPageIncident {
  externalId: string;
  title: string;
  severity: "critical" | "major" | "minor" | "maintenance";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  affectedComponents: string[];
  startedAt: Date;
  resolvedAt: Date | null;
  rawPayload: Record<string, unknown>;
}

interface ProviderInput {
  id: string;
  name: string;
  statusPageUrl: string | null;
  statusPageType: string | null;
  slackChannelId: string | null;
}

/**
 * Poll a provider's status page for active incidents.
 *
 * - Switches on statusPageType
 * - Normalizes results
 * - Upserts using @@unique[providerId, externalId]
 * - Calls correlateWithSlackThreads for new active events
 */
export async function pollStatusPage(
  provider: ProviderInput,
): Promise<StatusPageIncident[]> {
  if (!provider.statusPageUrl || !provider.statusPageType) {
    return [];
  }

  const breaker = CircuitBreaker.for(`status_page_${provider.name}`, {
    failureThreshold: 3,
    cooldownMs: 120_000,
    callTimeoutMs: 15_000,
  });

  let incidents: StatusPageIncident[] = [];

  try {
    incidents = await breaker.execute(async () => {
      switch (provider.statusPageType) {
        case "statuspage":
          return await pollAtlassianStatuspage(provider.statusPageUrl!);
        case "pagerduty":
          return await pollPagerDuty(provider.statusPageUrl!);
        case "custom":
          return await pollCustomEndpoint(provider.statusPageUrl!);
        default:
          logger.warn("pollStatusPage: unknown type", {
            provider: provider.name,
            type: provider.statusPageType,
          });
          return [];
      }
    });
  } catch (error) {
    logger.error("pollStatusPage: fetch failed", {
      provider: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  // Upsert events
  for (const incident of incidents) {
    try {
      const existing = await prisma.statusPageEvent.findUnique({
        where: {
          providerId_externalId: {
            providerId: provider.id,
            externalId: incident.externalId,
          },
        },
      });

      if (existing) {
        // Update existing
        await prisma.statusPageEvent.update({
          where: { id: existing.id },
          data: {
            title: incident.title,
            severity: incident.severity,
            status: incident.status,
            affectedComponents: incident.affectedComponents as Prisma.InputJsonValue,
            resolvedAt: incident.resolvedAt,
            rawPayload: incident.rawPayload as Prisma.InputJsonValue,
            polledAt: new Date(),
          },
        });
      } else {
        // Create new
        const event = await prisma.statusPageEvent.create({
          data: {
            providerId: provider.id,
            externalId: incident.externalId,
            title: incident.title,
            severity: incident.severity,
            status: incident.status,
            affectedComponents: incident.affectedComponents as Prisma.InputJsonValue,
            startedAt: incident.startedAt,
            resolvedAt: incident.resolvedAt,
            rawPayload: incident.rawPayload as Prisma.InputJsonValue,
          },
        });

        // Correlate new active events with Slack threads
        if (incident.status !== "resolved") {
          await correlateWithSlackThreads(event.id, provider);
        }
      }
    } catch (error) {
      logger.error("pollStatusPage: upsert failed", {
        provider: provider.name,
        externalId: incident.externalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("pollStatusPage: complete", {
    provider: provider.name,
    incidentCount: incidents.length,
  });

  return incidents;
}

/**
 * Correlate a status page event with recent Slack threads from the same provider.
 *
 * Looks for threads where:
 * - Channel matches the provider's Slack channel
 * - Created within the last 2 hours
 * - Urgency score >= 3
 */
export async function correlateWithSlackThreads(
  eventId: string,
  provider: ProviderInput,
): Promise<void> {
  if (!provider.slackChannelId) return;

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  // Find the SlackChannel record
  const slackChannel = await prisma.slackChannel.findUnique({
    where: { channelId: provider.slackChannelId },
  });

  if (!slackChannel) return;

  const threads = await prisma.commsThread.findMany({
    where: {
      slackChannelId: slackChannel.id,
      createdAt: { gte: twoHoursAgo },
      aiUrgencyScore: { gte: 3 },
    },
    select: { id: true },
    take: 5,
  });

  if (threads.length > 0) {
    // Link the first matching thread to the event
    await prisma.statusPageEvent.update({
      where: { id: eventId },
      data: { linkedThreadId: threads[0].id },
    });

    logger.info("correlateWithSlackThreads: linked event to thread", {
      eventId,
      threadId: threads[0].id,
      provider: provider.name,
    });
  }
}

// ─── Status Page Parsers ───

async function pollAtlassianStatuspage(
  url: string,
): Promise<StatusPageIncident[]> {
  // Atlassian Statuspage API: /api/v2/incidents/unresolved.json
  const apiUrl = url.replace(/\/$/, "") + "/api/v2/incidents/unresolved.json";

  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Statuspage HTTP ${res.status}`);
  }

  const data = await res.json();
  const incidents: StatusPageIncident[] = [];

  for (const inc of data.incidents || []) {
    const severity = mapStatuspageSeverity(inc.impact);
    const status = mapStatuspageStatus(inc.status);

    incidents.push({
      externalId: inc.id,
      title: inc.name || "Unknown incident",
      severity,
      status,
      affectedComponents: (inc.components || []).map((c: { name: string }) => c.name),
      startedAt: new Date(inc.started_at || inc.created_at),
      resolvedAt: inc.resolved_at ? new Date(inc.resolved_at) : null,
      rawPayload: inc,
    });
  }

  return incidents;
}

async function pollPagerDuty(url: string): Promise<StatusPageIncident[]> {
  const apiUrl = url.replace(/\/$/, "") + "/api/v1/incidents?statuses[]=triggered&statuses[]=acknowledged";

  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`PagerDuty HTTP ${res.status}`);
  }

  const data = await res.json();
  const incidents: StatusPageIncident[] = [];

  for (const inc of data.incidents || []) {
    incidents.push({
      externalId: inc.id,
      title: inc.title || inc.description || "Unknown",
      severity: mapPagerDutySeverity(inc.urgency),
      status: inc.status === "triggered" ? "investigating" : "identified",
      affectedComponents: (inc.impacted_services || []).map(
        (s: { summary: string }) => s.summary,
      ),
      startedAt: new Date(inc.created_at),
      resolvedAt: inc.resolved_at ? new Date(inc.resolved_at) : null,
      rawPayload: inc,
    });
  }

  return incidents;
}

async function pollCustomEndpoint(url: string): Promise<StatusPageIncident[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Custom endpoint HTTP ${res.status}`);
  }

  const data = await res.json();
  const incidents: StatusPageIncident[] = [];

  // Expect { incidents: [{ id, title, severity, status, components, started_at, resolved_at }] }
  for (const inc of data.incidents || []) {
    incidents.push({
      externalId: String(inc.id),
      title: inc.title || "Unknown",
      severity: inc.severity || "minor",
      status: inc.status || "investigating",
      affectedComponents: inc.components || [],
      startedAt: new Date(inc.started_at || Date.now()),
      resolvedAt: inc.resolved_at ? new Date(inc.resolved_at) : null,
      rawPayload: inc,
    });
  }

  return incidents;
}

// ─── Mappers ───

function mapStatuspageSeverity(impact: string): StatusPageIncident["severity"] {
  switch (impact) {
    case "critical": return "critical";
    case "major": return "major";
    case "minor": return "minor";
    case "maintenance": return "maintenance";
    default: return "minor";
  }
}

function mapStatuspageStatus(status: string): StatusPageIncident["status"] {
  switch (status) {
    case "investigating": return "investigating";
    case "identified": return "identified";
    case "monitoring": return "monitoring";
    case "resolved": return "resolved";
    case "postmortem": return "resolved";
    default: return "investigating";
  }
}

function mapPagerDutySeverity(urgency: string): StatusPageIncident["severity"] {
  switch (urgency) {
    case "high": return "critical";
    case "low": return "minor";
    default: return "major";
  }
}

/**
 * Poll all active providers with status pages.
 * Called by the poll_status_pages background job.
 */
export async function pollAllStatusPages(): Promise<void> {
  const providers = await prisma.serviceProvider.findMany({
    where: {
      isActive: true,
      statusPageUrl: { not: null },
      statusPageType: { not: null },
    },
    select: {
      id: true,
      name: true,
      statusPageUrl: true,
      statusPageType: true,
      slackChannelId: true,
    },
  });

  logger.info("pollAllStatusPages: polling providers", {
    count: providers.length,
  });

  for (const provider of providers) {
    await pollStatusPage(provider);
  }
}

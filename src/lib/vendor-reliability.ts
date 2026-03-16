/**
 * Vendor reliability scoring.
 *
 * Computes a 0-100 reliability score for a service provider
 * over a given time period. Lower scores indicate worse reliability.
 *
 * Scoring formula — start at 100, apply deductions, clamp to [0, 100]:
 *   -5 per Incident in the period
 *   -2 per hour of average resolution time above the 4-hour threshold
 *   -10 per ClientImpactRecord in the period
 *   -5 per Incident where rcaStatus != 'closed' past rcaSlaDeadline
 *   -5 per ExternalTicketEvent where event = 'disputed'
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function computeVendorReliabilityScore(
  providerId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  id: string;
  providerId: string;
  periodStart: Date;
  periodEnd: Date;
  incidentCount: number;
  avgResolutionMins: number;
  clientImpactCount: number;
  rcaReceivedRate: number;
  disputeCount: number;
  reliabilityScore: number;
}> {
  const provider = await prisma.serviceProvider.findUnique({
    where: { id: providerId },
  });

  if (!provider) {
    throw new Error(`ServiceProvider ${providerId} not found`);
  }

  // Find incidents for this provider in the period
  const incidents = await prisma.incident.findMany({
    where: {
      provider: provider.name,
      createdAt: { gte: periodStart, lte: periodEnd },
    },
  });

  const incidentCount = incidents.length;

  // Calculate average resolution time in minutes
  let totalResolutionMins = 0;
  let resolvedCount = 0;
  for (const incident of incidents) {
    if (incident.resolvedAt) {
      const durationMs = incident.resolvedAt.getTime() - incident.startedAt.getTime();
      totalResolutionMins += durationMs / 60_000;
      resolvedCount++;
    }
  }
  const avgResolutionMins = resolvedCount > 0 ? totalResolutionMins / resolvedCount : 0;

  // Count client impacts
  const incidentIds = incidents.map((i) => i.id);
  const clientImpactCount = incidentIds.length > 0
    ? await prisma.clientImpactRecord.count({
        where: { incidentId: { in: incidentIds } },
      })
    : 0;

  // Count RCA overdue incidents
  const rcaOverdueCount = incidents.filter(
    (i) =>
      i.rcaStatus !== "closed" &&
      i.rcaSlaDeadline &&
      i.rcaSlaDeadline < new Date(),
  ).length;

  // Count RCA received
  const rcaReceivedCount = incidents.filter(
    (i) => i.rcaStatus === "rca_received" || i.rcaStatus === "closed",
  ).length;
  const rcaReceivedRate = incidentCount > 0 ? rcaReceivedCount / incidentCount : 0;

  // Count disputes
  const disputeCount = incidentIds.length > 0
    ? await prisma.externalTicketEvent.count({
        where: {
          incidentId: { in: incidentIds },
          event: "disputed",
        },
      })
    : 0;

  // Calculate score
  let score = 100;

  // -5 per incident
  score -= incidentCount * 5;

  // -2 per hour of avg resolution above 4 hours
  const avgResolutionHours = avgResolutionMins / 60;
  if (avgResolutionHours > 4) {
    score -= Math.floor(avgResolutionHours - 4) * 2;
  }

  // -10 per client impact
  score -= clientImpactCount * 10;

  // -5 per RCA overdue
  score -= rcaOverdueCount * 5;

  // -5 per dispute
  score -= disputeCount * 5;

  // Clamp to [0, 100]
  score = Math.max(0, Math.min(100, score));

  // Upsert the score record
  const existing = await prisma.vendorReliabilityScore.findFirst({
    where: {
      providerId,
      periodStart,
    },
  });

  const data = {
    providerId,
    periodStart,
    periodEnd,
    incidentCount,
    avgResolutionMins,
    clientImpactCount,
    rcaReceivedRate,
    disputeCount,
    reliabilityScore: score,
    computedAt: new Date(),
  };

  let record;
  if (existing) {
    record = await prisma.vendorReliabilityScore.update({
      where: { id: existing.id },
      data,
    });
  } else {
    record = await prisma.vendorReliabilityScore.create({ data });
  }

  logger.info("Vendor reliability score computed", {
    providerId,
    providerName: provider.name,
    score,
    incidentCount,
    clientImpactCount,
  });

  return record;
}

/**
 * Compute reliability scores for all active providers.
 * Called by the score_vendor_reliability background job (quarterly).
 */
export async function computeAllVendorScores(
  periodStart: Date,
  periodEnd: Date,
): Promise<void> {
  const providers = await prisma.serviceProvider.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  logger.info("computeAllVendorScores: computing for all providers", {
    count: providers.length,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });

  for (const provider of providers) {
    try {
      await computeVendorReliabilityScore(provider.id, periodStart, periodEnd);
    } catch (error) {
      logger.error("computeAllVendorScores: failed for provider", {
        providerId: provider.id,
        providerName: provider.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

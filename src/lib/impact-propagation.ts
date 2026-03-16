/**
 * Impact Propagation — Stream 3
 *
 * When an incident is created/updated, determines which clients are
 * affected based on their service dependencies and creates
 * ClientImpactRecord entries + enqueues comms draft jobs.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { enqueueJob } from "@/lib/background-jobs";
import type { JobType } from "@/lib/background-jobs";

export interface PropagationResult {
  incidentId: string;
  impactRecords: Array<{
    id: string;
    clientName: string;
    affectedServices: string[];
    isNew: boolean;
  }>;
  totalClients: number;
}

/**
 * Propagate an incident to all affected clients based on service dependencies.
 *
 * 1. Finds the ServiceProvider by name (matching incident.provider)
 * 2. Queries ClientServiceDependency where providerId matches
 * 3. Filters: serviceNames intersection with incident.affectedServices
 * 4. Upserts ClientImpactRecord per matching dependency
 * 5. Enqueues draft comms job for each new record
 * 6. Updates Incident.clientImpactCount
 */
export async function propagateIncidentToClients(
  incidentId: string,
): Promise<PropagationResult> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });

  if (!incident) {
    throw new Error(`Incident ${incidentId} not found`);
  }

  const affectedServices: string[] = Array.isArray(incident.affectedServices)
    ? (incident.affectedServices as string[])
    : [];

  // Find the ServiceProvider by name
  const provider = await prisma.serviceProvider.findUnique({
    where: { name: incident.provider },
  });

  if (!provider) {
    logger.warn("propagateIncidentToClients: provider not found", {
      incidentId,
      providerName: incident.provider,
    });
    return { incidentId, impactRecords: [], totalClients: 0 };
  }

  // Query all client dependencies for this provider
  const dependencies = await prisma.clientServiceDependency.findMany({
    where: { providerId: provider.id },
  });

  const results: PropagationResult["impactRecords"] = [];

  for (const dep of dependencies) {
    const depServices: string[] = Array.isArray(dep.serviceNames)
      ? (dep.serviceNames as string[])
      : [];

    // Filter: check intersection of serviceNames with affectedServices
    const intersection = affectedServices.length > 0
      ? depServices.filter((s) => affectedServices.includes(s))
      : depServices; // If no specific services listed, assume all are affected

    if (intersection.length === 0 && affectedServices.length > 0) {
      continue; // This client doesn't use any of the affected services
    }

    // Upsert ClientImpactRecord
    const existing = await prisma.clientImpactRecord.findUnique({
      where: {
        incidentId_clientName: {
          incidentId,
          clientName: dep.clientName,
        },
      },
    });

    if (existing) {
      // Update affected services if needed
      const existingServices: string[] = Array.isArray(existing.affectedServices)
        ? (existing.affectedServices as string[])
        : [];
      const merged = [...new Set([...existingServices, ...intersection])];

      await prisma.clientImpactRecord.update({
        where: { id: existing.id },
        data: { affectedServices: merged as Prisma.InputJsonValue },
      });

      results.push({
        id: existing.id,
        clientName: dep.clientName,
        affectedServices: merged,
        isNew: false,
      });
    } else {
      const record = await prisma.clientImpactRecord.create({
        data: {
          incidentId,
          clientName: dep.clientName,
          clientAccountId: dep.clientAccountId,
          affectedServices: intersection as Prisma.InputJsonValue,
          impactStatus: "potential",
          impactStartAt: incident.startedAt,
        },
      });

      results.push({
        id: record.id,
        clientName: dep.clientName,
        affectedServices: intersection,
        isNew: true,
      });

      // Enqueue draft comms job for new impact records
      try {
        await enqueueJob("sync_slack" as JobType, {
          _jobAction: "draft_client_comms",
          impactRecordId: record.id,
          incidentId,
        });
      } catch (err) {
        logger.warn("propagateIncidentToClients: failed to enqueue comms job", {
          impactRecordId: record.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Update incident client impact count
  const totalImpactRecords = await prisma.clientImpactRecord.count({
    where: { incidentId },
  });

  await prisma.incident.update({
    where: { id: incidentId },
    data: { clientImpactCount: totalImpactRecords },
  });

  logger.info("propagateIncidentToClients: complete", {
    incidentId,
    totalClients: results.length,
    newRecords: results.filter((r) => r.isNew).length,
  });

  return {
    incidentId,
    impactRecords: results,
    totalClients: results.length,
  };
}

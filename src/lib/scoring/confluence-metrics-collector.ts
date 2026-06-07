import { prisma } from "@/lib/prisma";
import type { ScoringConfigData } from "@/types";

export interface ProjectsMetrics {
  pagesCreated: number;
  pagesUpdated: number;
  qualityMarkers: number;
  workingDaysFactor: number;
}

export async function collectProjectsMetrics(
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
  config: ScoringConfigData,
): Promise<ProjectsMetrics> {
  const qualifyingSpaces = config.definitions.confluence.qualifyingSpaces;
  const qualifyingLabels = config.definitions.confluence.qualifyingLabels;

  const pagesCreated = await prisma.confluencePageState.count({
    where: {
      employeeId,
      spaceKey: { in: qualifyingSpaces },
      createdInConfluence: { gte: periodStart, lte: periodEnd },
      version: 1,
    },
  });

  const pagesUpdated = await prisma.confluencePageState.count({
    where: {
      employeeId,
      spaceKey: { in: qualifyingSpaces },
      updatedInConfluence: { gte: periodStart, lte: periodEnd },
      version: { gt: 1 },
    },
  });

  const allPages = await prisma.confluencePageState.findMany({
    where: {
      employeeId,
      spaceKey: { in: qualifyingSpaces },
      OR: [
        { createdInConfluence: { gte: periodStart, lte: periodEnd } },
        { updatedInConfluence: { gte: periodStart, lte: periodEnd } },
      ],
    },
    select: { labels: true },
  });

  let pagesWithQualityLabels = 0;
  for (const page of allPages) {
    const labels = Array.isArray(page.labels) ? page.labels as string[] : [];
    if (labels.some((l) => qualifyingLabels.includes(l))) {
      pagesWithQualityLabels++;
    }
  }
  const qualityMarkers = allPages.length > 0 ? pagesWithQualityLabels / allPages.length : 0;

  const periodDays = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const ptoCount = await prisma.ptoRecord.count({
    where: {
      employeeId,
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
      status: "approved",
    },
  });
  const workingDaysFactor = Math.max(0.1, 1 - (ptoCount * 5) / periodDays);

  return {
    pagesCreated,
    pagesUpdated,
    qualityMarkers,
    workingDaysFactor,
  };
}

/**
 * Team boards (spec §12 common template, f): one card per check or task for
 * the owning team, with today's item, proposed evidence, open exceptions,
 * known issues (findings register) and the Confluence link.
 */

import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { londonParts } from "@/modules/alerting/calendar";
import { CONFLUENCE_PLACEHOLDER_PREFIX, DEFINITION_BY_CODE, type KnownIssue } from "@/modules/daily-checks/definitions";
import { parseCollected, type Collected } from "@/modules/daily-checks/collectors";
import { periodsFor } from "@/modules/daily-checks/schedule";

const OPEN = ["open", "owned", "waiting_client", "waiting_vendor", "waiting_internal"] as const;

export interface BoardItem {
  id: string;
  periodKey: string | null;
  status: string;
  recordCount: number | null;
  dataAsOf: string | null;
  skippedReason: string | null;
  skipRequestedBy: string | null;
  exceptionCount: number;
  proposal: Collected | null;
}

export interface BoardCard {
  code: string;
  name: string;
  team: string;
  kind: string;
  frequency: string;
  dueByLocal: string;
  ticketProject: string;
  confluenceUrl: string | null;
  confluenceTitle: string | null;
  requiredFields: string[];
  evidenceNotes: string | null;
  hasCollector: boolean;
  restricted: boolean;
  disabledByFlag: string | null;
  knownIssues: KnownIssue[];
  banners: string[];
  items: BoardItem[];
  openWorkItems: number;
}

export const APPROVED_VALIDATORS_MISSING = "Approved validator set not defined: control 5.1 cannot be evidenced.";

export async function buildBoard(team: string | null, opts: { now?: Date; canViewKps: boolean }): Promise<BoardCard[]> {
  const now = opts.now ?? new Date();
  const today = londonParts(now).date;
  const defs = await prisma.dailyCheckDefinition.findMany({
    where: { isActive: true, ...(team ? { team: { in: [team, "All"] } } : {}) },
    orderBy: { code: "asc" },
  });
  const validators = await prisma.approvedValidator.count();
  const cards: BoardCard[] = [];

  for (const def of defs) {
    const spec = DEFINITION_BY_CODE[def.code];
    const evidence = (def.evidenceSpec ?? {}) as { requiredFields?: string[]; notes?: string };
    const flagOff = def.requiredFlag && !(await isFeatureEnabled(def.requiredFlag)) ? def.requiredFlag : null;
    const hidden = def.restricted && !opts.canViewKps;

    const periodKeys = (await periodsFor(def, now)).map((p) => p.key);
    const items = hidden || flagOff
      ? []
      : await prisma.dailyCheckItem.findMany({
          where: { definitionCode: def.code, OR: [{ periodKey: { in: periodKeys } }, { periodKey: { startsWith: today } }] },
          orderBy: { createdAt: "asc" },
        });
    const openWorkItems = hidden ? 0 : await prisma.workItem.count({ where: { taskCode: def.code, state: { in: [...OPEN] } } });

    const banners: string[] = [];
    if (def.code === "CHK-08" && validators === 0) banners.push(APPROVED_VALIDATORS_MISSING);
    if (flagOff) banners.push(`Disabled: feature flag ${flagOff} is off.`);
    if (hidden) banners.push("Restricted: requires kps:view.");

    cards.push({
      code: def.code,
      name: def.name,
      team: def.team,
      kind: def.kind,
      frequency: def.frequency,
      dueByLocal: def.dueByLocal,
      ticketProject: def.ticketProject,
      confluenceUrl: def.confluenceUrl.startsWith(CONFLUENCE_PLACEHOLDER_PREFIX) ? null : def.confluenceUrl,
      confluenceTitle: spec?.confluenceTitle ?? null,
      requiredFields: evidence.requiredFields ?? [],
      evidenceNotes: evidence.notes ?? null,
      hasCollector: !!spec?.collector,
      restricted: def.restricted,
      disabledByFlag: flagOff,
      knownIssues: spec?.knownIssues ?? [],
      banners,
      items: items.map((i) => ({
        id: i.id,
        periodKey: i.periodKey,
        status: i.status,
        recordCount: i.recordCount,
        dataAsOf: i.dataAsOf?.toISOString() ?? null,
        skippedReason: i.skippedReason,
        skipRequestedBy: i.skipRequestedBy,
        exceptionCount: Array.isArray(i.exceptionWorkItemIds) ? i.exceptionWorkItemIds.length : 0,
        proposal: parseCollected(i.autoResult),
      })),
      openWorkItems,
    });
  }
  return cards;
}

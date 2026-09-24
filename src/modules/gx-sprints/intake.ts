/**
 * GX sprint intake (spec §16.1–16.5). Reads release notes (Confluence) and
 * change tickets (KMNC), keeps GxChange rows in step with the page, and
 * creates UAT tickets for qualifying items. Idempotent: an unchanged page
 * creates nothing; an edited row updates its ticket with a comment; a removed
 * row is marked removed and its ticket commented, never closed.
 *
 * KOMmand Centre only creates and tracks tickets. It never executes tests
 * against GX and never approves anything in any environment (H1).
 */

import type { GxChange, GxSprint, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isAtlassianConfigured, linkIssues } from "@/lib/integrations/atlassian/client";
import { isConfluenceConfigured } from "@/lib/integrations/confluence/client";
import { addBusinessDays, loadCalendar, londonParts } from "@/modules/alerting/calendar";
import { raiseAlert } from "@/modules/alerting/raise";
import { getSettings } from "@/modules/settings/settings";
import { ensureTicketedWorkItem } from "@/modules/work-items/tickets";
import { assignOwner, commentInternal } from "@/modules/work-items/ticket-writeback";
import { DEFINITION_BY_CODE } from "@/modules/daily-checks/definitions";
import { classify, type Classification, type MappingConfig } from "@/modules/gx-sprints/mapping";
import { markdownToBlocks, parseReleaseNotes, rowHashOf, storageToBlocks, type ParsedNotes, type ParsedRow } from "@/modules/gx-sprints/parse";
import { kmncSprints, notesBody, releaseNotesPages, sprintLabelledTickets, type KmncSprintDates } from "@/modules/gx-sprints/sources";

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const TEAMS = ["Team 1", "Team 2", "Team 3"];

export interface IntakeResult {
  sprints: string[];
  newItems: number;
  updatedItems: number;
  removedItems: number;
  ticketsCreated: number;
  skipped: string[];
}

async function settings() {
  return getSettings([
    "gx.releaseNotesSpace", "gx.releaseNotesParentPageId", "gx.kmncProject", "gx.uat.project", "gx.uat.issueType",
    "gx.uat.leadBusinessDays", "gx.uat.fallbackBusinessDays", "gx.uat.include_wallet_tech", "gx.operationalKeywords", "gx.dataImpactPatterns",
  ] as const);
}
type Settings = Awaited<ReturnType<typeof settings>>;

export async function mappingConfig(cfg?: Settings): Promise<MappingConfig> {
  const s = cfg ?? (await settings());
  return {
    rules: await prisma.gxImpactRule.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    operationalKeywords: s["gx.operationalKeywords"],
    dataImpactPatterns: s["gx.dataImpactPatterns"],
    includeWalletTech: s["gx.uat.include_wallet_tech"],
  };
}

const sprintLabel = (sprint: string) => `gx-sprint-${sprint.replace(/\./g, "-")}`;

/** UAT due date: PROD − lead business days, else UAT landed + fallback business days. */
export async function uatDueDate(sprint: Pick<GxSprint, "prodPlannedAt" | "uatLandedAt">, cfg: Settings): Promise<string | undefined> {
  const cal = await loadCalendar("business_uk", new Date(Date.now() - 60 * 86_400_000), new Date(Date.now() + 120 * 86_400_000));
  if (sprint.prodPlannedAt) return addBusinessDays(cal, londonParts(sprint.prodPlannedAt).date, -cfg["gx.uat.leadBusinessDays"]);
  if (sprint.uatLandedAt) return addBusinessDays(cal, londonParts(sprint.uatLandedAt).date, cfg["gx.uat.fallbackBusinessDays"]);
  return undefined;
}

function describe(sprint: GxSprint, change: GxChange, template: { steps: string; expectedResults: string; evidenceRequired: string } | null): string {
  const detail = (change.detail ?? {}) as Record<string, string>;
  const tags = strings(change.tags);
  const outline = template && template.steps.trim()
    ? [`Test outline:\n${template.steps}`, template.expectedResults ? `Expected results:\n${template.expectedResults}` : "", template.evidenceRequired ? `Evidence required:\n${template.evidenceRequired}` : ""].filter(Boolean).join("\n\n")
    : "Test outline not yet written: owner to define.";
  return [
    `Change item from GX Sprint ${sprint.sprint} release notes (page version ${change.pageVersion}), section "${change.section}".`,
    Object.entries(detail).map(([h, v]) => `${h}: ${v || "—"}`).join("\n"),
    `Release notes: ${sprint.releaseNotesUrl || "(page link not available)"} (section: ${change.section})`,
    `GX Jira: ${strings(change.gxJiraKeys).join(", ") || "none"}`,
    `Affected tasks: ${strings(change.affectedTasks).join(", ") || "none mapped"}. Alerts: ${strings(change.affectedAlerts).join(", ") || "none"}. Controls: ${strings(change.affectedControls).join(", ") || "none"}.`,
    outline,
    "Environment: Test in GX UAT only.",
    tags.includes("disabled-in-prod") ? "Released but disabled in PROD: not live behaviour until enabled in PROD and passed by Operations." : "",
    tags.includes("client-awareness") ? "Client-facing change: awareness only, no test by default." : "",
  ].filter(Boolean).join("\n\n");
}

async function assign(workItemId: string, change: GxChange): Promise<void> {
  const detail = (change.detail ?? {}) as Record<string, string>;
  const pic = Object.entries(detail).find(([h]) => /ops\s*pic/i.test(h))?.[1]?.trim();
  let employeeId: string | null = null;
  if (pic) {
    const matches = await prisma.employee.findMany({ where: { active: true, name: { equals: pic, mode: "insensitive" } }, select: { id: true } });
    if (matches.length === 1) employeeId = matches[0].id;
  }
  if (!employeeId && TEAMS.includes(change.team)) {
    employeeId = (await prisma.teamConfig.findUnique({ where: { team: change.team } }))?.leadEmployeeId ?? null;
  }
  if (!employeeId) return;
  try {
    await assignOwner(workItemId, employeeId);
  } catch (error) {
    logger.warn("UAT ticket assignment failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function link(fromKey: string | null, toKey: string | null): Promise<void> {
  if (!fromKey || !toKey || fromKey === toKey) return;
  try {
    await linkIssues(fromKey, toKey);
  } catch (error) {
    logger.warn("UAT ticket link failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function comment(workItemId: string | null, text: string): Promise<void> {
  if (!workItemId) return;
  try {
    await commentInternal(workItemId, text);
  } catch (error) {
    logger.warn("UAT ticket comment failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function ensureParent(sprint: GxSprint, cfg: Settings): Promise<{ id: string; ticketKey: string | null }> {
  const item = await ensureTicketedWorkItem({
    kind: "internal_task",
    title: `GX Sprint ${sprint.sprint} — Transaction Operations UAT`,
    team: "All",
    taskCode: "UAT",
    sourceSystem: "gx_sprint",
    sourceId: `${sprint.sprint}:parent`,
    clockStartedAt: new Date(),
    metadata: { gxSprintId: sprint.id },
    ticket: {
      projectKey: cfg["gx.uat.project"],
      issueType: cfg["gx.uat.issueType"],
      summary: `GX Sprint ${sprint.sprint} — Transaction Operations UAT`,
      description: `UAT for GX Sprint ${sprint.sprint}. Release notes: ${sprint.releaseNotesUrl || "(link not available)"}. Child tickets are linked. Testing happens in GX UAT, by people.`,
      labels: ["uat", sprintLabel(sprint.sprint)],
      dueDate: await uatDueDate(sprint, cfg),
    },
  });
  if (sprint.parentWorkItemId !== item.id || sprint.parentTicketKey !== item.ticketKey) {
    await prisma.gxSprint.update({ where: { id: sprint.id }, data: { parentWorkItemId: item.id, parentTicketKey: item.ticketKey } });
  }
  return { id: item.id, ticketKey: item.ticketKey };
}

async function childTicket(sprint: GxSprint, change: GxChange, parent: { id: string; ticketKey: string | null }, cfg: Settings): Promise<{ id: string; ticketKey: string | null; created: boolean }> {
  const template = change.uatTemplate ? await prisma.uatTemplate.findUnique({ where: { code: change.uatTemplate } }) : null;
  const existing = await prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: "gx_sprint", sourceId: `${sprint.sprint}:${change.id}` } }, select: { id: true } });
  const item = await ensureTicketedWorkItem({
    kind: "uat_task",
    title: `[UAT ${sprint.sprint}] ${change.itemType}: ${change.summary}`.slice(0, 255),
    team: TEAMS.includes(change.team) ? change.team : "All",
    taskCode: "UAT",
    sourceSystem: "gx_sprint",
    sourceId: `${sprint.sprint}:${change.id}`,
    clockStartedAt: new Date(),
    priority: change.priority,
    metadata: { gxChangeId: change.id, gxSprint: sprint.sprint, parentWorkItemId: parent.id, affectedTasks: change.affectedTasks, tags: change.tags },
    ticket: {
      projectKey: cfg["gx.uat.project"],
      issueType: cfg["gx.uat.issueType"],
      summary: `[UAT ${sprint.sprint}] ${change.itemType}: ${change.summary}`,
      description: describe(sprint, change, template),
      labels: ["uat", sprintLabel(sprint.sprint), change.itemType, ...strings(change.tags)],
      dueDate: await uatDueDate(sprint, cfg),
    },
  });
  await prisma.gxChange.update({ where: { id: change.id }, data: { workItemId: item.id, uatTicketKey: item.ticketKey } });
  if (!existing) {
    await link(parent.ticketKey, item.ticketKey);
    for (const key of strings(change.gxJiraKeys)) await link(item.ticketKey, key);
    await assign(item.id, change);
  }
  return { id: item.id, ticketKey: item.ticketKey, created: !existing };
}

/** Extra internal tasks: access review (permission changes), connector regression (API changes), TOP procedure reviews. */
async function followUps(sprint: GxSprint, change: GxChange, childKey: string | null, cfg: Settings): Promise<number> {
  let created = 0;
  const task = async (sourceId: string, title: string, description: string, labels: string[], dueDate?: string) => {
    const before = await prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: "gx_sprint", sourceId } }, select: { id: true } });
    const item = await ensureTicketedWorkItem({
      kind: "internal_task", title: title.slice(0, 255), team: "All", taskCode: "UAT", sourceSystem: "gx_sprint", sourceId, clockStartedAt: new Date(),
      metadata: { gxChangeId: change.id, gxSprint: sprint.sprint },
      ticket: { projectKey: cfg["gx.uat.project"], issueType: cfg["gx.uat.issueType"], summary: title, description, labels: ["uat", sprintLabel(sprint.sprint), ...labels], dueDate },
    });
    if (!before) {
      created++;
      await link(childKey, item.ticketKey);
    }
  };
  if (change.itemType === "permission_change") {
    await task(`${sprint.sprint}:access:${change.id}`, `[UAT ${sprint.sprint}] Access review: ${change.summary}`, `Review who holds the changed permission after GX Sprint ${sprint.sprint}.`, ["access-review"]);
  }
  if (change.itemType === "api_change" || strings(change.affectedTasks).includes("KOMMAND-CONNECTOR")) {
    await task(`${sprint.sprint}:connector`, `[UAT ${sprint.sprint}] Check Komainu API spec version and re-run connector contract tests`,
      "Run scripts/check-komainu-api-spec.ts against the new spec and the contract tests in src/__tests__/integration/komainu-api-contract.test.ts. Any new write endpoint must stay off the allowlist (H2).", ["connector-regression"]);
  }
  // Documentation follow-up per affected daily task, due after PROD; never describes the change as live before UAT passes and PROD release.
  const cal = await loadCalendar("business_uk", new Date(), new Date(Date.now() + 120 * 86_400_000));
  const due = sprint.prodPlannedAt ? addBusinessDays(cal, londonParts(sprint.prodPlannedAt).date, 2) : undefined;
  for (const code of strings(change.affectedTasks).filter((c) => DEFINITION_BY_CODE[c])) {
    const draft = strings(change.tags).includes("disabled-in-prod");
    await task(`${sprint.sprint}:doc:${code}`, `[UAT ${sprint.sprint}] Review TOP procedure for ${code}`,
      `Review the TOP procedure for ${code} (${DEFINITION_BY_CODE[code].confluenceTitle}) after GX Sprint ${sprint.sprint} reaches PROD. Do not describe the change as live until its UAT item has passed and the release is in PROD.${draft ? " The function is released but disabled in PROD: keep any change in draft." : ""}`,
      ["doc-review", ...(draft ? ["draft"] : [])], due);
  }
  return created;
}

function toData(row: ParsedRow, c: Classification, pageVersion: number) {
  return {
    section: row.section, itemType: row.itemType, summary: row.summary, detail: row.cells as Prisma.InputJsonValue,
    gxJiraKeys: row.gxJiraKeys, env: row.env, rowHash: row.rowHash, firstCell: row.firstCell.slice(0, 500), qualifies: c.qualifies,
    tags: c.tags, team: c.team, priority: c.priority, uatTemplate: c.uatTemplate, affectedTasks: c.taskCodes, affectedAlerts: c.alertCodes,
    affectedControls: c.controls, pageVersion,
  };
}

/** Apply one parsed page version to the sprint's change items. Exported for tests. */
export async function applyNotes(sprint: GxSprint, notes: ParsedNotes, pageVersion: number, now = new Date()) {
  const cfg = await settings();
  const mapping = await mappingConfig(cfg);
  const active = await prisma.gxChange.findMany({ where: { sprintId: sprint.id, removedAt: null } });
  const fullySignedOff = active.some((c) => c.qualifies) && active.filter((c) => c.qualifies).every((c) => c.uatOutcome);

  const seen = new Set<string>();
  const created: GxChange[] = [];
  const edited: Array<{ from: GxChange; to: GxChange }> = [];
  for (const row of notes.rows) {
    const match = active.find((c) => c.section === row.section && c.rowHash === row.rowHash);
    if (match) {
      seen.add(match.id);
      continue;
    }
    const c = classify(row, mapping);
    // Same change edited: shares a Jira key, or the same section and first cell.
    const predecessor = active.find((a) => !seen.has(a.id) && a.section === row.section &&
      (strings(a.gxJiraKeys).some((k) => row.gxJiraKeys.includes(k)) || (a.firstCell && a.firstCell === row.firstCell.slice(0, 500))));
    const restored = await prisma.gxChange.findUnique({ where: { sprintId_section_rowHash: { sprintId: sprint.id, section: row.section, rowHash: row.rowHash } } });
    if (restored) {
      // A row that came back after being removed.
      seen.add(restored.id);
      await prisma.gxChange.update({ where: { id: restored.id }, data: { removedAt: null, pageVersion } });
      await comment(restored.workItemId, `Release notes updated (v${pageVersion}): this row is back in the release notes.`);
      continue;
    }
    const next = await prisma.gxChange.create({
      data: { sprintId: sprint.id, ...toData(row, c, pageVersion), predecessorId: predecessor?.id ?? null, workItemId: predecessor?.workItemId ?? null, uatTicketKey: predecessor?.uatTicketKey ?? null },
    });
    if (predecessor) {
      seen.add(predecessor.id);
      await prisma.gxChange.update({ where: { id: predecessor.id }, data: { removedAt: now } });
      edited.push({ from: predecessor, to: next });
    } else {
      created.push(next);
    }
  }
  const removed = active.filter((a) => !seen.has(a.id));
  for (const r of removed) {
    await prisma.gxChange.update({ where: { id: r.id }, data: { removedAt: now } });
    await comment(r.workItemId, `Release notes updated (v${pageVersion}): this row is no longer in the release notes. The ticket is not closed automatically; confirm with the GX team whether the change is still in the sprint.`);
  }
  for (const e of edited) {
    const before = (e.from.detail ?? {}) as Record<string, string>;
    const after = (e.to.detail ?? {}) as Record<string, string>;
    const changes = Object.keys({ ...before, ...after }).filter((k) => (before[k] ?? "") !== (after[k] ?? "")).map((k) => `${k}: "${before[k] ?? ""}" → "${after[k] ?? ""}"`);
    await comment(e.from.workItemId, `Release notes updated (v${pageVersion}): ${changes.join("; ") || "row changed"}.`);
  }

  // Tickets for new qualifying items.
  let ticketsCreated = 0;
  const qualifying = created.filter((c) => c.qualifies);
  if (qualifying.length || edited.some((e) => e.to.qualifies && !e.to.workItemId)) {
    const fresh = await prisma.gxSprint.findUniqueOrThrow({ where: { id: sprint.id } });
    const parent = await ensureParent(fresh, cfg);
    for (const change of [...qualifying, ...edited.map((e) => e.to).filter((c) => c.qualifies && !c.workItemId)]) {
      const child = await childTicket(fresh, change, parent, cfg);
      if (child.created) ticketsCreated++;
      ticketsCreated += await followUps(fresh, change, child.ticketKey, cfg);
      if (change.itemType === "risk_engine_change" || change.itemType === "permission_change") {
        // TODO(CONFIRM-COMPLIANCE-ROUTE): Compliance (risk engine) or IT (permissions) FYI via the rule's route.
        await raiseAlert({ ruleCode: "ALR-UAT-05", dedupeKey: change.id, message: `GX Sprint ${fresh.sprint}: ${change.itemType === "risk_engine_change" ? "risk-engine / auto-approval" : "permission"} change: ${change.summary}`, workItemId: child.id });
      }
    }
    if (qualifying.length) {
      await raiseAlert({ ruleCode: "ALR-UAT-01", dedupeKey: `${fresh.sprint}:v${pageVersion}`, message: `GX Sprint ${fresh.sprint}: ${qualifying.length} new change item(s) need UAT (release notes v${pageVersion}).`, workItemId: parent.id });
    }
  }
  if (fullySignedOff && (created.length || edited.length)) {
    const fresh = await prisma.gxSprint.findUniqueOrThrow({ where: { id: sprint.id } });
    await raiseAlert({ ruleCode: "ALR-UAT-04", dedupeKey: `${fresh.sprint}:v${pageVersion}`, message: `GX Sprint ${fresh.sprint}: release notes changed after UAT sign-off (v${pageVersion}: ${created.length} added, ${edited.length} changed).`, workItemId: fresh.parentWorkItemId ?? undefined });
  }
  return { newItems: created.length, updatedItems: edited.length, removedItems: removed.length, ticketsCreated };
}

/** Sprint-labelled GXS tickets raised by Transaction Operations: a "verify fix" item each (spec §16.3). */
export async function verifyFixes(sprint: Pick<GxSprint, "sprint">): Promise<ParsedRow[]> {
  const team = await prisma.employee.findMany({ where: { active: true, team: "TransactionOperations" }, select: { id: true, email: true } });
  const byEmail = new Map(team.map((e) => [e.email.toLowerCase(), e.id]));
  const configs = await prisma.teamConfig.findMany();
  const teamOf = (employeeId: string) => configs.find((c) => c.leadEmployeeId === employeeId || c.deputyEmployeeId === employeeId || strings(c.memberEmployeeIds).includes(employeeId))?.team ?? "All";
  const issues = await sprintLabelledTickets(sprint.sprint);
  const out: ParsedRow[] = [];
  for (const i of issues) {
    const employeeId = byEmail.get(i.fields.reporter?.emailAddress?.toLowerCase() ?? "");
    if (!employeeId) continue;
    const origin = (await prisma.workItem.findFirst({ where: { ticketKey: i.key }, select: { id: true } }))
      ?? (await prisma.ticketLink.findFirst({ where: { key: i.key }, select: { workItemId: true } }).then((l) => (l ? { id: l.workItemId } : null)));
    const cells = { Ticket: i.key, Summary: i.fields.summary ?? "", "Reporter team": teamOf(employeeId), "Originating work item": origin?.id ?? "" };
    const section = "Sprint label (GXS raised by Transaction Operations)";
    out.push({
      section, itemType: "verify_fix", cells, text: `Ticket: ${i.key}; Summary: ${cells.Summary}`,
      summary: `Verify fix ${i.key}: ${cells.Summary}`.slice(0, 200), firstCell: i.key, env: "UAT", gxJiraKeys: [i.key],
      rowHash: rowHashOf(section, { Ticket: i.key, Summary: cells.Summary }),
    });
  }
  return out;
}

export async function upsertSprint(sprint: string, data: Partial<Pick<GxSprint, "releaseNotesUrl" | "releaseNotesPageId" | "uatLandedAt" | "prodPlannedAt">> & { kmncKeys?: string[]; fixVersions?: string[] }) {
  return prisma.gxSprint.upsert({
    where: { sprint },
    update: { ...data },
    create: { sprint, ...data },
  });
}

/** One intake run. `force` re-reads every page even when its version is unchanged. */
export async function runSprintIntake(opts: { now?: Date; force?: boolean } = {}): Promise<IntakeResult> {
  const now = opts.now ?? new Date();
  const cfg = await settings();
  const result: IntakeResult = { sprints: [], newItems: 0, updatedItems: 0, removedItems: 0, ticketsCreated: 0, skipped: [] };

  let kmnc = new Map<string, KmncSprintDates>();
  if (isAtlassianConfigured()) {
    try {
      kmnc = await kmncSprints(cfg["gx.kmncProject"]);
    } catch (error) {
      result.skipped.push(`KMNC not readable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else result.skipped.push("Jira not configured: KMNC dates and sprint-label tickets not read");
  for (const [sprint, dates] of kmnc) {
    await upsertSprint(sprint, { uatLandedAt: dates.uatLandedAt, ...(dates.prodPlannedAt ? { prodPlannedAt: dates.prodPlannedAt } : {}), kmncKeys: dates.keys });
  }

  if (!isConfluenceConfigured()) {
    result.skipped.push("Confluence not configured: release notes not read");
    return result;
  }
  const pages = await releaseNotesPages(cfg["gx.releaseNotesSpace"], cfg["gx.releaseNotesParentPageId"]);
  for (const page of pages) {
    const existing = await prisma.gxSprint.findUnique({ where: { sprint: page.sprint } });
    if (existing && existing.pageVersion === page.version && existing.releaseNotesPageId === page.id && !opts.force) continue;
    const { html, version } = await notesBody(page.id);
    const notes = parseReleaseNotes(html.trim().startsWith("<") ? storageToBlocks(html) : markdownToBlocks(html));
    const sprint = await upsertSprint(page.sprint, {
      releaseNotesUrl: page.url, releaseNotesPageId: page.id, fixVersions: notes.fixVersions,
      ...(!kmnc.get(page.sprint)?.prodPlannedAt && notes.prodPlannedAt ? { prodPlannedAt: notes.prodPlannedAt } : {}),
    });
    if (isAtlassianConfigured()) {
      try {
        notes.rows.push(...(await verifyFixes(sprint)));
      } catch (error) {
        result.skipped.push(`Sprint ${page.sprint} label tickets not readable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const applied = await applyNotes(sprint, notes, version, now);
    await prisma.gxSprint.update({ where: { id: sprint.id }, data: { pageVersion: version, lastParsedAt: now } });
    result.sprints.push(page.sprint);
    result.newItems += applied.newItems;
    result.updatedItems += applied.updatedItems;
    result.removedItems += applied.removedItems;
    result.ticketsCreated += applied.ticketsCreated;
  }
  return result;
}

/**
 * Hourly job gx_sprint_intake: a full intake when the configured schedule
 * (gx.sprint_intake.cron, default daily 07:00 UTC) has fallen due since the
 * last run, or when a KMNC GX Sprint ticket was created or changed.
 */
export async function runScheduledIntake(now = new Date()): Promise<IntakeResult & { ran: boolean; trigger: string }> {
  const { getNextCronRun } = await import("@/lib/background-jobs");
  const { getSetting } = await import("@/modules/settings/settings");
  const cron = await getSetting("gx.sprint_intake.cron");
  const last = await prisma.syncCursor.findUnique({ where: { source: "gx.intake.lastRun" } });
  const lastRun = last ? new Date(last.cursor) : null;
  let trigger = !lastRun || getNextCronRun(cron, lastRun) <= now ? "schedule" : "";

  if (!trigger && isAtlassianConfigured()) {
    try {
      const kmnc = await kmncSprints(await getSetting("gx.kmncProject"));
      const latest = [...kmnc.values()].map((s) => s.lastUpdated ?? "").sort().pop() ?? "";
      const seen = await prisma.syncCursor.findUnique({ where: { source: "gx.kmnc.updated" } });
      if (latest && latest !== seen?.cursor) {
        trigger = "kmnc";
        await prisma.syncCursor.upsert({ where: { source: "gx.kmnc.updated" }, update: { cursor: latest }, create: { source: "gx.kmnc.updated", cursor: latest } });
      }
    } catch (error) {
      logger.warn("KMNC check failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!trigger) return { ran: false, trigger: "none", sprints: [], newItems: 0, updatedItems: 0, removedItems: 0, ticketsCreated: 0, skipped: [] };
  const result = await runSprintIntake({ now });
  await prisma.syncCursor.upsert({ where: { source: "gx.intake.lastRun" }, update: { cursor: now.toISOString() }, create: { source: "gx.intake.lastRun", cursor: now.toISOString() } });
  return { ...result, ran: true, trigger };
}

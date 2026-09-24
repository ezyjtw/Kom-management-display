/**
 * GX sprint sources, read-only (spec §16.1): KMNC change tickets (UAT landing
 * and planned PROD date), release-notes pages in Confluence, and GXS tickets
 * labelled with the sprint.
 */

import { searchIssues, type JiraIssue } from "@/lib/integrations/atlassian/client";
import { getPage, pageUrl, searchPages } from "@/lib/integrations/confluence/client";
import { parseDate, sprintFromTitle } from "@/modules/gx-sprints/parse";

export interface KmncSprintDates {
  sprint: string;
  keys: string[];
  uatLandedAt: Date | null;
  uatTicketCreatedAt: Date | null;
  prodPlannedAt: Date | null;
  lastUpdated: string | null;
}

const KMNC_SUMMARY = /GX Sprint\s+(\d+\.\d+)\s+(Upgrade in UAT|Release in UAT|Release in PROD)/i;
const KMNC_FIELDS = ["summary", "status", "created", "updated", "duedate", "resolutiondate"];

/**
 * KMNC tickets named like "GX Sprint 6.19 Upgrade in UAT" / "Release in UAT" and
 * "GX Sprint 6.19 Release in PROD (…)". TODO(CONFIRM-KMNC-NAMING): UAT has landed
 * when the UAT ticket is resolved; the PROD date is a date in the PROD ticket's
 * summary, else its due date.
 */
export async function kmncSprints(project: string): Promise<Map<string, KmncSprintDates>> {
  const issues = await searchIssues(`project = "${project}" AND summary ~ "GX Sprint" ORDER BY updated DESC`, 10, KMNC_FIELDS);
  const out = new Map<string, KmncSprintDates>();
  for (const i of issues) {
    const m = KMNC_SUMMARY.exec(i.fields.summary ?? "");
    if (!m) continue;
    const s = out.get(m[1]) ?? { sprint: m[1], keys: [], uatLandedAt: null, uatTicketCreatedAt: null, prodPlannedAt: null, lastUpdated: null };
    s.keys.push(i.key);
    if (i.fields.updated && (!s.lastUpdated || i.fields.updated > s.lastUpdated)) s.lastUpdated = i.fields.updated;
    if (/uat/i.test(m[2])) {
      if (i.fields.resolutiondate) s.uatLandedAt = new Date(i.fields.resolutiondate);
      if (i.fields.created) s.uatTicketCreatedAt = new Date(i.fields.created);
    } else {
      const inSummary = /\(([^)]*)\)/.exec(i.fields.summary ?? "")?.[1];
      s.prodPlannedAt = (inSummary ? parseDate(inSummary) : null) ?? (i.fields.duedate ? new Date(`${i.fields.duedate}T00:00:00Z`) : null) ?? s.prodPlannedAt;
    }
    out.set(m[1], s);
  }
  return out;
}

export interface NotesPage {
  sprint: string;
  id: string;
  title: string;
  version: number;
  url: string;
}

/** Release-notes pages "[GX-Orchestrate] Sprint <X.YY> Release Notes" (the template itself is skipped). */
export async function releaseNotesPages(space: string, parentPageId: string): Promise<NotesPage[]> {
  const cql = [`space = "${space}"`, "type = page", 'title ~ "Release Notes"', ...(parentPageId ? [`ancestor = ${parentPageId}`] : [])].join(" AND ");
  const pages = await searchPages(cql, 100);
  return pages
    .map((p) => ({ sprint: sprintFromTitle(p.title), id: p.id, title: p.title, version: p.version?.number ?? 0, url: pageUrl(p._links?.webui) }))
    .filter((p): p is NotesPage => !!p.sprint && /GX-Orchestrate/i.test(p.title));
}

export async function notesBody(pageId: string): Promise<{ html: string; version: number }> {
  const page = await getPage(pageId);
  return { html: page.body?.storage?.value ?? "", version: page.version?.number ?? 0 };
}

/** GXS service tickets labelled Sprint_<X.YY>, with their reporter. */
export async function sprintLabelledTickets(sprint: string): Promise<JiraIssue[]> {
  return searchIssues(`project = GXS AND labels = "Sprint_${sprint}"`, 5, ["summary", "status", "reporter", "labels"]);
}

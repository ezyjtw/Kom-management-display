/**
 * Markdown report for the Jira inventory (spec §15). Proposals are written
 * for humans to action; nothing here changes Jira.
 */

import { z } from "zod";
import type { Inventory, ProjectInventory } from "@/modules/jira-inventory/collect";

/** Issue types proposed for consolidation. TODO(CONFIRM-JIRA-CONSOLIDATION): the list comes from the Jira rationalisation work. */
export const consolidationSchema = z.object({
  issueTypes: z.array(z.object({
    project: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
    issueType: z.string().min(1),
    mergeInto: z.string().optional(),
    note: z.string().optional(),
  })).default([]),
});
export type Consolidation = z.infer<typeof consolidationSchema>;

const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const RETIRE_AFTER_DAYS = 180;

function affected(consolidation: Consolidation, filter: { projects: string[]; issueTypes: string[] }) {
  return consolidation.issueTypes.filter((c) =>
    filter.issueTypes.includes(c.issueType.toLowerCase()) && (!c.project || filter.projects.length === 0 || filter.projects.includes(c.project)));
}

function unreadable(r: { ok: boolean; note?: string }) {
  return r.ok ? "" : ` _(${r.note ?? "not readable"})_`;
}

function projectSection(p: ProjectInventory): string[] {
  const out = [`### ${p.key}${p.name ? ` — ${cell(p.name)}` : ""}`, ""];
  if (!p.found) return [...out, `Project not readable: ${p.boards.note ?? "unknown"}.`, ""];
  out.push(`**Boards**${unreadable(p.boards)}: ${p.boards.value.length ? p.boards.value.map((b) => `${cell(b.name)} (${b.type})`).join("; ") : "none"}`, "");
  out.push(`**Workflows (names only)**${unreadable(p.workflows)}:`);
  for (const w of p.workflows.value) {
    out.push(`- Scheme "${cell(w.scheme)}", default workflow ${w.defaultWorkflow ? `"${cell(w.defaultWorkflow)}"` : "—"}`);
    for (const [type, wf] of Object.entries(w.byIssueType)) out.push(`  - ${cell(type)}: "${cell(wf)}"`);
  }
  if (!p.workflows.value.length) out.push("- none read");
  out.push("", `**Automation rules**: ${p.automation.note ?? "—"}`, "");
  const counts = p.openCounts.value;
  out.push(`**Open issues by type and status**${unreadable(p.openCounts)}: ${counts.total}${counts.truncated ? " (truncated: more pages than the limit)" : ""}`, "");
  out.push("| Issue type | Subtask | Open | By status |", "|---|---|---|---|");
  const types = new Set([...p.issueTypes.value.map((t) => t.name), ...Object.keys(counts.byTypeAndStatus)]);
  for (const name of [...types].sort()) {
    const byStatus = counts.byTypeAndStatus[name] ?? {};
    const open = Object.values(byStatus).reduce((s, n) => s + n, 0);
    const subtask = p.issueTypes.value.find((t) => t.name === name)?.subtask ? "yes" : "";
    out.push(`| ${cell(name)} | ${subtask} | ${open} | ${Object.entries(byStatus).sort().map(([s, n]) => `${cell(s)}: ${n}`).join(", ") || "—"} |`);
  }
  out.push("");
  return out;
}

export function renderInventory(inv: Inventory, consolidation: Consolidation, now = new Date(inv.generatedAt)): string {
  const lines: string[] = [
    "# Jira inventory (Phase 1, spec §15)",
    "",
    `Generated ${inv.generatedAt} by \`scripts/jira-inventory.ts\` (read-only). **Do not change any Jira configuration from this report.** Proposals below are for humans to review and action.`,
    "",
    "> Review this file for client names in filter or board names before committing it.",
    "",
    "## Summary",
    "",
    "| Project | Name | Boards | Issue types | Open issues | Last issue created |",
    "|---|---|---|---|---|---|",
  ];
  for (const p of inv.projects) {
    lines.push(`| ${p.key} | ${p.found ? cell(p.name) : "_not readable_"} | ${p.boards.ok ? p.boards.value.length : "?"} | ${p.issueTypes.value.length} | ${p.openCounts.ok ? `${p.openCounts.value.total}${p.openCounts.value.truncated ? "+" : ""}` : "?"} | ${p.lastCreated.value?.slice(0, 10) ?? "—"} |`);
  }
  lines.push("", "## Projects", "");
  for (const p of inv.projects) lines.push(...projectSection(p));

  lines.push("## Filters owned by Transaction Operations users", "");
  lines.push(`Team members: ${inv.teamUsers.requested} requested, ${inv.teamUsers.resolved} matched to a Jira account${inv.teamUsers.unresolved ? `, ${inv.teamUsers.unresolved} not matched` : ""}.${unreadable(inv.filters)}`, "");
  if (inv.filters.value.length) {
    lines.push("| Filter | Owner | Projects | Issue types | Consolidation risk |", "|---|---|---|---|---|");
    for (const f of inv.filters.value) {
      const hits = affected(consolidation, f);
      lines.push(`| ${cell(f.name)} (${f.id}) | ${cell(f.owner)} | ${f.projects.join(", ") || "any"} | ${f.issueTypes.join(", ") || "any"} | ${hits.length ? `**yes**: ${hits.map((h) => cell(h.issueType)).join(", ")}` : ""} |`);
    }
  } else {
    lines.push("No filters found.");
  }

  const riskyFilters = inv.filters.value.filter((f) => affected(consolidation, f).length);
  const riskyIds = new Set(riskyFilters.map((f) => f.id));
  const riskyDashboards = inv.dashboards.value.filter((d) => d.filterIds.some((id) => riskyIds.has(id)));
  lines.push("", "## Saved-filter breakage risk (issue types proposed for consolidation)", "");
  if (!consolidation.issueTypes.length) {
    lines.push("No issue types are proposed for consolidation yet (`docs/phase1/jira-consolidation.json`, TODO(CONFIRM-JIRA-CONSOLIDATION)). Re-run once the list is agreed.");
  } else {
    lines.push("Proposed: " + consolidation.issueTypes.map((c) => `${c.project ? `${c.project}/` : ""}${cell(c.issueType)}${c.mergeInto ? ` → ${cell(c.mergeInto)}` : ""}`).join("; "), "");
    lines.push(`Filters at risk: ${riskyFilters.length ? riskyFilters.map((f) => `${cell(f.name)} (${f.id})`).join("; ") : "none"}.`);
    lines.push(`Dashboards using those filters${unreadable(inv.dashboards)}: ${riskyDashboards.length ? riskyDashboards.map((d) => `${cell(d.name)} (${d.id})`).join("; ") : "none"}.`);
    lines.push("", "Update these filters and dashboards before the issue types are merged (the saved-filter breakage seen in the Atlassian Uplift UAT).");
  }

  lines.push("", "## Proposals for review (not actioned)", "");
  const proposals: string[] = [];
  for (const p of inv.projects) {
    if (!p.found) {
      proposals.push(`${p.key}: not readable with the inventory account — confirm the project exists and who owns it.`);
      continue;
    }
    const last = p.lastCreated.value ? new Date(p.lastCreated.value) : null;
    const idleDays = last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null;
    if (p.openCounts.ok && p.openCounts.value.total === 0 && (idleDays === null || idleDays > RETIRE_AFTER_DAYS)) {
      proposals.push(`${p.key}: no open issues and ${idleDays === null ? "no issues" : `no new issue for ${idleDays} days`} — candidate to retire or archive.`);
    }
    const unused = p.issueTypes.value.filter((t) => !p.openCounts.value.byTypeAndStatus[t.name]).map((t) => t.name);
    if (p.openCounts.ok && unused.length && unused.length < p.issueTypes.value.length) {
      proposals.push(`${p.key}: issue types with no open issues (${unused.map(cell).join(", ")}) — review whether they can be consolidated (open issues only; check closed history first).`);
    }
  }
  lines.push(...(proposals.length ? proposals.map((p) => `- ${p}`) : ["- None from the data read."]));
  lines.push("");
  return lines.join("\n");
}

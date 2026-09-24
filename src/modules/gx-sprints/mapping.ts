/**
 * Which change items need UAT, and what they affect (spec §16.2, §16.3).
 * Qualification follows the section rules; the impact mapping comes from
 * GxImpactRule rows (config, not code).
 */

import type { GxImpactRule } from "@prisma/client";
import type { ItemType, ParsedRow } from "@/modules/gx-sprints/parse";

export interface Classification {
  qualifies: boolean;
  tags: string[];
  team: string;
  priority: string;
  taskCodes: string[];
  alertCodes: string[];
  controls: string[];
  uatTemplate: string | null;
  matchedRules: string[];
  reason: string;
}

export interface MappingConfig {
  rules: Array<Pick<GxImpactRule, "id" | "name" | "matchOn" | "pattern" | "taskCodes" | "alertCodes" | "controls" | "team" | "uatTemplate" | "priority">>;
  operationalKeywords: string[];
  dataImpactPatterns: string[];
  includeWalletTech: boolean;
}

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const WALLET_TECH = /wallet\s*tech|new wallet technolog/i;

function regex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function workstreamOf(row: ParsedRow): string {
  return Object.entries(row.cells).find(([h]) => /workstream/i.test(h))?.[1] ?? "";
}

function ruleMatches(rule: MappingConfig["rules"][number], row: ParsedRow): boolean {
  const re = regex(rule.pattern);
  if (!re) return false;
  switch (rule.matchOn) {
    case "section": return re.test(row.section);
    case "workstream": return !!workstreamOf(row) && re.test(workstreamOf(row));
    case "keyword": return re.test(row.text);
    case "jira_project": return row.gxJiraKeys.some((k) => re.test(k.split("-")[0]));
    default: return false;
  }
}

/** Section rules (spec §16.2 table): does this row create a UAT ticket? */
function qualifiesBySection(type: ItemType, row: ParsedRow, cfg: MappingConfig, mappedByWorkstream: boolean): { yes: boolean; tags: string[]; reason: string } {
  switch (type) {
    case "function_toggle":
      return { yes: true, tags: ["disabled-in-prod"], reason: "Function released but disabled or recently enabled in PROD: every row" };
    case "ui_change": {
      const ui = Object.entries(row.cells).find(([h]) => /ops ui|client ui|^ui/i.test(h))?.[1] ?? "";
      return /client/i.test(ui)
        ? { yes: true, tags: ["client-awareness"], reason: "Client UI change: client-facing awareness ticket" }
        : { yes: true, tags: [], reason: "Ops UI change: every row" };
    }
    case "api_change":
    case "permission_change":
    case "staking_change":
    case "risk_engine_change":
      return { yes: true, tags: [], reason: "Every row in this section" };
    case "technical_change": {
      const impacted = Object.entries(row.cells).find(([h]) => /impacted functions/i.test(h))?.[1] ?? "";
      const hit = cfg.operationalKeywords.find((k) => impacted.toLowerCase().includes(k.toLowerCase()));
      return { yes: !!hit, tags: [], reason: hit ? `Impacted functions mention "${hit}"` : "Impacted functions are not operational" };
    }
    case "highlight": {
      const remarks = Object.entries(row.cells).find(([h]) => /remarks for ops/i.test(h))?.[1] ?? "";
      if (remarks.trim()) return { yes: true, tags: [], reason: "Remarks for Ops present" };
      return { yes: mappedByWorkstream, tags: [], reason: mappedByWorkstream ? "Workstream maps to a Transaction Operations task" : "No Ops remarks and no mapped workstream" };
    }
    case "verify_fix":
      return { yes: true, tags: [], reason: "GXS ticket raised by Transaction Operations in the sprint label: verify the fix" };
    case "deployment_note": {
      const hit = cfg.dataImpactPatterns.map(regex).find((re) => re?.test(row.text));
      return { yes: !!hit, tags: [], reason: hit ? "Deployment note matches a data-impact pattern" : "No data impact" };
    }
  }
}

export function classify(row: ParsedRow, cfg: MappingConfig): Classification {
  const matched = cfg.rules.filter((r) => ruleMatches(r, row));
  const section = qualifiesBySection(row.itemType, row, cfg, matched.some((r) => r.matchOn === "workstream"));
  const tags = [...section.tags];
  let qualifies = section.yes;
  let reason = section.reason;

  // H6: new wallet technology is scoped, not operational.
  if (WALLET_TECH.test(row.text)) {
    tags.push("scoped_not_operational");
    if (!cfg.includeWalletTech) {
      qualifies = false;
      reason = "New wallet technology: scoped, not operational (enable gx.uat.include_wallet_tech to test)";
    }
  }

  let priority = row.itemType === "risk_engine_change" ? "P1" : "P2";
  for (const r of matched) if ((PRIORITY_RANK[r.priority] ?? 9) < (PRIORITY_RANK[priority] ?? 9)) priority = r.priority;
  if (tags.includes("client-awareness") && !matched.length) priority = "P3";

  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    qualifies,
    tags: uniq(tags),
    team: row.itemType === "verify_fix" ? row.cells["Reporter team"] || "All" : matched.find((r) => r.team)?.team ?? "All",
    priority,
    taskCodes: uniq(matched.flatMap((r) => strings(r.taskCodes))),
    alertCodes: uniq(matched.flatMap((r) => strings(r.alertCodes))),
    controls: uniq(matched.flatMap((r) => strings(r.controls))),
    uatTemplate: row.itemType === "verify_fix" ? "UAT-VERIFY-FIX" : matched.find((r) => r.uatTemplate)?.uatTemplate ?? "UAT-GENERAL",
    matchedRules: matched.map((r) => r.name),
    reason,
  };
}

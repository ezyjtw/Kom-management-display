/**
 * Spec §12 STOP 7: print the daily-work coverage matrix from the database as
 * a Markdown table. Syncs definitions first (insert-only).
 *   DATABASE_URL=... npx tsx scripts/coverage-matrix.ts > coverage-matrix.md
 */
import { prisma } from "@/lib/prisma";
import { syncDailyCheckDefinitions } from "@/modules/daily-checks/schedule";
import { DEFINITION_BY_CODE, CONFLUENCE_PLACEHOLDER_PREFIX } from "@/modules/daily-checks/definitions";

async function main() {
  await syncDailyCheckDefinitions();
  const defs = await prisma.dailyCheckDefinition.findMany({ orderBy: [{ team: "asc" }, { code: "asc" }] });
  const rules = new Map((await prisma.alertRule.findMany({ where: { code: "ALR-CHK-01" } })).map((r) => [r.code, r.enabled]));
  const cell = (v: string) => v.replace(/\|/g, "\\|");
  const lines = [
    "| Code | Name | Team | Kind | Frequency | Due (UK) | Evidence (required fields) | Ticket project | Data pull | Confluence | Flag / access |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const d of defs) {
    const spec = (d.evidenceSpec ?? {}) as { requiredFields?: string[] };
    const confluence = d.confluenceUrl.startsWith(CONFLUENCE_PLACEHOLDER_PREFIX) ? "CONFIRM (title: " + (DEFINITION_BY_CODE[d.code]?.confluenceTitle ?? "?") + ")" : d.confluenceUrl;
    lines.push(`| ${[
      d.code, d.name, d.team, d.kind, d.frequency, d.dueByLocal,
      ["recordCount", "dataAsOf", "source", ...(spec.requiredFields ?? [])].join(", "),
      d.ticketProject,
      DEFINITION_BY_CODE[d.code]?.collector ? "automated" : "manual",
      confluence,
      [d.requiredFlag ?? "", d.restricted ? "kps:view" : ""].filter(Boolean).join(", ") || "-",
    ].map((v) => cell(String(v))).join(" | ")} |`);
  }
  console.log(`# Daily work coverage (${defs.length} definitions)\n`);
  console.log(lines.join("\n"));
  console.log(`\nDue-time alert ALR-CHK-01 enabled: ${rules.get("ALR-CHK-01") ? "yes" : "no (ships disabled)"}.`);
  console.log("Numbering gap: CHK-14 and CHK-18..20 not found in TOP (CONFIRM-CHECK-GAPS).");
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

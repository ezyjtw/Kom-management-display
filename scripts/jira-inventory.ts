/**
 * Spec §15 (Phase 10): read-only Jira inventory for the Jira rationalisation.
 * Lists, for each project in §8.3: boards, filters owned by Transaction
 * Operations users, issue types, workflows (names only), open issue counts
 * by type and status, and automation rules if readable. Flags filters and
 * dashboards that reference issue types proposed for consolidation.
 *
 * It NEVER changes Jira: all calls go through the inventory client's GET
 * allowlist (plus the read-only JQL search).
 *
 *   ATLASSIAN_BASE_URL=... ATLASSIAN_EMAIL=... ATLASSIAN_API_TOKEN=... \
 *   [DATABASE_URL=...] npx tsx scripts/jira-inventory.ts \
 *     [--projects OTC,OPS] [--users a@x.com,b@x.com] \
 *     [--consolidation docs/phase1/jira-consolidation.json] [--out docs/phase1/jira-inventory.md]
 *
 * Projects default to the JiraProjectConfig keys (when DATABASE_URL is set)
 * plus the §8.3 list; users default to active Transaction Operations employees.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { collectInventory } from "@/modules/jira-inventory/collect";
import { consolidationSchema, renderInventory } from "@/modules/jira-inventory/report";

const SPEC_PROJECTS = ["OTC", "OPS", "VND", "PDEF", "INC", "RLS", "TOKENS", "FIN", "AO", "EXT", "CHG", "PDEV", "PREL"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

async function fromDatabase(): Promise<{ projects: string[]; emails: string[] }> {
  if (!process.env.DATABASE_URL) return { projects: [], emails: [] };
  const { prisma } = await import("@/lib/prisma");
  try {
    const [configs, employees] = await Promise.all([
      prisma.jiraProjectConfig.findMany({ select: { key: true } }),
      prisma.employee.findMany({ where: { active: true, team: "TransactionOperations" }, select: { email: true } }),
    ]);
    return { projects: configs.map((c) => c.key), emails: employees.map((e) => e.email) };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!process.env.ATLASSIAN_BASE_URL || !process.env.ATLASSIAN_EMAIL || !process.env.ATLASSIAN_API_TOKEN) {
    throw new Error("Set ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (a read-only account). Nothing was written.");
  }
  const db = await fromDatabase();
  const projects = list(arg("projects")) ?? [...new Set([...SPEC_PROJECTS, ...db.projects])];
  const teamEmails = list(arg("users")) ?? db.emails;
  const consolidationPath = arg("consolidation") ?? "docs/phase1/jira-consolidation.json";
  const out = arg("out") ?? "docs/phase1/jira-inventory.md";
  const consolidation = consolidationSchema.parse(JSON.parse(readFileSync(consolidationPath, "utf8")));

  console.error(`Jira inventory (read-only): ${projects.length} projects, ${teamEmails.length} team users.`);
  const inventory = await collectInventory({ projects, teamEmails });
  if (!inventory.projects.some((p) => p.found)) {
    // Do not overwrite a previous inventory with an empty one (wrong site, token or permissions).
    const notes = [...new Set(inventory.projects.map((p) => p.boards.note).filter(Boolean))].join("; ");
    throw new Error(`No project could be read (${notes || "unknown reason"}). Nothing was written.`);
  }
  writeFileSync(out, renderInventory(inventory, consolidation));
  console.error(`Wrote ${out}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

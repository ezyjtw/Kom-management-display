/**
 * Phase 2 data model (spec §7): schema rules and migrations.
 * Migrations were also run against PostgreSQL 16 during development; these
 * tests pin the properties that matter so later edits cannot regress them.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const SCHEMA = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const MIG = path.join(ROOT, "prisma/migrations");
const readMig = (name: string) => fs.readFileSync(path.join(MIG, name, "migration.sql"), "utf8");

const PHASE2_MODELS = [
  "Client", "ClientChannel", "WorkItem", "SlaPolicy", "SlaEvent", "AlertRule",
  "SourceHeartbeat", "DailyCheckDefinition", "TimeLog", "TicketLink", "IncidentLogDraft",
];

function modelBody(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1];
}

/** Columns covered as the leading column of an index, unique or id. */
function leadingIndexed(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/@@(?:index|unique|id)\(\[\s*(\w+)/g)) out.add(m[1]);
  for (const m of body.matchAll(/^\s*(\w+)\s+\S+.*@(id|unique)\b/gm)) out.add(m[1]);
  return out;
}

describe("schema rules (spec §7 preamble)", () => {
  it.each(PHASE2_MODELS)("%s has createdAt and updatedAt", (name) => {
    const body = modelBody(name);
    expect(body).toMatch(/\bcreatedAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(body).toMatch(/\bupdatedAt\s+DateTime\s+@updatedAt/);
  });

  it.each([...PHASE2_MODELS, "Alert", "DailyCheckItem"])("%s indexes every foreign key and status field", (name) => {
    const body = modelBody(name);
    const indexed = leadingIndexed(body);
    const fks = [...body.matchAll(/@relation\([^)]*fields:\s*\[(\w+)\]/g)].map((m) => m[1]);
    const statusFields = ["state", "status", "isActive", "enabled"].filter((f) => new RegExp(`^\\s*${f}\\s`, "m").test(body));
    const missing = [...fks, ...statusFields].filter((f) => !indexed.has(f));
    expect(missing).toEqual([]);
  });

  it("WorkItem is unique per source record", () => {
    expect(modelBody("WorkItem")).toMatch(/@@unique\(\[sourceSystem, sourceId\]\)/);
  });

  it("TimeLog.loggedById is documented as never reported (H4)", () => {
    expect(SCHEMA).toContain("NEVER exposed in reports (H4)");
  });

  it("uses cuid ids for new models with generated ids", () => {
    for (const name of PHASE2_MODELS) {
      const idLine = modelBody(name).match(/^\s*(\w+)\s+String\s+@id[^\n]*/m)?.[0] ?? "";
      if (/@default/.test(idLine)) expect(idLine, name).toContain("@default(cuid())");
    }
  });
});

describe("migrations", () => {
  const names = fs.readdirSync(MIG).filter((d) => /^\d{4}_/.test(d)).sort();
  const baseline = () => readMig("0001_baseline");

  it("start from one baseline and are numbered consecutively", () => {
    expect(names[0]).toBe("0001_baseline");
    names.forEach((n, i) => expect(n.slice(0, 4)).toBe(String(i + 1).padStart(4, "0")));
  });

  it("the baseline runs in one transaction, so a failed run leaves nothing behind", () => {
    const sql = baseline().replace(/--[^\n]*\n/g, "").trim();
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.endsWith("COMMIT;")).toBe(true);
  });

  it("the baseline creates an inactive system actor for 'system' audit writes", () => {
    expect(baseline()).toMatch(/INSERT INTO "Employee" \([^)]*\) VALUES \('system', 'System', '[^']*', '\w+', '\w+', '\w+', false/);
  });

  it("allows only one open alert per (ruleCode, dedupeKey)", () => {
    expect(baseline()).toMatch(/CREATE UNIQUE INDEX "Alert_open_ruleCode_dedupeKey_key" ON "Alert" USING btree \("ruleCode", "dedupeKey"\) WHERE \(status <> 'resolved'::"AlertStatus"\)/);
  });

  it("makes daily check items unique per (definition, period)", () => {
    expect(baseline()).toMatch(/UNIQUE INDEX[^;]*"DailyCheckItem"\("definitionCode", "periodKey"\)/);
    expect(baseline()).not.toContain("DailyCheckRun_date_key");
  });

  it("seeds SLA policies with only the known targets set (CONFIRM-SLA-TARGETS)", () => {
    const rows = [...baseline().matchAll(/\('slapol_\w+', '([A-Z0-9-]+)', '[^']*', (NULL|\d+), (NULL|\d+), (NULL|\d+), (NULL|'[^']*'), '([^']+)'/g)]
      .map(([, code, own, first, resolve, rule, cal]) => ({ code, own, first, resolve, rule, cal }));
    expect(rows.map((r) => r.code)).toEqual([
      "CLIENT-Q-P0", "CLIENT-Q-P1", "CLIENT-Q-P2", "CLIENT-Q-P3", "OES-FAIL", "BANK-ACK", "MTD-BREAK", "CLIENT-INCIDENT-UPDATE",
    ]);
    const set = rows.filter((r) => [r.own, r.first, r.resolve, r.rule].some((v) => v !== "NULL"));
    expect(set).toEqual([
      { code: "OES-FAIL", own: "NULL", first: "120", resolve: "NULL", rule: "NULL", cal: "24x7" },
      { code: "MTD-BREAK", own: "NULL", first: "NULL", resolve: "NULL", rule: "'next_business_day_eod'", cal: "business_uk" },
    ]);
  });

  it("seeds every alert rule and integration disabled", () => {
    const sql = baseline();
    const alertRules = [...sql.matchAll(/INSERT INTO "AlertRule" \([^)]*\) VALUES \('([^']+)', (true|false)/g)];
    expect(alertRules.length).toBeGreaterThan(0);
    expect(alertRules.filter(([, , enabled]) => enabled !== "false").map(([, code]) => code)).toEqual([]);
    const projects = [...sql.matchAll(/INSERT INTO "JiraProjectConfig" \([^)]*\) VALUES \('([^']+)', '[^']*', '[^']*', '\w+', (true|false)/g)];
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.filter(([, , enabled]) => enabled !== "false").map(([, key]) => key)).toEqual([]);
  });
});

describe("seed data", () => {
  it("seeds no real client data (spec §7.1)", () => {
    const seed = fs.readFileSync(path.join(ROOT, "prisma/seed.ts"), "utf8");
    expect(seed).not.toMatch(/prisma\.client(Channel)?\.(create|createMany|upsert)/);
  });
});

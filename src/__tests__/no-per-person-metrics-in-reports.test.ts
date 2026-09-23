/**
 * no-per-person-metrics-in-reports (spec §13.1, H4): no metric, report,
 * export or API response breaks results down by individual. Seeds data that
 * is full of employee and user ids and names (owners, time loggers, reporters,
 * operators, closers) and scans every metrics section, the monthly export
 * (CSV and PDF report) and every report type for any of them.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
const auth = vi.hoisted(() => ({ id: "u-lead-9q", name: "Lena Leadperson", email: "lena@k.com", role: "lead", employeeId: "emp-lena-9q", team: "Team 2" }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth), requireRole: vi.fn(async () => auth) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { read: {}, expensive: {}, mutation: {} } }));

import { GET as sectionGet } from "@/app/api/metrics/[section]/route";
import { GET as exportGet } from "@/app/api/metrics/export/route";
import { GET as reportsGet } from "@/app/api/reports/route";
import { GET as legacyExportGet } from "@/app/api/export/route";

const PEOPLE = [
  { employeeId: "emp-alice-7f3", userId: "u-alice-7f3", name: "Alice Wonderperson", email: "alice@k.com" },
  { employeeId: "emp-bob-2k8", userId: "u-bob-2k8", name: "Bob Buildersson", email: "bob@k.com" },
  { employeeId: auth.employeeId, userId: auth.id, name: auth.name, email: auth.email },
];
const FORBIDDEN = PEOPLE.flatMap((p) => [p.employeeId, p.userId, p.name, p.email]);

// Mid-month, so data seeded "minutes ago" always falls in the reported month.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
const now = new Date();
const ago = (mins: number) => new Date(now.getTime() - mins * 60_000);
const add = (m: string, data: Record<string, unknown>) => db.client[m].create({ data });

beforeAll(async () => {
  for (const p of PEOPLE) {
    await add("employee", { id: p.employeeId, name: p.name, email: p.email, role: "Analyst", team: "TransactionOperations", active: true });
    await add("user", { id: p.userId, email: p.email, name: p.name, role: "employee", employeeId: p.employeeId });
  }
  await add("client", { id: "cl-1", displayName: "Acme Capital", isActive: true, komainuOrgId: "org-1", komainuAccountNos: ["acc-1"] });
  await add("slaPolicy", { id: "sla-1", code: "CLIENT-Q-P2", description: "", ownershipMins: 30, firstRespMins: 60, resolveMins: 480, calendar: "24x7", warnAtPct: 50, isActive: true });
  for (const [i, p] of PEOPLE.entries()) {
    const id = `wi-${i}`;
    await add("workItem", {
      id, kind: "client_request", title: "Where is my withdrawal?", team: "Team 2", taskCode: "CLIENT-Q", sourceSystem: "slack", sourceId: `s-${i}`,
      clientId: "cl-1", slaPolicyId: "sla-1", ownerEmployeeId: p.employeeId, state: "closed",
      clockStartedAt: ago(600), ownedAt: ago(590), firstResponseAt: ago(570), resolvedAt: ago(100),
      metadata: i === 1 ? { closure: { nonActionable: true, byUserId: p.userId } } : { authorRef: p.email },
    });
    await add("timeLog", { workItemId: id, clientId: "cl-1", bucketMins: 30, loggedById: p.employeeId, loggedAt: ago(100) });
    await add("slaEvent", { workItemId: id, kind: "ownership_breach", at: ago(500) });
    await add("alert", { type: "ALR-TX-01", ruleCode: "ALR-TX-01", dedupeKey: `d-${i}`, message: "Transaction failed", severity: "high", employeeId: p.employeeId, workItemId: id, firstFiredAt: ago(300), acknowledgedAt: ago(290), resolvedAt: ago(10), autoResolvedAt: ago(10) });
    await add("dailyCheckItem", { runId: "r", name: "Stuck Transactions", category: "CHK-01", definitionCode: "CHK-01", periodKey: new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10), status: "pass", operatorId: p.employeeId, completedAt: ago(60), skipRequestedBy: p.userId });
  }
  await add("workItem", { id: "wi-open", kind: "mtd_break", title: "Break", team: "Team 2", taskCode: "CHK-02", sourceSystem: "daily_check", sourceId: "x", ownerEmployeeId: "emp-alice-7f3", clockStartedAt: ago(3000) });
  await add("dailyCheckDefinition", { code: "CHK-01", name: "Stuck Transactions", team: "Team 1", frequency: "daily", dueByLocal: "09:05", evidenceSpec: {}, ticketProject: "TOPS", confluenceUrl: "x", isActive: true });
  await add("sourceRecord", { source: "komainu_api", kind: "transaction", externalId: "tx-1", status: "FAILED", occurredAt: ago(200), fields: { organization: "org-1", account: "acc-1" } });
  await add("sourceRecord", { source: "kommand", kind: "unticketed_report", externalId: now.toISOString().slice(0, 10), occurredAt: ago(30), fields: { total: 2, alertsWithoutTicket: [{ workItemId: "wi-0" }] } });
  await add("sourceHeartbeat", { source: "atlassian.issues", expectedEveryMins: 2, lastSuccessAt: ago(1), lastCount: 0 });
  await add("incident", { id: "inc-1", title: "Signing degraded", provider: "Fireblocks", severity: "high", status: "active", reportedById: "emp-alice-7f3", resolvedById: "emp-bob-2k8", startedAt: ago(100), rcaStatus: "none" });
  await add("incidentUpdate", { incidentId: "inc-1", authorId: "emp-bob-2k8", content: "Vendor investigating", type: "update", createdAt: ago(50) });
});

async function bodyOf(res: Response): Promise<string> {
  return res.text();
}

function assertNoPeople(label: string, text: string) {
  const found = FORBIDDEN.filter((f) => text.includes(f));
  expect(found, `${label} exposes ${found.join(", ")}`).toEqual([]);
}

const month = now.toISOString().slice(0, 7);
const req = (url: string) => new NextRequest(`http://localhost${url}`);

describe("no-per-person-metrics-in-reports", () => {
  it.each(["responsiveness", "clients", "operations", "hygiene"])("metrics section %s", async (section) => {
    const res = await sectionGet(req(`/api/metrics/${section}?month=${month}`), { params: Promise.resolve({ section }) });
    expect(res.status).toBe(200);
    const text = await bodyOf(res);
    expect(text.length).toBeGreaterThan(100);
    assertNoPeople(section, text);
  });

  it("the data actually reaches the sections (so the scan is meaningful)", async () => {
    const r = await (await sectionGet(req(`/api/metrics/responsiveness?month=${month}`), { params: Promise.resolve({ section: "responsiveness" }) })).json();
    expect(r.data.overall.items).toBeGreaterThanOrEqual(3);
    const c = await (await sectionGet(req(`/api/metrics/clients?month=${month}`), { params: Promise.resolve({ section: "clients" }) })).json();
    expect(c.data.byEffort[0]).toMatchObject({ client: "Acme Capital", loggedEffortHours: 1.5 });
  });

  it.each(["csv", "pdf"])("monthly export (%s)", async (format) => {
    const res = await exportGet(req(`/api/metrics/export?month=${month}&format=${format}`));
    expect(res.status).toBe(200);
    assertNoPeople(`export ${format}`, await bodyOf(res));
  });

  it.each(["daily_digest", "weekly_report", "compliance_summary", "incident_report"])("report %s", async (type) => {
    const res = await reportsGet(req(`/api/reports?type=${type}&format=html&incidentId=inc-1`));
    expect(res.status).toBe(200);
    assertNoPeople(type, await bodyOf(res));
  });

  it("the per-person scores export is not available (people.scoring is off)", async () => {
    expect((await legacyExportGet(req("/api/export?periodId=p1&format=json"))).status).toBe(404);
  });

  it("the monthly export is audit-logged", async () => {
    const logs = await db.client.auditLog.findMany({ where: { action: "export", entityType: "metrics_monthly" } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });
});

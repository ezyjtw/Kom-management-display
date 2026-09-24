/**
 * Spec §17.7: security events are audit-logged and drive ALR-SEC-01..05.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
vi.mock("@/lib/sse", () => ({ emitWorkItemUpdate: () => undefined, emitAlert: () => undefined, broadcastEvent: () => undefined }));

import { syncRuleCatalogue } from "@/modules/alerting/engine";
import { recordPermissionDenied, recordIntegrationAuthFailure, recordRoleChange, recordNonSsoLogin, SECURITY_ACTIONS } from "@/modules/security/events";
import { evaluateRepeatedDenials, evaluatePrivilegedChange, evaluateCredentialFailures } from "@/modules/alerting/evaluators/security";
import { checkSharedRateLimit } from "@/lib/api/shared-rate-limit";
import { RULE_CATALOGUE } from "@/modules/alerting/catalogue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the in-memory store is untyped
const p = () => db.client as any;
// Evaluators look back from "now"; events are recorded at the real current time.
const now = new Date(Date.now() + 1000);
const ctx = (params: Record<string, unknown> = {}) => ({ code: "x", now, params });

beforeEach(async () => {
  db.client.__reset();
  await syncRuleCatalogue();
  for (const code of ["ALR-SEC-03", "ALR-SEC-04"]) await p().alertRule.update({ where: { code }, data: { enabled: true } });
});

describe("security alerts", () => {
  it("catalogues ALR-SEC-01..05 with the spec severities, disabled by default", async () => {
    const byCode = Object.fromEntries(Object.values(RULE_CATALOGUE).filter((r) => r.code.startsWith("ALR-SEC-")).map((r) => [r.code, r.severity]));
    expect(byCode).toEqual({ "ALR-SEC-01": "high", "ALR-SEC-02": "medium", "ALR-SEC-03": "high", "ALR-SEC-04": "critical", "ALR-SEC-05": "high" });
    expect((await p().alertRule.findUnique({ where: { code: "ALR-SEC-01" } })).enabled).toBe(false);
  });

  it("ALR-SEC-01 fires when one user is denied more than the threshold within the window", async () => {
    for (let i = 0; i < 4; i++) await recordPermissionDenied({ userId: "u-probe", role: "employee", method: "GET", path: `/api/users/${i}` });
    await recordPermissionDenied({ userId: "u-other", role: "lead", method: "GET", path: "/api/users" });
    const rows = await p().auditLog.findMany({ where: { action: SECURITY_ACTIONS.permissionDenied } });
    expect(rows).toHaveLength(5);
    expect(rows[0].entityId).toBe("GET /api/users/0");
    // An old denial outside the window does not count.
    await p().auditLog.create({ data: { action: SECURITY_ACTIONS.permissionDenied, entityType: "route", entityId: "GET /old", userId: "system", actorUserId: "u-other", createdAt: new Date(now.getTime() - 3_600_000) } });
    await p().auditLog.create({ data: { action: SECURITY_ACTIONS.permissionDenied, entityType: "route", entityId: "GET /old", userId: "system", actorUserId: "u-other", createdAt: new Date(now.getTime() - 3_600_000) } });

    const out = await evaluateRepeatedDenials(ctx({ threshold: 3, windowMins: 15 }));
    expect(out.map((c) => c.dedupeKey)).toEqual(["u-probe"]);
    expect(out[0].severity).toBe("high");
    expect(await evaluateRepeatedDenials(ctx({ threshold: 4, windowMins: 15 }))).toEqual([]);
  });

  it("ALR-SEC-02 raises one informational alert per privileged change, including SSO role changes", async () => {
    await recordRoleChange({ targetUserId: "u1", from: "employee", to: "admin", source: "sso_group", actorUserId: null });
    await p().auditLog.create({ data: { action: "alert_rule_updated", entityType: "alert_rule", entityId: "ALR-OES-01", userId: "system", phase: "completed" } });
    await p().auditLog.create({ data: { action: "alert_rule_updated", entityType: "alert_rule", entityId: "ALR-OES-01", userId: "system", phase: "requested" } });
    await p().auditLog.create({ data: { action: "claimed", entityType: "work_item", entityId: "w1", userId: "system", phase: "recorded" } });
    await p().auditLog.create({ data: { action: "sla_policy_updated", entityType: "sla_policy", entityId: "old", userId: "system", createdAt: new Date(now.getTime() - 2 * 3_600_000) } });

    const out = await evaluatePrivilegedChange(ctx({ lookbackMins: 60 }));
    expect(out.map((c) => c.title).sort()).toEqual(["Privileged configuration change: alert_rule_updated", "Privileged configuration change: role_changed"]);
    expect(out.every((c) => c.severity === "medium")).toBe(true);
  });

  it("ALR-SEC-05 fires on repeated 401/403 from one connector host", async () => {
    for (let i = 0; i < 3; i++) await recordIntegrationAuthFailure({ host: "example.atlassian.net", status: 401 });
    await recordIntegrationAuthFailure({ host: "slack.com", status: 403 });
    const out = await evaluateCredentialFailures(ctx({ threshold: 3, windowMins: 30 }));
    expect(out.map((c) => c.dedupeKey)).toEqual(["example.atlassian.net"]);
  });

  it("ALR-SEC-04 is raised for a non-SSO sign-in", async () => {
    await recordNonSsoLogin({ userId: "u1", provider: "credentials" });
    expect(await p().auditLog.findMany({ where: { action: SECURITY_ACTIONS.nonSsoLogin } })).toHaveLength(1);
    const alerts = await p().alert.findMany({ where: { ruleCode: "ALR-SEC-04" } });
    expect(alerts).toHaveLength(1);
  });

  it("ALR-SEC-03: exports above the daily cap are refused and alerted once", async () => {
    await p().appSetting.create({ data: { key: "security.exportDailyCap", value: 3 } });
    const req = (ip: string) => new NextRequest("http://localhost/api/reports", { headers: { "x-forwarded-for": ip } });
    const t = (h: number) => new Date(`2026-09-24T${String(h).padStart(2, "0")}:00:00Z`);
    // Spread over the day so the 10-minute limiter never trips.
    for (let i = 0; i < 3; i++) expect(await checkSharedRateLimit(req("10.0.0.1"), "export", "u1", t(8 + i))).toBeNull();
    const refused = await checkSharedRateLimit(req("10.0.0.1"), "export", "u1", t(12));
    expect(refused?.status).toBe(429);
    expect((await refused!.json()).code).toBe("EXPORT_DAILY_CAP");
    expect((await checkSharedRateLimit(req("10.0.0.1"), "export", "u1", t(13)))?.status).toBe(429);
    expect(await p().alert.findMany({ where: { ruleCode: "ALR-SEC-03" } })).toHaveLength(1);
    expect(await p().auditLog.findMany({ where: { action: SECURITY_ACTIONS.exportCapExceeded } })).toHaveLength(1);
    // Next UTC day: allowed again; another user is unaffected.
    expect(await checkSharedRateLimit(req("10.0.0.1"), "export", "u1", new Date("2026-09-25T08:00:00Z"))).toBeNull();
    expect(await checkSharedRateLimit(req("10.0.0.2"), "export", "u2", t(14))).toBeNull();
  });
});

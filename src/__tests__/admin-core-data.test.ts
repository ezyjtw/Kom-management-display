/**
 * Phase 2 admin APIs: Clients & Channels, SLA policies, alert rules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth-user";

const state = vi.hoisted(() => ({ user: null as AuthUser | null }));
const prismaMock = vi.hoisted(() => ({
  client: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  clientChannel: { deleteMany: vi.fn(), createMany: vi.fn() },
  slaPolicy: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  alertRule: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

/** Details of the "completed" audit entry for an action (fail-closed audit writes requested + completed). */
function completedAudit(action: string) {
  const call = prismaMock.auditLog.create.mock.calls.map((c) => c[0].data).find((d) => d.action === action && d.phase === "completed");
  expect(call, `no completed audit entry for ${action}`).toBeTruthy();
  return JSON.parse(call.details);
}
vi.mock("@/lib/auth-user", () => ({
  requireAuth: vi.fn(async () => state.user),
}));
vi.mock("@/lib/api/rate-limit-middleware", () => ({
  checkRateLimit: () => null,
  RATE_LIMIT_PRESETS: { mutation: {} },
}));

import * as clientsRoute from "@/app/api/admin/clients/route";
import * as clientRoute from "@/app/api/admin/clients/[id]/route";
import * as slaListRoute from "@/app/api/admin/sla-policies/route";
import * as slaRoute from "@/app/api/admin/sla-policies/[id]/route";
import * as ruleRoute from "@/app/api/admin/alert-rules/[code]/route";
import { hasTargets } from "@/modules/core-data/sla-policy";
import { clientChannelSchema } from "@/lib/validation";
import { legacyAlertKeys } from "@/lib/alert-keys";

const user = (role: string, employeeId: string | null = "emp-1"): AuthUser =>
  ({ id: "user-1", name: "U", email: "u@k.com", role, employeeId, team: null });

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/x", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
});

describe("client channel validation", () => {
  it.each([
    [{ kind: "slack", ref: "C01234ABCDE" }, true],
    [{ kind: "slack", ref: "#general" }, false],
    [{ kind: "email_domain", ref: "Example.COM" }, true],
    [{ kind: "email_domain", ref: "ops@example.com" }, false],
    [{ kind: "teams", ref: "19:abc@thread.tacv2" }, true],
    [{ kind: "sms", ref: "123" }, false],
  ])("%j valid=%s", (input, ok) => {
    expect(clientChannelSchema.safeParse(input).success).toBe(ok);
  });

  it("lower-cases email domains", () => {
    expect(clientChannelSchema.parse({ kind: "email_domain", ref: "Example.COM" }).ref).toBe("example.com");
  });
});

describe("/api/admin/clients", () => {
  it("lets a lead view clients but masks account numbers", async () => {
    state.user = user("lead");
    prismaMock.client.findMany.mockResolvedValue([{ id: "c1", displayName: "A", komainuAccountNos: ["ACC123456"], channels: [] }]);
    const res = await clientsRoute.GET(req("GET"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data[0].komainuAccountNos[0]).not.toBe("ACC123456");
  });

  it("forbids a lead from creating clients", async () => {
    state.user = user("lead");
    const res = await clientsRoute.POST(req("POST", { displayName: "A" }));
    expect(res.status).toBe(403);
    expect(prismaMock.client.create).not.toHaveBeenCalled();
  });

  it("lets an admin create a client with channels and audit-logs it", async () => {
    state.user = user("admin");
    prismaMock.client.create.mockResolvedValue({ id: "c1", displayName: "Acme", jurisdiction: "UK", channels: [] });
    const res = await clientsRoute.POST(req("POST", {
      displayName: "Acme", jurisdiction: "UK", channels: [{ kind: "email_domain", ref: "acme.io" }],
    }));
    expect(res.status).toBe(201);
    expect(prismaMock.client.create.mock.calls[0][0].data.channels).toEqual({ create: [{ kind: "email_domain", ref: "acme.io" }] });
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: "client_created", userId: "emp-1" });
  });

  it("rejects invalid input", async () => {
    state.user = user("admin");
    const res = await clientsRoute.POST(req("POST", { displayName: "", jurisdiction: "US" }));
    expect(res.status).toBe(400);
  });

  it("replaces channels on update and records before/after", async () => {
    state.user = user("admin", null);
    prismaMock.client.findUnique.mockResolvedValue({ id: "c1", displayName: "Acme", isActive: true, jurisdiction: "", channels: [{ kind: "slack", ref: "C0000000001" }] });
    prismaMock.client.update.mockResolvedValue({ id: "c1", displayName: "Acme", isActive: false, jurisdiction: "", channels: [] });
    const res = await clientRoute.PATCH(req("PATCH", { isActive: false, channels: [] }), ctx({ id: "c1" }));
    expect(res.status).toBe(200);
    expect(prismaMock.clientChannel.deleteMany).toHaveBeenCalledWith({ where: { clientId: "c1" } });
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(audit.userId).toBe("system"); // user with no Employee record
    expect(JSON.parse(audit.details).metadata.actorUserId).toBe("user-1");
  });
});

describe("SLA policies", () => {
  it("hasTargets is false until any clock or rule is set", () => {
    const none = { ownershipMins: null, firstRespMins: null, resolveMins: null, resolveRule: null };
    expect(hasTargets(none)).toBe(false);
    expect(hasTargets({ ...none, firstRespMins: 120 })).toBe(true);
    expect(hasTargets({ ...none, resolveRule: "next_business_day_eod" })).toBe(true);
  });

  it("lists which active policies still have no targets", async () => {
    state.user = user("lead");
    prismaMock.slaPolicy.findMany.mockResolvedValue([
      { code: "CLIENT-Q-P1", isActive: true, ownershipMins: null, firstRespMins: null, resolveMins: null, resolveRule: null },
      { code: "OES-FAIL", isActive: true, ownershipMins: null, firstRespMins: 120, resolveMins: null, resolveRule: null },
      { code: "OLD", isActive: false, ownershipMins: null, firstRespMins: null, resolveMins: null, resolveRule: null },
    ]);
    const json = await (await slaListRoute.GET()).json();
    expect(json.data.targetsNotSet).toEqual(["CLIENT-Q-P1"]);
  });

  it("only an admin can set targets; the change bumps the version and is audited", async () => {
    state.user = user("lead");
    expect((await slaRoute.PATCH(req("PATCH", { ownershipMins: 15 }), ctx({ id: "p1" }))).status).toBe(403);

    state.user = user("admin");
    prismaMock.slaPolicy.findUnique.mockResolvedValue({ id: "p1", code: "CLIENT-Q-P1", ownershipMins: null });
    prismaMock.slaPolicy.update.mockResolvedValue({ id: "p1", code: "CLIENT-Q-P1", ownershipMins: 15, version: 2 });
    const res = await slaRoute.PATCH(req("PATCH", { ownershipMins: 15 }), ctx({ id: "p1" }));
    expect(res.status).toBe(200);
    expect(prismaMock.slaPolicy.update.mock.calls[0][0].data).toMatchObject({ ownershipMins: 15, version: { increment: 1 } });
    // Fail-closed audit: requested entry (with before) then completed entry (with the outcome).
    const done = completedAudit("sla_policy_updated");
    expect(done.before.ownershipMins).toBeNull();
    expect(done.outcome.ownershipMins).toBe(15);
  });

  it("rejects non-integer or empty updates", async () => {
    state.user = user("admin");
    expect((await slaRoute.PATCH(req("PATCH", { ownershipMins: 1.5 }), ctx({ id: "p1" }))).status).toBe(400);
    expect((await slaRoute.PATCH(req("PATCH", {}), ctx({ id: "p1" }))).status).toBe(400);
  });
});

describe("alert rules", () => {
  it("rule changes need admin and are audit-logged with before and after", async () => {
    state.user = user("lead");
    expect((await ruleRoute.PATCH(req("PATCH", { enabled: true }), ctx({ code: "ALR-OES-01" }))).status).toBe(403);

    state.user = user("admin");
    prismaMock.alertRule.findUnique.mockResolvedValue({ code: "ALR-OES-01", enabled: false, severity: "critical", params: {}, route: {} });
    prismaMock.alertRule.update.mockResolvedValue({ code: "ALR-OES-01", enabled: true, severity: "critical", params: {}, route: {}, version: 2 });
    const res = await ruleRoute.PATCH(req("PATCH", { enabled: true }), ctx({ code: "ALR-OES-01" }));
    expect(res.status).toBe(200);
    const details = completedAudit("alert_rule_updated");
    expect(details.before.enabled).toBe(false);
    expect(details.outcome.enabled).toBe(true);
  });

  it("refuses (422) to enable a rule with CONFIRM placeholders and lists the missing params (spec §11.5)", async () => {
    state.user = user("admin");
    prismaMock.alertRule.findUnique.mockResolvedValue({ code: "ALR-RSK-08", enabled: false, severity: "high", params: {}, route: {} });
    prismaMock.alertRule.update.mockClear();

    let res = await ruleRoute.PATCH(req("PATCH", { enabled: true }), ctx({ code: "ALR-RSK-08" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.missing).toEqual(["pendingMins (CONFIRM-RSK-UNSCORED-MINS)", "excludedWorkspaces (CONFIRM-RSK-UNSCORED-WORKSPACES)"]);
    expect(body.error).toMatch(/cannot be enabled until its CONFIRM parameters are set/);
    expect(prismaMock.alertRule.update).not.toHaveBeenCalled();

    // Setting only one placeholder is still refused.
    res = await ruleRoute.PATCH(req("PATCH", { enabled: true, params: { pendingMins: 30 } }), ctx({ code: "ALR-RSK-08" }));
    expect((await res.json()).missing).toEqual(["excludedWorkspaces (CONFIRM-RSK-UNSCORED-WORKSPACES)"]);

    // Params may be set while the rule stays disabled; enabling works once all are set.
    prismaMock.alertRule.update.mockResolvedValue({ code: "ALR-RSK-08", enabled: true, severity: "high", params: {}, route: {}, version: 2 });
    res = await ruleRoute.PATCH(req("PATCH", { enabled: true, params: { pendingMins: 30, excludedWorkspaces: ["cold-1"] } }), ctx({ code: "ALR-RSK-08" }));
    expect(res.status).toBe(200);
    expect(prismaMock.alertRule.update.mock.calls[0][0].data.params).toEqual({ pendingMins: 30, excludedWorkspaces: ["cold-1"] });
  });

  it("legacy alerts get their type as rule code and a unique dedupe key", () => {
    const a = legacyAlertKeys("ttfa_breach");
    const b = legacyAlertKeys("ttfa_breach");
    expect(a.ruleCode).toBe("ttfa_breach");
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });
});

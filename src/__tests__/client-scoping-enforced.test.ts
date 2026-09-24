/**
 * Spec §17.5 `client-scoping-enforced`: a user restricted to some clients
 * cannot list, fetch or act on another client's items by id, and every by-id
 * work item route goes through the one scope helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/sse", () => ({ emitWorkItemUpdate: () => undefined, emitAlert: () => undefined, broadcastEvent: () => undefined }));
const auth = vi.hoisted(() => ({ user: { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null } as Record<string, unknown> }));
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => auth.user) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {}, read: {} } }));

import { GET as queueGet } from "@/app/api/work-items/route";
import { GET as detailGet } from "@/app/api/work-items/[id]/route";
import { POST as notes } from "@/app/api/work-items/[id]/notes/route";
import { PATCH as priority } from "@/app/api/work-items/[id]/priority/route";
import { GET as incidentGet } from "@/app/api/client-incidents/[id]/route";
import { GET as overviewGet } from "@/app/api/clients/overview/route";
import { clientScopeFor, canSeeClient, clientWhere } from "@/modules/auth/client-scope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the in-memory store is untyped
const p = () => db.client as any;
const req = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  db.client.__reset();
  auth.user = { id: "u-ann", name: "Ann", email: "ann@k.com", role: "employee", employeeId: "emp-ann", team: null };
  await p().client.create({ data: { id: "c-acme", displayName: "Acme", isActive: true } });
  await p().client.create({ data: { id: "c-beta", displayName: "Beta", isActive: true } });
  const base = { kind: "client_request", team: "All", state: "open", priority: "P2", sourceSystem: "test", clockStartedAt: new Date(), metadata: {} };
  await p().workItem.create({ data: { ...base, id: "w-acme", title: "Acme item", clientId: "c-acme", sourceId: "1" } });
  await p().workItem.create({ data: { ...base, id: "w-beta", title: "Beta item", clientId: "c-beta", sourceId: "2" } });
  await p().workItem.create({ data: { ...base, id: "w-internal", title: "Internal task", clientId: null, sourceId: "3", kind: "internal_task" } });
  // Ann may see Acme only.
  await p().userClientScope.create({ data: { userId: "u-ann", clientId: "c-acme" } });
});

describe("client-scoping-enforced", () => {
  it("resolves the scope: rows restrict, no rows and admin/auditor are unrestricted (CONFIRM-CLIENT-SCOPING)", async () => {
    expect(await clientScopeFor({ id: "u-ann", role: "employee" })).toEqual({ all: false, clientIds: ["c-acme"] });
    expect(await clientScopeFor({ id: "u-bob", role: "employee" })).toEqual({ all: true });
    expect(await clientScopeFor({ id: "u-ann", role: "admin" })).toEqual({ all: true });
    const scope = { all: false as const, clientIds: ["c-acme"] };
    expect(canSeeClient(scope, "c-acme")).toBe(true);
    expect(canSeeClient(scope, "c-beta")).toBe(false);
    expect(canSeeClient(scope, null)).toBe(true);
    expect(clientWhere({ all: true })).toEqual({});
  });

  it("the queue lists only in-scope clients and client-less work", async () => {
    const res = await queueGet(req("/api/work-items?team=all&status=all"));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.rows.map((r: { id: string }) => r.id).sort()).toEqual(["w-acme", "w-internal"]);
    expect(body.data.clientOptions.map((c: { id: string }) => c.id)).toEqual(["c-acme"]);
  });

  it("another client's item by id is 404 on read, on write and on the client incident view", async () => {
    expect((await detailGet(req("/api/work-items/w-beta"), ctx("w-beta"))).status).toBe(404);
    expect((await incidentGet(req("/api/client-incidents/w-beta"), ctx("w-beta"))).status).toBe(404);
    const noteRes = await notes(req("/api/work-items/w-beta/notes", "POST", { text: "peek" }), ctx("w-beta"));
    expect(noteRes.status).toBe(404);
    auth.user = { ...auth.user, role: "lead" }; // leads may change priority; the scope still applies
    const prioRes = await priority(req("/api/work-items/w-beta/priority", "PATCH", { priority: "P1" }), ctx("w-beta"));
    expect(prioRes.status).toBe(404);
    expect((await p().workItem.findUnique({ where: { id: "w-beta" } })).priority).toBe("P2");
    // The denial is audit-logged (spec §17.7); the write does not delay the response.
    await new Promise((r) => setTimeout(r, 50));
    expect((await p().auditLog.findMany({ where: { action: "permission_denied" } })).length).toBeGreaterThanOrEqual(4);
  });

  it("in-scope items stay reachable", async () => {
    const res = await detailGet(req("/api/work-items/w-acme"), ctx("w-acme"));
    expect(res.status).toBe(200);
  });

  it("the clients overview lists only in-scope clients", async () => {
    const body = await (await overviewGet(req("/api/clients/overview"))).json();
    expect(body.data.clients.map((c: { clientId: string }) => c.clientId)).toEqual(["c-acme"]);
  });

  it("every by-id work item and client incident route goes through the scope helper", () => {
    const roots = ["src/app/api/work-items/[id]", "src/app/api/client-incidents/[id]", "src/app/api/client-incidents/drafts"];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.name === "route.ts") files.push(f);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(15);
    const missing = files.filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return !/workItemScopeGuard\(|workAction\(/.test(src);
    });
    expect(missing).toEqual([]);
  });
});

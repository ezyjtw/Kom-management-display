/**
 * Phase 12g: the former AUDIT_GAPS routes audit fail-closed. Behavioural check
 * on one converted route: requested + completed entries with one correlation
 * id, and no write at all when the audit store is unavailable (503).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});
vi.mock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => ({ id: "u-ann", name: "Ann", email: "a@k.com", role: "lead", employeeId: "emp-ann", team: null })) }));
vi.mock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { mutation: {} } }));

import { POST } from "@/app/api/settlements/notes/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- in-memory store
const p = () => db.client as any;
const body = { windowKey: "2026-09-24:okx:14:00Z", portfolioId: "pf-1", text: "Checked with the exchange" };
const req = () => new NextRequest("http://localhost/api/settlements/notes", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => db.client.__reset());

describe("legacy routes are fail-closed (12g)", () => {
  it("writes requested then completed, sharing a correlation id", async () => {
    const res = await POST(req());
    expect(res.status).toBe(201);
    const rows = await p().auditLog.findMany({ where: { action: "settlement_note_added" } });
    expect(rows.map((r: { phase: string }) => r.phase).sort()).toEqual(["completed", "requested"]);
    expect(new Set(rows.map((r: { correlationId: string }) => r.correlationId)).size).toBe(1);
    expect(JSON.parse(rows.find((r: { phase: string }) => r.phase === "completed").details).outcome).toEqual({ status: 201 });
    expect(await p().settlementNote.findMany({})).toHaveLength(1);
  });

  it("refuses with 503 and writes nothing when the audit trail cannot be written", async () => {
    vi.spyOn(p().auditLog, "create").mockRejectedValueOnce(new Error("audit store down"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await p().settlementNote.findMany({})).toHaveLength(0);
  });
});

/**
 * API route protection (BLOCKING control; replaces the CI grep for the
 * literal strings requireAuth/requireRole, which could not see wrappers).
 *
 * 1. Every route file is either on the explicit PUBLIC list or calls a known
 *    guard. Each wrapper guard is itself checked to authenticate (or to
 *    verify a signature) before doing anything else.
 * 2. Every route that reads a request body validates it with Zod, directly or
 *    through a wrapper that is checked to validate.
 * 3. Behaviour: an anonymous caller gets 401 from every wrapper-guarded route.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

/** Deliberately unauthenticated routes. Adding one needs a reason. */
const PUBLIC: Record<string, string> = {
  "src/app/api/auth/[...nextauth]/route.ts": "NextAuth sign-in endpoints",
  "src/app/api/health/liveness/route.ts": "container liveness probe (no data)",
  "src/app/api/health/readiness/route.ts": "container readiness probe (no data)",
};

/** Guard name -> the file implementing it and what that file must do first. */
const WRAPPERS: Record<string, { file: string; must: RegExp[]; validates?: boolean }> = {
  bankGuard: { file: "src/modules/bank/route-helpers.ts", must: [/requireAuth\(\)/, /requireAuthorization\(/] },
  workAction: { file: "src/modules/work-items/http.ts", must: [/requireAuth\(\)/, /requireAuthorization\(/], validates: true },
  handoverAction: { file: "src/modules/morning/http.ts", must: [/requireAuth\(\)/], validates: true },
  verifySlackWebhook: { file: "src/lib/webhook-verify.ts", must: [/createHmac\(/, /timingSafeEqual\(/] },
};
const DIRECT = /\b(requireAuth|requireRole)\(/;
const VALIDATES = /\b(safeParse|validateBody)\(/;
const READS_BODY = /\b(request|req)\.(json|formData|text)\(\)/;

function routeFiles(dir = "src/app/api"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}

const files = routeFiles();
const src = (f: string) => readFileSync(f, "utf8");
const wrapperIn = (text: string) => Object.keys(WRAPPERS).find((w) => new RegExp(`\\b${w}\\(`).test(text));

describe("API route guards (blocking)", () => {
  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("every route is public by name or calls a known guard", () => {
    const unguarded = files.filter((f) => !PUBLIC[f] && !DIRECT.test(src(f)) && !wrapperIn(src(f)));
    expect(unguarded, `Unguarded routes: ${unguarded.join(", ")}`).toEqual([]);
  });

  it("the public list only names routes that exist", () => {
    for (const f of Object.keys(PUBLIC)) expect(files).toContain(f);
  });

  it.each(Object.entries(WRAPPERS))("wrapper %s authenticates (or verifies a signature)", (_name, w) => {
    const text = src(w.file);
    for (const re of w.must) expect(text).toMatch(re);
    if (w.validates) expect(text).toMatch(VALIDATES);
  });

  it("every route that reads a request body validates it with Zod", () => {
    const unvalidated = files.filter((f) => {
      const text = src(f);
      if (!READS_BODY.test(text) && !/export\s+async\s+function\s+(POST|PUT|PATCH)/.test(text)) return false;
      if (VALIDATES.test(text)) return false;
      const w = wrapperIn(text);
      if (w && WRAPPERS[w].validates) return false;
      return READS_BODY.test(text);
    });
    expect(unvalidated, `Body read without validation: ${unvalidated.join(", ")}`).toEqual([]);
  });
});

// ── Behaviour: anonymous callers get 401 from wrapper-guarded routes ──

vi.mock("@/lib/auth-user", () => ({
  requireAuth: vi.fn(async () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })),
  requireRole: vi.fn(async () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => { throw new Error("no database access expected before authentication"); } }) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/feature-gate", () => ({ featureGate: vi.fn(async () => null) }));

const ANON: Array<[string, string]> = [
  ["@/app/api/work-items/[id]/notes/route", "POST"],
  ["@/app/api/work-items/[id]/ownership/route", "POST"],
  ["@/app/api/work-items/[id]/state/route", "POST"],
  ["@/app/api/work-items/[id]/time/route", "POST"],
  ["@/app/api/work-items/[id]/links/route", "POST"],
  ["@/app/api/morning/handover/route", "POST"],
  ["@/app/api/morning/handover/retry/route", "POST"],
  ["@/app/api/morning/absence/route", "POST"],
  ["@/app/api/bank/route", "GET"],
  ["@/app/api/bank/instructions/route", "POST"],
  ["@/app/api/bank/settlements/route", "POST"],
  ["@/app/api/bank/fee-balances/route", "POST"],
];

describe("anonymous callers are rejected by wrapper-guarded routes", () => {
  it.each(ANON)("%s %s -> 401", async (mod, method) => {
    const route = (await import(/* @vite-ignore */ mod)) as Record<string, (req: NextRequest, ctx: unknown) => Promise<Response>>;
    expect(route[method], `${mod} has no ${method}`).toBeTypeOf("function");
    const res = await route[method](
      new NextRequest("http://localhost/api/x", { method, body: method === "GET" ? undefined : JSON.stringify({}) }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(401);
  });
});

/**
 * Spec §17.4 / §17.10 `every-api-route-has-a-schema`: every mutation route
 * that reads a request body validates it with a Zod schema; placeholder
 * schemas that accept anything are refused; routes that read no body are
 * listed and checked to read none.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/** Mutation routes that take no body (the id is in the path). */
const NO_BODY: Record<string, string> = {
  "/api/admin/jira-projects/[key]/discover": "Discovery of the project's issue types; key in path.",
  "/api/alerts/[id]/acknowledge": "Acknowledge by id.",
  "/api/client-incidents/[id]/updates/[updateId]/review": "Approve a reviewed update by id.",
  "/api/daily-checks/items/[id]/collect": "Collect evidence for an item by id.",
  "/api/daily-checks/items/[id]/skip-signoff": "Approve a skip request by id.",
  "/api/iai-drafts/[id]/complete": "Complete a draft by id.",
  "/api/integrations/email": "Queue a mailbox poll.",
  "/api/notifications": "Mark notifications read for the caller.",
};

/** Signed inbound webhooks: external payload formats, verified by signature, parsed field by field. */
const EXTERNAL_PAYLOAD = new Set(["/api/webhooks/slack", "/api/webhooks/slack/interactivity"]);

const READS_BODY = /request\.json\(|req\.json\(|request\.text\(|request\.formData\(/;
const VALIDATES = /validateBody\(|\.safeParse\(|\.parse\(|workAction\(|handoverAction\(/;
const PLACEHOLDER = /z\.object\(\{\}\)\.passthrough\(\)/;

function mutationRoutes(): Array<{ route: string; src: string }> {
  const out: Array<{ route: string; src: string }> = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === "route.ts") {
        const src = fs.readFileSync(f, "utf8");
        if (/export (async )?function (POST|PUT|PATCH|DELETE)\b/.test(src)) out.push({ route: "/" + path.relative("src/app", path.dirname(f)).split(path.sep).join("/"), src });
      }
    }
  };
  walk("src/app/api");
  return out;
}

describe("every-api-route-has-a-schema", () => {
  const routes = mutationRoutes();

  it("every mutation route that reads a body validates it", () => {
    const missing = routes.filter((r) => READS_BODY.test(r.src) && !VALIDATES.test(r.src)).map((r) => r.route);
    expect(missing).toEqual([]);
  });

  it("no placeholder schema that accepts anything (except signed external payloads)", () => {
    expect(routes.filter((r) => PLACEHOLDER.test(r.src) && !EXTERNAL_PAYLOAD.has(r.route)).map((r) => r.route)).toEqual([]);
  });

  it("routes without a schema read no body, and are listed with a reason", () => {
    const unvalidated = routes.filter((r) => !VALIDATES.test(r.src)).map((r) => r.route).sort();
    expect(unvalidated).toEqual(Object.keys(NO_BODY).sort());
    for (const r of routes.filter((x) => x.route in NO_BODY)) expect(READS_BODY.test(r.src), r.route).toBe(false);
  });

  it("validateBody enforces size and depth limits and strips unknown fields", async () => {
    const { validateBody, INPUT_LIMITS } = await import("@/lib/validation");
    const { z } = await import("zod");
    const schema = z.object({ a: z.string() });
    const ok = validateBody(schema, { a: "x", extra: 1 });
    expect(ok.success && ok.data).toEqual({ a: "x" });
    let deep: Record<string, unknown> = { a: "x" };
    for (let i = 0; i < INPUT_LIMITS.maxDepth + 2; i++) deep = { a: "x", n: deep };
    expect(validateBody(schema, deep).success).toBe(false);
  });
});

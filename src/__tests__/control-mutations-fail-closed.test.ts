/**
 * Review remediation (spec §17.7): every state-changing route is classified,
 * and control, security, financial, configuration and administration routes
 * write their audit trail fail-closed. The known gaps list can only shrink.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { AUDIT_GAPS, FAIL_CLOSED, auditCategoryFor } from "@/lib/api/audit-policy";

const FAIL_CLOSED_HELPERS = /auditedAction\(|auditedResponse\(|workAction\(|handoverAction\(/;

function mutationRoutes(): Array<{ route: string; src: string }> {
  const out: Array<{ route: string; src: string }> = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name === "route.ts") {
        const src = fs.readFileSync(f, "utf8");
        if (/export (async )?function (POST|PUT|PATCH|DELETE)\b|export const (POST|PUT|PATCH|DELETE)\b/.test(src)) {
          out.push({ route: "/" + path.relative("src/app", path.dirname(f)).split(path.sep).join("/"), src });
        }
      }
    }
  };
  walk("src/app/api");
  return out;
}

describe("control-mutations-fail-closed", () => {
  const routes = mutationRoutes();

  it("finds the mutation routes", () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it("classifies every mutation route", () => {
    expect(routes.filter((r) => !auditCategoryFor(r.route)).map((r) => r.route)).toEqual([]);
  });

  it("fail-closed routes use auditedAction (or a wrapper that does), unless listed as a gap", () => {
    const violations = routes
      .filter((r) => FAIL_CLOSED.has(auditCategoryFor(r.route)!.category))
      .filter((r) => !FAIL_CLOSED_HELPERS.test(r.src) && !(r.route in AUDIT_GAPS))
      .map((r) => `${r.route} (${auditCategoryFor(r.route)!.category})`);
    expect(violations).toEqual([]);
  });

  it("the gap list only holds real, still-open gaps", () => {
    const byRoute = new Map(routes.map((r) => [r.route, r.src]));
    for (const [route, reason] of Object.entries(AUDIT_GAPS)) {
      expect(reason.length, route).toBeGreaterThan(10);
      expect(byRoute.has(route), `${route} is not a mutation route any more: remove it from AUDIT_GAPS`).toBe(true);
      expect(FAIL_CLOSED.has(auditCategoryFor(route)!.category), `${route} is not fail-closed: remove it from AUDIT_GAPS`).toBe(true);
      expect(FAIL_CLOSED_HELPERS.test(byRoute.get(route)!), `${route} is now fail-closed: remove it from AUDIT_GAPS`).toBe(false);
    }
  });

  it("the helpers the policy trusts are themselves fail-closed", () => {
    const audit = fs.readFileSync("src/lib/api/audit.ts", "utf8");
    expect(audit).toMatch(/export async function auditedResponse[\s\S]*?return auditedAction\(/);
    expect(fs.readFileSync("src/modules/work-items/http.ts", "utf8")).toMatch(/auditedAction\(/);
  });
});

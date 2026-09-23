/**
 * Phase 0 acceptance: no-approval-routes (H1).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "..");
const API = path.join(SRC, "app", "api");
const ALLOWED = path.join("client-comms", "[id]", "approve", "route.ts");

function walk(dir: string, skipTests = true): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return skipTests && e.name === "__tests__" ? [] : walk(full, skipTests);
    return [full];
  });
}

describe("no-approval-routes", () => {
  it("no API route path contains 'approve' except client-comms drafts", () => {
    const offenders = walk(API)
      .filter((f) => f.endsWith("route.ts"))
      .map((f) => path.relative(API, f))
      .filter((rel) => rel.toLowerCase().includes("approve") && rel !== ALLOWED);
    expect(offenders).toEqual([]);
  });

  it("the approvals page and approve-api route no longer exist", () => {
    expect(fs.existsSync(path.join(SRC, "app", "approvals"))).toBe(false);
    expect(fs.existsSync(path.join(API, "approvals"))).toBe(false);
    expect(fs.existsSync(path.join(API, "travel-rule", "cases", "[id]", "approve-api"))).toBe(false);
  });

  it("no source references a /v1/requests/ write action", () => {
    const pattern = /\/v1\/requests\/[^"'`\s)]*(approve|reject|confirm|cancel|challenge)/i;
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => pattern.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the sidebar has no Approvals Queue entry", () => {
    const sidebar = fs.readFileSync(path.join(SRC, "components", "shared", "Sidebar.tsx"), "utf8");
    expect(sidebar).not.toContain('"/approvals"');
  });
});

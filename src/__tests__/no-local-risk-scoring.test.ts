/**
 * Phase 0 acceptance: no-local-risk-scoring (H5).
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("no-local-risk-scoring", () => {
  it("assessRiskLevel is not defined or exported anywhere in src/", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => fs.readFileSync(f, "utf8").includes("assessRiskLevel"))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("transaction-confirmation module does not export assessRiskLevel", async () => {
    const mod = await import("@/lib/transaction-confirmation");
    expect("assessRiskLevel" in mod).toBe(false);
  });
});

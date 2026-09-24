/** Spec §17.10 no-dangerously-set-inner-html: React's raw HTML escape hatch is not used anywhere in src/. */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

describe("no-dangerously-set-inner-html", () => {
  it("does not appear in src/", () => {
    const hits = files("src").filter((f) => !f.endsWith("no-dangerously-set-inner-html.test.ts") && /dangerouslySetInnerHTML/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

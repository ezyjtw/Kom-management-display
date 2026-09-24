/**
 * Phase 12l: the repository is employer-neutral. The denylist is stored as
 * hashes (scripts/check-neutral-ip.ts); the plain list is kept privately.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DENYLIST_SHA256, countDenied, offendingFiles, tokens } from "../../scripts/check-neutral-ip";

describe("neutral-ip", () => {
  it("no tracked file names or contains a denylisted term", () => {
    expect(offendingFiles()).toEqual([]);
  });

  it("tokenises camelCase, snake_case and pairs of words", () => {
    expect(tokens("fooBarBaz snake_case HTTPServer")).toEqual(["foo", "bar", "baz", "snake", "case", "http", "server"]);
  });

  it("matches single tokens and adjacent pairs by hash only", () => {
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    DENYLIST_SHA256.add(sha("zzqx"));
    DENYLIST_SHA256.add(sha("alpha omega"));
    try {
      expect(countDenied("a zzqx b")).toBe(1);
      expect(countDenied("theZzqxModule")).toBe(1);
      expect(countDenied("alpha omega")).toBe(1);
      expect(countDenied("alpha beta omega")).toBe(0);
    } finally {
      DENYLIST_SHA256.delete(sha("zzqx"));
      DENYLIST_SHA256.delete(sha("alpha omega"));
    }
  });

  it("refuses documents it cannot read", () => {
    const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nip-")), "overview.pdf");
    fs.writeFileSync(pdf, "%PDF-1.4");
    expect(offendingFiles(["package.json", pdf]).map((o) => o.file)).toEqual([pdf]);
  });

  it("keeps the denylist as hashes only", () => {
    for (const h of DENYLIST_SHA256) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(DENYLIST_SHA256.size).toBeGreaterThan(10);
  });
});

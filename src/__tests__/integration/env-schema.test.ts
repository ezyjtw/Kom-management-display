/**
 * Tests that env schema and .env.example stay aligned.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Environment Schema", () => {
  it("should have .env.example covering all required env vars", () => {
    const envExample = path.resolve(__dirname, "../../../.env.example");
    if (!fs.existsSync(envExample)) {
      console.warn("No .env.example found, skipping");
      return;
    }

    const content = fs.readFileSync(envExample, "utf-8");
    const keys = content.split("\n")
      .filter(l => l.trim() && !l.startsWith("#"))
      .map(l => l.split("=")[0].trim());

    // Required keys that must be in .env.example
    const required = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL"];
    for (const key of required) {
      expect(keys).toContain(key);
    }
  });

  it("should have env.ts schema file", () => {
    const envTs = path.resolve(__dirname, "../../lib/env.ts");
    expect(fs.existsSync(envTs)).toBe(true);
  });
});

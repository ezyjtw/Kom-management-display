/**
 * Tests that configuration stays consistent across the codebase.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

describe("Configuration Drift", () => {
  it("should have consistent security headers between middleware and next.config.js", () => {
    const middleware = fs.readFileSync("src/middleware.ts", "utf-8");
    const nextConfig = fs.readFileSync("next.config.js", "utf-8");

    // Both should have X-DNS-Prefetch-Control set to "off"
    expect(middleware).toContain('"X-DNS-Prefetch-Control": "off"');
    if (nextConfig.includes("X-DNS-Prefetch-Control")) {
      expect(nextConfig).toContain('"off"');
    }
  });

  it("should have .nvmrc matching Dockerfile Node version", () => {
    const nvmrc = fs.readFileSync(".nvmrc", "utf-8").trim();
    const dockerfile = fs.readFileSync("Dockerfile", "utf-8");

    // Dockerfile should use the same major Node version
    expect(dockerfile).toContain(`node:${nvmrc}`);
  });

  it("should have package.json engines matching .nvmrc", () => {
    const nvmrc = fs.readFileSync(".nvmrc", "utf-8").trim();
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));

    if (pkg.engines?.node) {
      expect(pkg.engines.node).toContain(nvmrc);
    }
  });
});

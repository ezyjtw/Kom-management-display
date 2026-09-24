/**
 * Tests that configuration stays consistent across the codebase.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

describe("Configuration Drift", () => {
  it("should have consistent security headers between the policy and next.config.js", async () => {
    const { SECURITY_HEADERS } = await import("@/lib/security-policy");
    const nextConfig = fs.readFileSync("next.config.js", "utf-8");

    // next.config.js may repeat a header (belt and braces) but never with a different value.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      const m = nextConfig.match(new RegExp(`key:\\s*"${name}",\\s*value:\\s*"([^"]*)"`));
      if (m) expect(m[1]).toBe(value);
    }
    expect(SECURITY_HEADERS["X-DNS-Prefetch-Control"]).toBe("off");
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

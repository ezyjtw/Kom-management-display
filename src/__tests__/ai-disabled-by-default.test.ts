/**
 * Phase 0 acceptance: ai-disabled-by-default (H3).
 * "Clean DB" = no FeatureFlag rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: { featureFlag: { findMany: vi.fn().mockResolvedValue([]) } },
}));

const API = path.resolve(__dirname, "..", "app", "api");
const AI_ROUTE_DIRS = ["ai", "compliance-bot"];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return e.name === "route.ts" ? [full] : [];
  });
}

describe("ai-disabled-by-default", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AI_PROVIDER;
  });

  it("getProvider() resolves to none even when API keys are present", async () => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const ai = await import("@/lib/ai");
      expect(ai.getProviderName()).toBe("none");
      expect(ai.isAiEnabled()).toBe(false);
      expect(await ai.isAiActive()).toBe(false);
    } finally {
      delete process.env.GROQ_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("AI stays inactive with a provider set while the ai.enabled flag is absent", async () => {
    process.env.AI_PROVIDER = "groq";
    try {
      const ai = await import("@/lib/ai");
      expect(ai.getProviderName()).toBe("groq");
      expect(await ai.isAiActive()).toBe(false);
      expect(await ai.generateBriefing({} as Parameters<typeof ai.generateBriefing>[0])).toBeNull();
    } finally {
      delete process.env.AI_PROVIDER;
    }
  });

  it("every AI API route returns 404", async () => {
    const files = AI_ROUTE_DIRS.flatMap((d) => routeFiles(path.join(API, d)));
    expect(files.length).toBeGreaterThan(0);

    let checked = 0;
    for (const file of files) {
      const mod = await import(file);
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler !== "function") continue;
        const req = new NextRequest("http://localhost/api/test", {
          method,
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        const res = await handler(req, { params: {} });
        expect(res.status, `${method} ${path.relative(API, file)}`).toBe(404);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("AI pages render 404 via their layouts", async () => {
    const { requireFeature } = await import("@/lib/feature-gate");
    await expect(requireFeature("ai.enabled")).rejects.toThrow();
    await expect(requireFeature("ai.compliance_bot")).rejects.toThrow();
  });
});

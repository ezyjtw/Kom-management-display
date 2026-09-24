/**
 * Fixes from the Phase 12 local security scan (Semgrep and Trivy; see
 * docs/phase1/security-scan-2026-09.md): escaping in generated HTML reports,
 * ReDoS-safe admin patterns, own-key lookups for URL-selected handlers, pinned
 * GCM tag length.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

const db = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import("@/__tests__/helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", async () => {
  const { createFakePrisma } = await import("@/__tests__/helpers/fake-prisma");
  db.client = createFakePrisma();
  return { prisma: db.client };
});

import "@/lib/prisma";
import { safeRegex, unsafeRegexReason, boundedTest, MAX_TEST_LENGTH } from "@/lib/safe-regex";
import { escapeHtml } from "@/lib/html-escape";

beforeEach(() => db.client.__reset());

describe("admin regex patterns are ReDoS-safe", () => {
  it("refuses nested quantifiers and backreferences, accepts ordinary patterns", () => {
    for (const bad of ["(a+)+$", "(\\w*)*x", "([a-z]+){2,}", "(x|y+)+", "(a)\\1"]) expect(unsafeRegexReason(bad), bad).not.toBeNull();
    for (const ok of ["^risk engine", "wallet\\s*tech", "(CHG|PDEF)-\\d+", "auto[- ]approval", "^(?<date>\\d{8})_mtd\\.csv$"]) expect(unsafeRegexReason(ok), ok).toBeNull();
    expect(safeRegex("(")).toBeNull();
    expect(unsafeRegexReason("a".repeat(301))).toMatch(/longer than/);
  });

  it("caps the text a pattern is run against", () => {
    const re = /x$/;
    expect(boundedTest(re, "a".repeat(MAX_TEST_LENGTH + 10) + "x")).toBe(false);
    expect(boundedTest(re, "abcx")).toBe(true);
  });

  it("the Platform impact-rule and import-filename settings refuse unsafe patterns when saved", async () => {
    const { SETTINGS } = await import("@/modules/settings/registry");
    const schema = SETTINGS["imports.filenamePatterns"].schema;
    expect(schema.safeParse({ mtd: "^(?<date>\\d{8})_mtd\\.csv$" }).success).toBe(true);
    expect(schema.safeParse({ mtd: "^((?<date>\\d+)+)+$" }).success).toBe(false);
    const route = fs.readFileSync("src/app/api/admin/reference/[table]/route.ts", "utf8");
    expect(route).toMatch(/pattern: z\.string\(\)[^\n]*unsafeRegexReason/);
  });
});

describe("generated HTML reports escape stored text", () => {
  it("escapeHtml covers text and quoted attributes", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">'&`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
    expect(escapeHtml(null)).toBe("");
  });

  it("an incident report does not render markup from the incident or its updates", async () => {
    const { generateReport } = await import("@/lib/pdf-report");
    await db.client.incident.create({
      data: {
        id: "inc1", title: `<script>alert("t")</script>`, provider: "<b>Vendor</b>", severity: `high" onmouseover="x`, status: "active",
        startedAt: new Date("2026-09-01T00:00:00Z"), resolvedAt: null, rcaStatus: "none", description: "<a href=//evil>click</a>", impact: "",
        updates: undefined,
      },
    });
    await db.client.incidentUpdate.create({ data: { id: "u1", incidentId: "inc1", type: "note", content: "<iframe src=//evil>", createdAt: new Date("2026-09-01T01:00:00Z") } });
    const report = await generateReport("incident_report", { incidentId: "inc1", generatedByRole: "<lead>" });
    expect(report.html).not.toMatch(/<script>|<b>Vendor|<a href=\/\/evil|<iframe|onmouseover="x|<lead>/);
    expect(report.html).toContain("&lt;script&gt;");
  });
});

describe("URL-selected handlers use own keys only", () => {
  it("/api/metrics/[section] answers 404 for inherited names", async () => {
    vi.doMock("@/lib/auth-user", () => ({ requireAuth: vi.fn(async () => ({ id: "u", role: "admin", employeeId: "e" })) }));
    vi.doMock("@/lib/api/rate-limit-middleware", () => ({ checkRateLimit: () => null, RATE_LIMIT_PRESETS: { read: {} } }));
    const { GET } = await import("@/app/api/metrics/[section]/route");
    const { NextRequest } = await import("next/server");
    for (const section of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const res = await GET(new NextRequest(`http://localhost/api/metrics/${section}`), { params: Promise.resolve({ section }) });
      expect(res.status, section).toBe(404);
    }
    vi.doUnmock("@/lib/auth-user");
    vi.doUnmock("@/lib/api/rate-limit-middleware");
  });
});

describe("AES-GCM", () => {
  it("pins the authentication tag length and rejects a tampered tag", async () => {
    vi.stubEnv("ENCRYPTION_SECRET", "a-test-encryption-secret-that-is-at-least-32-chars-long");
    const { encrypt, decrypt } = await import("@/lib/encryption");
    const token = encrypt("client account 12345");
    expect(decrypt(token)).toBe("client account 12345");
    const raw = Buffer.from(token.replace(/^enc:/, ""), "base64");
    raw[raw.length - 1] ^= 0x01;
    expect(() => decrypt(`enc:${raw.toString("base64")}`)).toThrow();
    expect(fs.readFileSync("src/lib/encryption.ts", "utf8")).toMatch(/createDecipheriv\([^)]*authTagLength: AUTH_TAG_LENGTH/);
    vi.unstubAllEnvs();
  });
});

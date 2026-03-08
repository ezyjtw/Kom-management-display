/**
 * Feature flags tests — pure logic tests without database.
 */
import { describe, it, expect } from "vitest";

// Test the simpleHash function logic (extracted for testing)
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

describe("Feature Flags - Hash Function", () => {
  it("produces deterministic hashes", () => {
    const hash1 = simpleHash("user123feature_flag");
    const hash2 = simpleHash("user123feature_flag");
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = simpleHash("user123feature_a");
    const hash2 = simpleHash("user456feature_a");
    expect(hash1).not.toBe(hash2);
  });

  it("produces non-negative values", () => {
    const inputs = ["test1", "test2", "user@example.com", "very_long_feature_flag_name_12345"];
    for (const input of inputs) {
      expect(simpleHash(input)).toBeGreaterThanOrEqual(0);
    }
  });

  it("distributes reasonably across 100 buckets", () => {
    const buckets = new Array(100).fill(0);
    for (let i = 0; i < 1000; i++) {
      const hash = simpleHash(`user${i}test_flag`);
      buckets[hash % 100]++;
    }
    // Each bucket should have roughly 10 entries (±15 for reasonable distribution)
    const nonEmpty = buckets.filter((b) => b > 0).length;
    expect(nonEmpty).toBeGreaterThan(50); // At least 50% of buckets used
  });
});

describe("Feature Flags - JSON Array Parsing", () => {
  function safeParseJsonArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  it("parses valid JSON arrays", () => {
    expect(safeParseJsonArray('["admin","lead"]')).toEqual(["admin", "lead"]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(safeParseJsonArray("[]")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(safeParseJsonArray('{"key":"value"}')).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(safeParseJsonArray("not json")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(safeParseJsonArray("")).toEqual([]);
  });
});

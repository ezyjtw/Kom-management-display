/**
 * Exact amounts (review remediation): token quantities DECIMAL(38,18), USD
 * DECIMAL(20,2), decimal strings at the API boundary, no float arithmetic.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { absDiff, emptyAsUndefined, formatAmount, formatUsd, sum, tokenAmount, usdAmount } from "@/lib/decimal";

describe("amount input schemas", () => {
  it("token amounts keep all 18 decimal places exactly and reject more", () => {
    expect(tokenAmount().parse("0.000000000000000001")).toBe("0.000000000000000001");
    expect(tokenAmount().parse("123456789012345678.123456789012345678")).toBe("123456789012345678.123456789012345678");
    expect(tokenAmount().safeParse("0.0000000000000000001").success).toBe(false);
    expect(tokenAmount().safeParse("1e5").success).toBe(false);
    expect(tokenAmount().safeParse("abc").success).toBe(false);
  });

  it("USD amounts allow at most two decimals", () => {
    expect(usdAmount().parse("1000000.25")).toBe("1000000.25");
    expect(usdAmount().safeParse("10.255").success).toBe(false);
  });

  it("enforces sign rules and accepts legacy numbers", () => {
    expect(tokenAmount({ min: "nonNegative" }).safeParse("-1").success).toBe(false);
    expect(tokenAmount({ min: "positive" }).safeParse("0").success).toBe(false);
    expect(tokenAmount().parse(1.5)).toBe("1.5");
  });

  it("treats an empty form field as absent only where wrapped", () => {
    expect(emptyAsUndefined(usdAmount().optional()).parse("")).toBeUndefined();
    expect(usdAmount().safeParse("").success).toBe(false);
  });
});

describe("exact arithmetic and display", () => {
  it("adds and compares without float error", () => {
    expect(sum(["0.1", "0.2"]).toFixed()).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3); // why this matters
    expect(absDiff("50005", "50000").gt("1")).toBe(true);
    expect(absDiff("1.000000000000000001", "1").toFixed()).toBe("0.000000000000000001");
  });

  it("formats without going through a float (grouped, truncated, never rounded up)", () => {
    expect(formatAmount("1234567.123456789", 8)).toBe("1,234,567.12345678");
    expect(formatAmount("-0.5", 8)).toBe("-0.5");
    expect(formatAmount("99999999999999999999.999999999999999999", 18)).toBe("99,999,999,999,999,999,999.999999999999999999");
    expect(formatUsd("1234.5")).toBe("$1,234.50");
    expect(formatAmount(null)).toBe("—");
  });
});

describe("schema guard", () => {
  it("no amount, balance, USD or threshold field is a Float", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const floats = schema.split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\w+\s+Float\??(\s|$)/.test(l))
      .map((l) => l.split(/\s+/)[0])
      .filter((name) => /amount|balance|usd|fiat|exposure|threshold/i.test(name));
    expect(floats).toEqual([]);
  });

  it("migration 0038 converts all sixteen columns", () => {
    const sql = readFileSync("prisma/migrations/0038_decimal_amounts/migration.sql", "utf8");
    expect((sql.match(/TYPE DECIMAL\(38,18\)/g) ?? []).length).toBe(12);
    expect((sql.match(/TYPE DECIMAL\(20,2\)/g) ?? []).length).toBe(4);
  });
});

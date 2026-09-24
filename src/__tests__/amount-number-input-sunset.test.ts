/**
 * Review remediation: authoritative amounts are decimal strings. JSON numbers
 * are accepted (with a deprecation warning) only until the sunset date; after
 * it this test fails, so removing number support is a deliberate, reviewed change
 * rather than a runtime switch.
 */
import { describe, it, expect, vi } from "vitest";
import { NUMERIC_AMOUNT_INPUT_UNTIL, tokenAmount, usdAmount } from "@/lib/decimal";
import { logger } from "@/lib/logger";

describe("amount-number-input-sunset", () => {
  it("strings keep full precision", () => {
    expect(tokenAmount().parse("12.123456789123456789")).toBe("12.123456789123456789");
    expect(usdAmount().parse("1000000.10")).toBe("1000000.10");
  });

  it("numbers are still accepted before the sunset, with a deprecation warning", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    expect(usdAmount().parse(12.5)).toBe("12.5");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Deprecated: amount sent as a JSON number"), { until: NUMERIC_AMOUNT_INPUT_UNTIL });
    warn.mockRestore();
  });

  it(`number support is removed by ${NUMERIC_AMOUNT_INPUT_UNTIL}`, () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(today <= NUMERIC_AMOUNT_INPUT_UNTIL, `The sunset (${NUMERIC_AMOUNT_INPUT_UNTIL}) has passed: remove z.number() from decimalAmount in src/lib/decimal.ts and this date check.`).toBe(true);
  });
});

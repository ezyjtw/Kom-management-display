/**
 * Transaction confirmation flow tests.
 */
import { describe, it, expect } from "vitest";
import { assessRiskLevel } from "@/lib/transaction-confirmation";

describe("Transaction Risk Assessment", () => {
  it("classifies small inbound transactions as low risk", () => {
    const level = assessRiskLevel({ amount: 50_000, asset: "BTC", direction: "IN" });
    expect(level).toBe("low");
  });

  it("classifies outbound transactions as medium risk", () => {
    const level = assessRiskLevel({ amount: 50_000, asset: "BTC", direction: "OUT" });
    expect(level).toBe("medium");
  });

  it("classifies moderate amounts as medium risk", () => {
    const level = assessRiskLevel({ amount: 500_000, asset: "ETH", direction: "IN" });
    expect(level).toBe("medium");
  });

  it("classifies large transactions as high risk", () => {
    const level = assessRiskLevel({ amount: 5_000_000, asset: "BTC", direction: "OUT" });
    expect(level).toBe("high");
  });

  it("classifies aged transactions as high risk", () => {
    const level = assessRiskLevel({ amount: 10_000, asset: "USDC", direction: "IN", ageMinutes: 90 });
    expect(level).toBe("high");
  });

  it("classifies very large transactions as critical", () => {
    const level = assessRiskLevel({ amount: 15_000_000, asset: "BTC", direction: "OUT" });
    expect(level).toBe("critical");
  });

  it("classifies aged collateral operations as critical", () => {
    const level = assessRiskLevel({
      amount: 100_000,
      asset: "BTC",
      direction: "OUT",
      ageMinutes: 90,
      type: "COLLATERAL_OPERATION_ONCHAIN",
    });
    expect(level).toBe("critical");
  });

  it("handles edge case at low threshold boundary", () => {
    const level = assessRiskLevel({ amount: 100_000, asset: "BTC", direction: "IN" });
    expect(level).toBe("low");
  });

  it("handles edge case at medium threshold boundary", () => {
    const level = assessRiskLevel({ amount: 100_001, asset: "BTC", direction: "IN" });
    expect(level).toBe("medium");
  });

  it("handles edge case at high threshold boundary", () => {
    const level = assessRiskLevel({ amount: 1_000_001, asset: "BTC", direction: "IN" });
    expect(level).toBe("high");
  });

  it("handles edge case at critical threshold boundary", () => {
    const level = assessRiskLevel({ amount: 10_000_001, asset: "BTC", direction: "IN" });
    expect(level).toBe("critical");
  });
});

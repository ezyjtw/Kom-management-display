/**
 * logger-redacts-sensitive-fields (H8, spec §16).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { redactValue, redactString } from "@/lib/log-redaction";
import { logger } from "@/lib/logger";

const EVM = "0x52908400098527886E0F7030069857D2E4169EE7";
const HASH = "0x" + "ab".repeat(32);
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

afterEach(() => vi.restoreAllMocks());

describe("logger-redacts-sensitive-fields", () => {
  it("removes secrets by key", () => {
    const out = redactValue({ password: "hunter2", apiToken: "abc", authorization: "Bearer x", nested: { client_secret: "s" } }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect(out.apiToken).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).client_secret).toBe("[redacted]");
  });

  it("masks addresses, hashes, account numbers, client names and emails by key", () => {
    const out = redactValue({
      senderAddress: EVM,
      txHash: HASH,
      accountNos: ["ACC-1234567"],
      clientName: "Synthetic Client Ltd",
      email: "someone@example.com",
    }) as Record<string, unknown>;
    expect(out.senderAddress).not.toContain(EVM);
    expect(out.txHash).not.toContain(HASH);
    expect(out.accountNos).not.toEqual(["ACC-1234567"]);
    expect(out.clientName).not.toBe("Synthetic Client Ltd");
    expect(out.email).not.toBe("someone@example.com");
  });

  it("masks addresses and hashes wherever they appear in text", () => {
    const s = redactString(`sent to ${EVM} in ${HASH} and ${BTC}`);
    expect(s).not.toContain(EVM);
    expect(s).not.toContain(HASH);
    expect(s).not.toContain(BTC);
  });

  it("leaves ordinary values alone", () => {
    expect(redactValue({ requestId: "ab12cd34", count: 3, status: "PENDING" })).toEqual({ requestId: "ab12cd34", count: 3, status: "PENDING" });
  });

  it("is applied by the logger to messages and context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info(`withdrawal to ${EVM}`, { api_secret: "topsecret", walletAddress: EVM });
    const line = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).not.toContain(EVM);
    expect(line).not.toContain("topsecret");
  });

  it("masks IP addresses (by key and in text) and drops message bodies and location (spec §17.5)", () => {
    const out = redactValue({ ipAddress: "203.0.113.9", body: "Please move 5 BTC for Synthetic Client", bodySnippet: "hi", geolocation: { lat: 51.5 }, detail: "request from 198.51.100.23 failed" }) as Record<string, unknown>;
    expect(out.ipAddress).not.toBe("203.0.113.9");
    expect(out.body).toBe("[redacted]");
    expect(out.bodySnippet).toBe("[redacted]");
    expect(out.geolocation).toBe("[redacted]");
    expect(out.detail).not.toContain("198.51.100.23");
    expect(redactString("peer 2001:0db8:85a3:0000:0000:8a2e:0370:7334 closed")).not.toContain("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
  });
});

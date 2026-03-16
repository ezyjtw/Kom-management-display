import { describe, it, expect, vi } from "vitest";

// Mock logger before importing sanitize
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { sanitiseSlackMessage } from "@/lib/sanitize";
import { logger } from "@/lib/logger";

describe("sanitiseSlackMessage", () => {
  it("returns empty string for empty input", () => {
    expect(sanitiseSlackMessage("")).toBe("");
    expect(sanitiseSlackMessage(null as any)).toBe("");
    expect(sanitiseSlackMessage(undefined as any)).toBe("");
  });

  it("replaces user mentions with [mention]", () => {
    expect(sanitiseSlackMessage("Hey <@U123ABC> can you check this?")).toBe(
      "Hey [mention] can you check this?"
    );
  });

  it("replaces multiple user mentions", () => {
    expect(sanitiseSlackMessage("<@U123ABC> and <@U456DEF>")).toBe(
      "[mention] and [mention]"
    );
  });

  it("replaces channel references with [channel]", () => {
    expect(sanitiseSlackMessage("See <#C123|general> for details")).toBe(
      "See [channel] for details"
    );
  });

  it("replaces <!here> with [broadcast]", () => {
    expect(sanitiseSlackMessage("<!here> please review")).toBe(
      "[broadcast] please review"
    );
  });

  it("replaces <!channel> with [broadcast]", () => {
    expect(sanitiseSlackMessage("<!channel> urgent update")).toBe(
      "[broadcast] urgent update"
    );
  });

  it("replaces <!everyone> with [broadcast]", () => {
    expect(sanitiseSlackMessage("<!everyone> important")).toBe(
      "[broadcast] important"
    );
  });

  it("extracts display text from labelled URLs", () => {
    expect(sanitiseSlackMessage("Check <https://example.com|Example Site> now")).toBe(
      "Check Example Site now"
    );
  });

  it("replaces bare URLs with [link]", () => {
    expect(sanitiseSlackMessage("Visit <https://example.com> for info")).toBe(
      "Visit [link] for info"
    );
  });

  it("handles a mix of all formatting types", () => {
    const input = "<@U123> posted in <#C456|ops>: <!here> check <https://docs.com|docs> and <https://example.com>";
    const expected = "[mention] posted in [channel]: [broadcast] check docs and [link]";
    expect(sanitiseSlackMessage(input)).toBe(expected);
  });

  it("truncates messages longer than 4000 characters", () => {
    const longMessage = "a".repeat(5000);
    const result = sanitiseSlackMessage(longMessage);
    expect(result.length).toBe(4000);
    expect(logger.warn).toHaveBeenCalledWith("Slack message truncated", {
      originalLength: 5000,
    });
  });

  it("does not truncate messages at or under 4000 characters", () => {
    const message = "a".repeat(4000);
    const result = sanitiseSlackMessage(message);
    expect(result.length).toBe(4000);
  });

  it("trims whitespace", () => {
    expect(sanitiseSlackMessage("  hello world  ")).toBe("hello world");
  });

  it("preserves plain text", () => {
    expect(sanitiseSlackMessage("Just a normal message")).toBe("Just a normal message");
  });
});

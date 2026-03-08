/**
 * Thread utility tests.
 */
import { describe, it, expect } from "vitest";
import { normaliseSubject, deriveAutoPriority } from "@/lib/thread-utils";

describe("normaliseSubject", () => {
  it("strips multiple Re: prefixes", () => {
    expect(normaliseSubject("Re: Re: Re: Hello")).toBe("Re: Hello");
  });

  it("strips Fwd: prefixes", () => {
    expect(normaliseSubject("Fwd: FW: Important")).toBe("Important");
  });

  it("cleans Slack bold formatting", () => {
    expect(normaliseSubject("*urgent* matter")).toBe("urgent matter");
  });

  it("cleans Slack links", () => {
    expect(normaliseSubject("<https://example.com|Click here>")).toBe("Click here");
  });

  it("truncates long subjects", () => {
    const long = "A".repeat(300);
    const result = normaliseSubject(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("returns 'No Subject' for empty input", () => {
    expect(normaliseSubject("")).toBe("No Subject");
  });

  it("collapses whitespace", () => {
    expect(normaliseSubject("  hello   world  ")).toBe("hello world");
  });
});

describe("deriveAutoPriority", () => {
  it("detects P0 keywords", () => {
    expect(deriveAutoPriority({ subject: "OUTAGE: system down" })).toBe("P0");
    expect(deriveAutoPriority({ subject: "Security breach detected" })).toBe("P0");
    expect(deriveAutoPriority({ subject: "Production down" })).toBe("P0");
  });

  it("detects P1 keywords", () => {
    expect(deriveAutoPriority({ subject: "URGENT: need action" })).toBe("P1");
    expect(deriveAutoPriority({ subject: "Critical issue" })).toBe("P1");
    expect(deriveAutoPriority({ subject: "Please escalate" })).toBe("P1");
  });

  it("detects P2 keywords", () => {
    expect(deriveAutoPriority({ subject: "Important update needed" })).toBe("P2");
  });

  it("returns null for no match", () => {
    expect(deriveAutoPriority({ subject: "Regular weekly update" })).toBeNull();
  });

  it("checks body text too", () => {
    expect(deriveAutoPriority({ subject: "Hello", body: "This is urgent and critical" })).toBe("P1");
  });
});

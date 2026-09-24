import { describe, it, expect } from "vitest";
import { parseLicensedJurisdictions, licensedJurisdictionList } from "@/lib/licensed-jurisdictions";

describe("licensed jurisdictions are deployment configuration", () => {
  it("parses a comma-separated list", () => {
    expect([...parseLicensedJurisdictions(" UK, EU ,,")]).toEqual(["UK", "EU"]);
  });
  it("is empty when unset", () => {
    expect(parseLicensedJurisdictions(undefined).size).toBe(0);
    expect(licensedJurisdictionList(new Set())).toBe("none configured");
  });
});

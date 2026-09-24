/**
 * Spec §16.4: the Komainu API endpoints and response fields this app depends
 * on (§8.1) are present in the committed spec file.
 * TODO(CONFIRM-KOMAINU-OPENAPI): skipped until docs/phase1/komainu-openapi-1.6.0.json is committed.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { checkContract, type OpenApiDoc } from "@/lib/integrations/komainu-api/contract";

const SPEC = "docs/phase1/komainu-openapi-1.6.0.json";

describe("Komainu API contract", () => {
  it.skipIf(!existsSync(SPEC))("every allowlisted endpoint and every depended-on field is in the committed spec", () => {
    const doc = JSON.parse(readFileSync(SPEC, "utf8")) as OpenApiDoc;
    expect(checkContract(doc)).toEqual([]);
  });
});

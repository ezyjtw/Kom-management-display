/**
 * Phase 1 acceptance: prod-has-no-credentials-provider (spec §6.2).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildProviders } from "@/lib/auth-options";

const AZURE = {
  AZURE_AD_TENANT_ID: "tenant",
  AZURE_AD_CLIENT_ID: "client",
  AZURE_AD_CLIENT_SECRET: "secret",
};

const ids = (cfg: Parameters<typeof buildProviders>[0]) => buildProviders(cfg).map((p) => p.id);

describe("prod-has-no-credentials-provider", () => {
  it("production never registers the credentials provider, even with ALLOW_LOCAL_LOGIN=true", () => {
    expect(ids({ NODE_ENV: "production", ALLOW_LOCAL_LOGIN: "true", ...AZURE })).toEqual(["azure-ad"]);
    expect(ids({ NODE_ENV: "production", ALLOW_LOCAL_LOGIN: "true" })).toEqual([]);
  });

  it("non-production registers credentials only with ALLOW_LOCAL_LOGIN=true", () => {
    expect(ids({ NODE_ENV: "development" })).not.toContain("credentials");
    expect(ids({ NODE_ENV: "development", ALLOW_LOCAL_LOGIN: "false" })).not.toContain("credentials");
    expect(ids({ NODE_ENV: "development", ALLOW_LOCAL_LOGIN: "true" })).toContain("credentials");
  });

  it("registers Azure AD only when tenant, client id and secret are all set", () => {
    expect(ids({ NODE_ENV: "production", ...AZURE })).toEqual(["azure-ad"]);
    expect(ids({ NODE_ENV: "production", ...AZURE, AZURE_AD_CLIENT_SECRET: "" })).toEqual([]);
  });
});

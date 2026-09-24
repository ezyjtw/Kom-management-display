/**
 * Demo tier and go-live path (Phase 12j). A production build is the production
 * tier unless KOM_ENVIRONMENT=demo names the demo tier; only then may secrets
 * come from environment variables and local login be switched on. Production
 * stays strict and the go-live check refuses anything short of live.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { deploymentTier } from "@/lib/deployment-tier";
import { loadSecrets } from "@/lib/secrets";
import { isLocalLoginAllowed } from "@/lib/sso";
import { buildProviders } from "@/lib/auth-options";
import { configChecks } from "../../scripts/go-live-check";

describe("deployment tier", () => {
  it("a production build is production unless the demo tier is named", () => {
    expect(deploymentTier({ NODE_ENV: "production" })).toBe("production");
    expect(deploymentTier({ NODE_ENV: "production", KOM_ENVIRONMENT: "demo" })).toBe("demo");
    expect(deploymentTier({ NODE_ENV: "production", KOM_ENVIRONMENT: "development" })).toBe("production"); // cannot relax by another name
    expect(deploymentTier({ NODE_ENV: "production", KOM_ENVIRONMENT: "prod" })).toBe("production");
    expect(deploymentTier({ NODE_ENV: "development" })).toBe("development");
    expect(deploymentTier({ NODE_ENV: "development", KOM_ENVIRONMENT: "production" })).toBe("production");
  });

  it("demo may take secrets from environment variables; production may not", () => {
    const demo = loadSecrets({ NODE_ENV: "production", KOM_ENVIRONMENT: "demo", NEXTAUTH_SECRET: "x".repeat(32) });
    expect(demo.source).toBe("environment");
    expect(demo.values.NEXTAUTH_SECRET).toBe("x".repeat(32));
    const prod = loadSecrets({ NODE_ENV: "production", NEXTAUTH_SECRET: "x".repeat(32) });
    expect(prod.source).toBe("secrets_dir");
    expect(prod.leakedEnvKeys).toEqual(["NEXTAUTH_SECRET"]);
  });

  it("local login only outside the production tier, and only when switched on", () => {
    expect(isLocalLoginAllowed("production", "true")).toBe(false);
    expect(isLocalLoginAllowed("production", "true", "demo")).toBe(true);
    expect(isLocalLoginAllowed("production", undefined, "demo")).toBe(false);
    const ids = (cfg: Parameters<typeof buildProviders>[0]) => buildProviders(cfg).map((p) => p.id);
    expect(ids({ NODE_ENV: "production", ALLOW_LOCAL_LOGIN: "true" })).toEqual([]);
    expect(ids({ NODE_ENV: "production", KOM_ENVIRONMENT: "demo", ALLOW_LOCAL_LOGIN: "true" })).toEqual(["credentials"]);
  });

  it("the seed marks the database as demo data, and a production start refuses it", () => {
    expect(fs.readFileSync("prisma/seed.ts", "utf8")).toMatch(/key: "system\.dataOrigin"/);
    const start = fs.readFileSync("start.sh", "utf8");
    expect(start).toMatch(/KOM_ENVIRONMENT}" = "demo"/);
    expect(start).toMatch(/holds demo \(seeded\) data and the tier is production/);
    expect(start).toMatch(/if \[ "\$\{TIER\}" = "production" \]; then[\s\S]*Skipping seed \(never seeds in production\)/);
  });

  it("every page shows a DEMO banner in the demo tier", () => {
    expect(fs.readFileSync("src/app/layout.tsx", "utf8")).toMatch(/deploymentTier\(\) === "demo" && \([\s\S]*data-testid="demo-banner"/);
  });
});

describe("go-live check (configuration)", () => {
  const files = (values: Record<string, string>) => () => ({ source: "secrets_dir" as const, dir: "/mnt/secrets", values, leakedEnvKeys: [] });
  const liveSecrets = { NEXTAUTH_SECRET: "s", AZURE_AD_CLIENT_SECRET: "s", ATLASSIAN_API_TOKEN: "s", CONFLUENCE_API_TOKEN: "s", SLACK_BOT_TOKEN: "s", SLACK_SIGNING_SECRET: "s", GRAPH_CLIENT_SECRET: "s", JIRA_WEBHOOK_SECRET: "s", KOMAINU_API_SECRET: "s" };
  const liveEnv = {
    NODE_ENV: "production", KOM_ENVIRONMENT: "production", NEXTAUTH_URL: "https://kom.example",
    AZURE_AD_TENANT_ID: "t", AZURE_AD_CLIENT_ID: "c", ROLE_GROUP_MAP: '{"g":"admin"}',
    KOMAINU_API_BASE_URL: "https://api.custody.example", KOMAINU_API_USER: "u",
    ATLASSIAN_EMAIL: "svc@k", CONFLUENCE_EMAIL: "svc@k", SLACK_CHANNELS: "C1",
    GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c", GRAPH_MAILBOXES: "[]",
  };
  const failing = (checks: ReturnType<typeof configChecks>) => checks.filter((c) => c.status === "FAIL").map((c) => c.item);

  it("passes a fully connected production configuration", () => {
    expect(failing(configChecks(liveEnv, files(liveSecrets)))).toEqual([]);
  });

  it("fails the demo tier, env-var secrets, local login, seeding and missing integrations", () => {
    const demo = configChecks({ ...liveEnv, KOM_ENVIRONMENT: "demo", ALLOW_LOCAL_LOGIN: "true", ALLOW_SEED: "true", SLACK_CHANNELS: "" }, files(liveSecrets));
    expect(failing(demo)).toEqual(expect.arrayContaining([
      "Deployment tier is production",
      "Local username/password login is off",
      "Seeding is off (ALLOW_SEED)",
      "Slack: bot token, signing secret and channels",
    ]));
    const envSecrets = configChecks(liveEnv, () => ({ source: "environment" as const, dir: null, values: liveSecrets, leakedEnvKeys: ["SLACK_BOT_TOKEN"] }));
    expect(failing(envSecrets)).toEqual(expect.arrayContaining(["Secrets are read from SECRETS_DIR (Key Vault files), not environment variables", "No secret-bearing environment variables"]));
    const demoApi = configChecks({ ...liveEnv, KOMAINU_API_BASE_URL: "https://api-demo.komainu.io" }, files(liveSecrets));
    expect(failing(demoApi)).toEqual(["Komainu API base URL is not the demo host"]);
  });
});

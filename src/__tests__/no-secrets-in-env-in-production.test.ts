/**
 * Spec §17.3 / §17.10: secrets are read from mounted files (SECRETS_DIR), and
 * secret-bearing environment variables are absent when SECRETS_DIR is set.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as mod from "@/lib/env";
import { loadSecrets, readSecretsDir, isSecretKey, nonSecretEnv, SECRET_KEYS } from "@/lib/secrets";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kom-secrets-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  mod.__resetEnvForTests();
});

const BASE = { NODE_ENV: "production", DATABASE_URL: "postgresql://app@db/kom", NEXTAUTH_URL: "https://kom.example.test" };

describe("no-secrets-in-env-in-production", () => {
  it("reads each secret from a file named after the config key, trimming the trailing newline", () => {
    fs.writeFileSync(path.join(dir, "NEXTAUTH_SECRET"), "a-long-enough-signing-secret\n");
    fs.writeFileSync(path.join(dir, "KOMAINU_API_SECRET_OPS"), "per-user-secret");
    fs.writeFileSync(path.join(dir, "README"), "not a secret key");
    fs.mkdirSync(path.join(dir, "..data"));
    expect(readSecretsDir(dir)).toEqual({
      NEXTAUTH_SECRET: "a-long-enough-signing-secret",
      KOMAINU_API_SECRET_OPS: "per-user-secret",
    });
  });

  it("production uses the secrets directory, never environment variables", () => {
    fs.writeFileSync(path.join(dir, "SLACK_BOT_TOKEN"), "from-file");
    const s = loadSecrets({ ...BASE, SECRETS_DIR: dir, SLACK_BOT_TOKEN: "from-env" });
    expect(s.source).toBe("secrets_dir");
    expect(s.values.SLACK_BOT_TOKEN).toBe("from-file");
    expect(s.leakedEnvKeys).toEqual(["SLACK_BOT_TOKEN"]);
  });

  it("production defaults to /mnt/secrets when SECRETS_DIR is unset", () => {
    const s = loadSecrets({ ...BASE });
    expect(s.source).toBe("secrets_dir");
    expect(s.dir).toBe("/mnt/secrets");
  });

  it("development without SECRETS_DIR falls back to the environment", () => {
    const s = loadSecrets({ NODE_ENV: "development", ATLASSIAN_API_TOKEN: "dev-token" });
    expect(s.source).toBe("environment");
    expect(s.values.ATLASSIAN_API_TOKEN).toBe("dev-token");
  });

  it("strips secret keys from the environment view passed to validation", () => {
    const view = nonSecretEnv({ ...BASE, NEXTAUTH_SECRET: "x", SLACK_CHANNELS: "C1" });
    expect(view.NEXTAUTH_SECRET).toBeUndefined();
    expect(view.SLACK_CHANNELS).toBe("C1");
  });

  it("classifies every credential in the env schema as a secret", () => {
    const envSource = fs.readFileSync("src/lib/env.ts", "utf8");
    const keys = [...envSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    const credentialLike = keys.filter((k) => /(SECRET|TOKEN|PASSWORD|API_KEY)$/.test(k) && k !== "SECRETS_DIR");
    expect(credentialLike.length).toBeGreaterThan(10);
    for (const k of credentialLike) expect(isSecretKey(k), k).toBe(true);
    for (const k of SECRET_KEYS) expect(keys, k).toContain(k);
  });

  it("env() fails startup in production when a secret arrives as an environment variable", async () => {
    fs.writeFileSync(path.join(dir, "NEXTAUTH_SECRET"), "a-long-enough-signing-secret");
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    vi.stubEnv("SECRETS_DIR", dir);
    vi.stubEnv("SLACK_BOT_TOKEN", "leaked");
    mod.__resetEnvForTests();
    expect(() => mod.getEnv()).toThrow(/SLACK_BOT_TOKEN: secret-bearing environment variable/);
    mod.__resetEnvForTests();
  });

  it("env() serves secrets from files and does not copy them into process.env", async () => {
    fs.writeFileSync(path.join(dir, "NEXTAUTH_SECRET"), "a-long-enough-signing-secret");
    fs.writeFileSync(path.join(dir, "KOMAINU_API_SECRET_OPS"), "per-user-secret");
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    vi.stubEnv("SECRETS_DIR", dir);
    vi.stubEnv("NEXTAUTH_SECRET", "");
    mod.__resetEnvForTests();
    expect(mod.env("NEXTAUTH_SECRET")).toBe("a-long-enough-signing-secret");
    expect(mod.secret("KOMAINU_API_SECRET_OPS")).toBe("per-user-secret");
    expect(process.env.KOMAINU_API_SECRET_OPS).toBeUndefined();
    expect(mod.secretSourceInfo()?.keys).toEqual(["KOMAINU_API_SECRET_OPS", "NEXTAUTH_SECRET"]);
    mod.__resetEnvForTests();
  });

  it("no application code reads a secret straight from process.env", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "tests") continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(p, "utf8");
          for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (isSecretKey(m[1])) offenders.push(`${p}: ${m[1]}`);
          if (/process\.env\[/.test(src) && !p.endsWith(path.join("lib", "secrets.ts"))) offenders.push(`${p}: dynamic process.env[...] lookup`);
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});

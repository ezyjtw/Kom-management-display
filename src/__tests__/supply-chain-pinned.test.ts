/**
 * Spec §17.6: actions pinned by commit SHA, read-only workflow tokens, base
 * image pinned by digest, CODEOWNERS on the sensitive paths, dependency
 * updates configured, and the scans present in CI.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const workflows = fs.readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ f, src: fs.readFileSync(path.join(".github/workflows", f), "utf8") }));

describe("supply-chain-pinned", () => {
  it("every action is pinned to a full commit SHA, with the tag in a comment", () => {
    const bad: string[] = [];
    for (const { f, src } of workflows) {
      for (const m of src.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(\s*#\s*\S+)?/gm)) {
        const [, ref, comment] = m;
        if (ref.startsWith("./")) continue;
        if (!/@[0-9a-f]{40}$/.test(ref) || !comment) bad.push(`${f}: ${ref}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every workflow sets a read-only default token", () => {
    for (const { f, src } of workflows) expect(src, f).toMatch(/^permissions:\n\s+contents: read/m);
  });

  it("checkouts do not persist the token", () => {
    for (const { f, src } of workflows) {
      const checkouts = src.match(/uses: actions\/checkout@/g)?.length ?? 0;
      const noPersist = src.match(/persist-credentials: false/g)?.length ?? 0;
      expect(noPersist, f).toBe(checkouts);
    }
  });

  it("the production base image is pinned by digest and matches .nvmrc", () => {
    const docker = fs.readFileSync("Dockerfile", "utf8");
    const nvmrc = fs.readFileSync(".nvmrc", "utf8").trim();
    expect(docker).toMatch(new RegExp(`ARG NODE_IMAGE=node:${nvmrc}-alpine@sha256:[0-9a-f]{64}`));
    for (const m of docker.matchAll(/^FROM\s+(\S+)/gm)) expect(m[1]).toBe("${NODE_IMAGE}");
  });

  it("CI runs SCA, secret detection, SAST, image scanning, SBOM and the blocking drift check", () => {
    const ci = workflows.find((w) => w.f === "ci.yml")!.src;
    expect(ci).toContain("npm audit --omit=dev");
    expect(ci).toContain("detect-secrets-hook --baseline .secrets.baseline");
    expect(ci).toContain("aquasecurity/trivy-action@");
    expect(ci).toContain("npm run sbom");
    expect(ci).toContain("scripts/check-migration-drift.ts");
    expect(ci).not.toMatch(/::warning::Migration drift/);
    expect(workflows.some((w) => /github\/codeql-action\/analyze@/.test(w.src))).toBe(true);
    expect(fs.existsSync(".secrets.baseline")).toBe(true);
    expect(fs.existsSync("prisma/drift-baseline.sql")).toBe(true);
  });

  it("CODEOWNERS covers the paths the spec names, and Dependabot tracks npm, actions and docker", () => {
    const owners = fs.readFileSync(".github/CODEOWNERS", "utf8");
    for (const p of ["/src/lib/integrations/", "/src/modules/auth/", "/src/worker/", "/deploy/"]) expect(owners).toMatch(new RegExp(`^${p.replace(/\//g, "\\/")}\\s+@\\S+`, "m"));
    const dependabot = fs.readFileSync(".github/dependabot.yml", "utf8");
    for (const eco of ["npm", "github-actions", "docker"]) expect(dependabot).toContain(`package-ecosystem: ${eco}`);
  });
});

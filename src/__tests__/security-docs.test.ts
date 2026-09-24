/**
 * Spec §17.10: the security documents exist and are not placeholders, and
 * they stay true to the code (every model inventoried, every Slack method's
 * scope listed, every cited test real, the CONFIRM register current).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const DOCS: Record<string, string[]> = {
  "docs/phase1/threat-model.md": ["STRIDE", "Abuse case", "Break-glass", "Reviewed exceptions", "Review route"],
  "docs/phase1/data-inventory.md": ["Classification", "Retention", "Owners"],
  "docs/phase1/credentials.md": ["Rotation", "Blast radius", "revoke first"],
  "docs/phase1/logging.md": ["Application log schema", "Audit log schema", "Redaction", "Source onboarding"],
  "docs/phase1/slack-scopes.md": ["Bot token scopes", "Not requested"],
};

const read = (f: string) => fs.readFileSync(f, "utf8");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "tests" ? [] : sourceFiles(f);
    return /\.(ts|tsx)$/.test(e.name) ? [f] : [];
  });
}

describe("security documents (spec §17.10)", () => {
  for (const [file, sections] of Object.entries(DOCS)) {
    it(`${file} exists, is substantial and is not a placeholder`, () => {
      expect(fs.existsSync(file)).toBe(true);
      const text = read(file);
      expect(text.split(/\s+/).length, file).toBeGreaterThan(300);
      expect(text).not.toMatch(/\b(lorem ipsum|placeholder document|to be written|TBD)\b/i);
      for (const s of sections) expect(text.toLowerCase(), `${file}: section "${s}"`).toContain(s.toLowerCase());
    });
  }

  it("data-inventory-covers-every-model", () => {
    const models = [...read("prisma/schema.prisma").matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    const inventory = read("docs/phase1/data-inventory.md");
    expect(models.filter((m) => !new RegExp(`\\b${m}\\b`).test(inventory))).toEqual([]);
  });

  it("slack-scopes-documented: every Slack Web API method the code calls is listed", () => {
    const methods = new Set<string>();
    for (const f of sourceFiles("src")) {
      const src = read(f);
      for (const m of src.matchAll(/\.(conversations|chat|users|reactions|files|pins|views|usergroups|team)\.([a-zA-Z]+)\(/g)) {
        if (/getSlackClient|WebClient|slack/i.test(src)) methods.add(`${m[1]}.${m[2]}`);
      }
      for (const m of src.matchAll(/slack\.com\/api\/([a-z]+\.[a-zA-Z]+)/g)) methods.add(m[1]);
    }
    const doc = read("docs/phase1/slack-scopes.md");
    expect(methods.size).toBeGreaterThan(3);
    expect([...methods].filter((m) => !doc.includes(m)).sort()).toEqual([]);
  });

  it("every test the threat model cites exists", () => {
    const cited = [...read("docs/phase1/threat-model.md").matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map((m) => m[1]);
    const testFiles = fs.readdirSync("src/__tests__", { recursive: true }).map(String);
    const tests = new Set(testFiles.map((f) => path.basename(f).replace(/\.test\.tsx?$/, "")));
    const testSources = testFiles.filter((f) => f.endsWith(".ts")).map((f) => read(path.join("src/__tests__", f))).join("\n");
    const missing = cited.filter((c) => /-/.test(c) && !tests.has(c) && !testSources.includes(c) && !fs.existsSync(`docs/phase1/${c}.md`));
    expect(missing).toEqual([]);
  });

  it("confirm-register-current: the CONFIRM register lists every marker in the code", async () => {
    const { render } = await import("../../scripts/confirm-register");
    expect(read("docs/phase1/confirm-register.md")).toBe(render().markdown);
  });

  it("the compliance framework no longer claims controls the code does not have", () => {
    const text = read("docs/compliance-audit-framework.md");
    expect(text).not.toMatch(/Settlement cannot complete without both maker and checker/);
    expect(text).not.toMatch(/Railway PaaS|railway\.toml configuration/);
    expect(text).not.toMatch(/`ApprovalAuditEntry` model\./);
    expect(text).not.toMatch(/24-hour (JWT )?expiry/);
    expect(fs.existsSync("deploy/legacy/railway.toml")).toBe(false);
  });
});

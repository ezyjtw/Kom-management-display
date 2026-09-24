/**
 * Spec §16.9 "template parse": the synthetic page built from the template
 * headings parses into the expected change items; blank rows are ignored.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { jiraKeysIn, markdownToBlocks, parseReleaseNotes, rowHashOf, sprintFromTitle, storageToBlocks } from "@/modules/gx-sprints/parse";

const md = readFileSync("src/__tests__/fixtures/synthetic/CONFIRM-GX-RELEASE-SAMPLE.md", "utf8");

describe("release-notes parsing", () => {
  const notes = parseReleaseNotes(markdownToBlocks(md));
  const byType = (t: string) => notes.rows.filter((r) => r.itemType === t);

  it("finds each template section and ignores blank template rows", () => {
    expect(byType("function_toggle")).toHaveLength(1);
    expect(byType("ui_change")).toHaveLength(2);
    expect(byType("api_change")).toHaveLength(1);
    expect(byType("permission_change")).toHaveLength(1);
    expect(byType("staking_change")).toHaveLength(1);
    expect(byType("risk_engine_change")).toHaveLength(1);
    expect(byType("technical_change")).toHaveLength(2); // the blank "Core file changes" row is ignored
    expect(byType("highlight")).toHaveLength(4);
    expect(byType("deployment_note")).toHaveLength(2);
    expect(notes.rows).toHaveLength(15);
  });

  it("reads metadata from JIRA Versions & Artifacts without making items", () => {
    expect(notes.fixVersions).toEqual(["9.99.0-alpha.1", "9.99.0-rc.1"]);
    expect(notes.prodPlannedAt?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("keeps the row cell by cell, with summary, environment and Jira keys", () => {
    const toggle = byType("function_toggle")[0];
    expect(toggle.cells).toMatchObject({ Function: "Bulk withdrawal limits", "Ops PIC": "Ann Operator" });
    expect(toggle.summary).toBe("Bulk withdrawal limits");
    expect(toggle.gxJiraKeys).toEqual(["GXD-1201"]);
    const [ops, client] = byType("ui_change");
    expect(ops.env).toBe("UAT");
    expect(client.env).toBe("both");
    expect(byType("risk_engine_change")[0].gxJiraKeys).toEqual(["AMTK-88"]);
  });

  it("redacts release engineer names and drops GitHub links", () => {
    const api = byType("api_change")[0];
    expect(api.cells["Release Engineer"]).toBe("[redacted]");
    expect(api.text).not.toContain("Engineer Person");
    expect(api.cells.Description).not.toContain("github.com");
  });

  it("row hashes are stable and ignore redacted columns and whitespace", () => {
    const a = rowHashOf("S", { Function: "X  y", "Release Engineer": "A" });
    expect(rowHashOf("S", { Function: "x y", "Release Engineer": "B" })).toBe(a);
    expect(rowHashOf("S", { Function: "x z" })).not.toBe(a);
  });

  it("reads the same structure from Confluence storage format", () => {
    const html = `<h2>1.1 Function Released (but disabled or recently enabled in PROD)</h2>
      <table><tbody><tr><th><p>Function</p></th><th><p>Ops Testing Status</p></th><th><p>Ops PIC</p></th><th><p>Comments</p></th></tr>
      <tr><td><p>Bulk withdrawal limits</p></td><td><p>Not started</p></td><td><p>Ann Operator</p></td><td><p>Disabled &amp; pending <ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">GXD-1201</ac:parameter></ac:structured-macro></p></td></tr>
      <tr><td><br/></td><td></td><td></td><td></td></tr></tbody></table>
      <h3>2.2.1 This release specific instruction</h3><ul><li><p>Columns renamed in analytics.Account</p></li></ul>`;
    const parsed = parseReleaseNotes(storageToBlocks(html));
    expect(parsed.rows.map((r) => r.itemType)).toEqual(["function_toggle", "deployment_note"]);
    expect(parsed.rows[0].cells.Comments).toBe("Disabled & pending GXD-1201");
    expect(parsed.rows[0].gxJiraKeys).toEqual(["GXD-1201"]);
    expect(parsed.rows[1].cells.Instruction).toBe("Columns renamed in analytics.Account");
  });

  it("sprint number from the page title; Jira keys exclude non-Jira tokens", () => {
    expect(sprintFromTitle("[GX-Orchestrate] Sprint 6.19 Release Notes")).toBe("6.19");
    expect(sprintFromTitle("[GX-Orchestrate] Sprint X.XX Release Notes – Template")).toBeNull();
    expect(jiraKeysIn("see GXS-12, SHA-256 and UTF-8, AMTK-7")).toEqual(["GXS-12", "AMTK-7"]);
  });
});

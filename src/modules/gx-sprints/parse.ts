/**
 * Release-notes parsing (spec §16.2). The notes follow the fixed template
 * "[GX-Orchestrate] Sprint X.XX Release Notes – Template"; they are parsed
 * by heading and table. Blank template rows are ignored, release engineer
 * names are redacted, GitHub links are not followed (or kept).
 *
 * Two front ends produce the same block list: Confluence storage format
 * (XHTML) and Markdown (the synthetic fixture).
 */

import { createHash } from "node:crypto";

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "text"; text: string };

export type ItemType =
  | "function_toggle" | "ui_change" | "api_change" | "permission_change" | "staking_change"
  | "risk_engine_change" | "technical_change" | "highlight" | "deployment_note";

export interface ParsedRow {
  section: string;
  itemType: ItemType;
  cells: Record<string, string>;
  text: string;
  summary: string;
  firstCell: string;
  env: string;
  gxJiraKeys: string[];
  rowHash: string;
}

export interface ParsedNotes {
  rows: ParsedRow[];
  fixVersions: string[];
  prodPlannedAt: Date | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const clean = (s: string) => decode(s).replace(/\s+/g, " ").trim();

/** Confluence storage format (XHTML) to blocks: headings, tables and paragraph/list text. */
export function storageToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const tag = /<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let heading: { level: number; text: string } | null = null;
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let cell: string | null = null;
  let para: string | null = null;
  let tableDepth = 0;
  const pushText = (t: string) => {
    if (cell !== null) cell += t;
    else if (heading) heading.text += t;
    else if (para !== null) para += t;
  };
  for (const m of html.matchAll(tag)) {
    if (m[0].startsWith("<![CDATA[")) {
      pushText(m[0]);
      continue;
    }
    if (m[5] !== undefined) {
      pushText(m[5]);
      continue;
    }
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosing = m[4] === "/";
    if (/^h[1-6]$/.test(name)) {
      if (!closing) heading = { level: Number(name[1]), text: "" };
      else if (heading) {
        blocks.push({ kind: "heading", level: heading.level, text: clean(heading.text) });
        heading = null;
      }
      continue;
    }
    if (name === "table") {
      if (!closing) {
        tableDepth++;
        if (tableDepth === 1) table = [];
      } else {
        tableDepth--;
        if (tableDepth === 0 && table) {
          blocks.push({ kind: "table", rows: table });
          table = null;
        }
      }
      continue;
    }
    if (tableDepth > 1) continue; // nested tables are flattened into the outer cell's text
    if (name === "tr" && table) {
      if (!closing) row = [];
      else if (row) {
        table.push(row);
        row = null;
      }
      continue;
    }
    if ((name === "td" || name === "th") && row) {
      if (!closing && !selfClosing) cell = "";
      else if (closing && cell !== null) {
        row.push(clean(cell));
        cell = null;
      }
      continue;
    }
    if (name === "br" || (name === "p" && closing && cell !== null) || (name === "li" && closing && cell !== null)) {
      pushText(" ");
      continue;
    }
    if ((name === "p" || name === "li") && !table) {
      if (!closing) para = "";
      else if (para !== null) {
        const text = clean(para);
        if (text) blocks.push({ kind: "text", text });
        para = null;
      }
    }
  }
  return blocks;
}

/** Markdown (the synthetic fixture) to blocks. */
export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let table: string[][] | null = null;
  const flush = () => {
    if (table) blocks.push({ kind: "table", rows: table });
    table = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      (table ??= []).push(cells);
      continue;
    }
    flush();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) blocks.push({ kind: "heading", level: h[1].length, text: h[2].trim() });
    else if (line && !line.startsWith(">")) blocks.push({ kind: "text", text: line.replace(/^[-*]\s+|^\d+\.\s+/, "") });
  }
  flush();
  return blocks;
}

const SECTIONS: Array<[RegExp, ItemType | "metadata"]> = [
  [/function released/i, "function_toggle"],
  [/new screens/i, "ui_change"],
  [/new api/i, "api_change"],
  [/changes in permission/i, "permission_change"],
  [/stake\s*\/\s*unstake/i, "staking_change"],
  [/risk engine/i, "risk_engine_change"],
  [/important version changes|core file changes/i, "technical_change"],
  [/major highlights/i, "highlight"],
  [/release specific instruction/i, "deployment_note"],
  [/jira versions/i, "metadata"],
];

export function sectionType(heading: string): ItemType | "metadata" | null {
  return SECTIONS.find(([re]) => re.test(heading))?.[1] ?? null;
}

/** Columns holding release engineer names: not needed for UAT, redacted before storage. */
const REDACT_COLUMN = /release engineer|\bengineer\b|developer|deployed by|dev\s*pic|devops/i;
const JIRA_KEY = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const NOT_JIRA = /^(SHA|ISO|UTF|RFC|AES|TLS|SSL|CVE|ERC|BIP|EIP|HTTP|X)-/;
const SUMMARY_COLUMNS = [/^function/i, /^screen/i, /^api|endpoint/i, /^deliverable/i, /^description/i, /^instruction/i, /^impacted functions/i];

export function jiraKeysIn(text: string): string[] {
  return [...new Set((text.match(JIRA_KEY) ?? []).filter((k) => !NOT_JIRA.test(k)))];
}

export function rowHashOf(section: string, cells: Record<string, string>): string {
  const normalised = Object.entries(cells)
    .filter(([h]) => !REDACT_COLUMN.test(h))
    .map(([h, v]) => `${h.toLowerCase().trim()}=${v.toLowerCase().replace(/\s+/g, " ").trim()}`)
    .join("|");
  return createHash("sha256").update(`${section.toLowerCase().trim()}::${normalised}`).digest("hex").slice(0, 32);
}

function envOf(cells: Record<string, string>): string {
  const v = Object.entries(cells).find(([h]) => /uat\s*\/\s*prod|environment|^env/i.test(h))?.[1] ?? "";
  const hasUat = /uat/i.test(v);
  const hasProd = /prod/i.test(v);
  return hasUat && hasProd ? "both" : hasUat ? "UAT" : hasProd ? "PROD" : "";
}

function toRow(section: string, itemType: ItemType, cells: Record<string, string>): ParsedRow {
  for (const h of Object.keys(cells)) if (REDACT_COLUMN.test(h) && cells[h]) cells[h] = "[redacted]";
  // GitHub links are out of scope: dropped from stored text.
  for (const h of Object.keys(cells)) cells[h] = cells[h].replace(/https?:\/\/(www\.)?github\.com\/\S+/gi, "[GitHub link removed]");
  const values = Object.values(cells);
  const text = Object.entries(cells).filter(([h]) => !REDACT_COLUMN.test(h)).map(([h, v]) => `${h}: ${v}`).join("; ");
  const firstCell = values.find((v) => v) ?? "";
  const summaryCol = SUMMARY_COLUMNS.map((re) => Object.keys(cells).find((h) => re.test(h) && cells[h])).find(Boolean);
  const summary = (summaryCol ? cells[summaryCol] : firstCell).slice(0, 200);
  return { section, itemType, cells, text, summary, firstCell, env: envOf(cells), gxJiraKeys: jiraKeysIn(text), rowHash: rowHashOf(section, cells) };
}

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDate(text: string): Date | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  if (m[1]) return new Date(`${m[1]}T00:00:00Z`);
  return new Date(Date.UTC(Number(m[4]), MONTHS.indexOf(m[3].toLowerCase().slice(0, 3)), Number(m[2])));
}

export function parseReleaseNotes(blocks: Block[]): ParsedNotes {
  const rows: ParsedRow[] = [];
  const fixVersions = new Set<string>();
  let prodPlannedAt: Date | null = null;
  let section: string | null = null;
  let type: ItemType | "metadata" | null = null;
  for (const b of blocks) {
    if (b.kind === "heading") {
      const t = sectionType(b.text);
      // Sub-headings without their own mapping keep the enclosing section.
      if (t || b.level <= 2) {
        section = b.text;
        type = t;
      }
      continue;
    }
    if (!type || !section) continue;
    if (b.kind === "text") {
      if (type === "deployment_note") rows.push(toRow(section, type, { Instruction: b.text }));
      continue;
    }
    const [header, ...body] = b.rows;
    if (!header) continue;
    const headers = header.map((h, i) => h || `Column ${i + 1}`);
    for (const r of body) {
      if (r.every((c) => !c.trim())) continue; // blank template row
      const cells: Record<string, string> = {};
      headers.forEach((h, i) => { cells[h] = (r[i] ?? "").trim(); });
      if (type === "metadata") {
        for (const v of Object.values(cells)) for (const fv of v.match(/\b\d+\.\d+\.\d+-(?:alpha|rc)\.\d+\b/g) ?? []) fixVersions.add(fv);
        const prodCell = Object.entries(cells).find(([h, v]) => /prod/i.test(h) || /prod/i.test(v));
        // TODO(CONFIRM-GX-RELEASE-SAMPLE): where the planned PROD date sits in the Versions & Artifacts table.
        if (prodCell) prodPlannedAt = parseDate(Object.values(cells).join(" ")) ?? prodPlannedAt;
        continue;
      }
      rows.push(toRow(section, type, cells));
    }
  }
  return { rows, fixVersions: [...fixVersions], prodPlannedAt };
}

/** Sprint number from a page title like "[GX-Orchestrate] Sprint 6.19 Release Notes". */
export function sprintFromTitle(title: string): string | null {
  return /sprint\s+(\d+\.\d+)\s+release notes/i.exec(title)?.[1] ?? null;
}

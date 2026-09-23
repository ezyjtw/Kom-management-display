/**
 * Import-based sources for Phase 1 (spec §8.6). Each template is built from a
 * real export; until then it is listed with its CONFIRM blocker and uploads
 * are refused. No parser is guessed.
 *
 * Filenames are checked before anything else (spec §12 CHK-09, CF-22: the
 * existing macro fails silently on a filename mismatch). Each template's
 * expected name is a regex in setting imports.filenamePatterns with a named
 * group `date` (YYYY-MM-DD or YYYYMMDD) that must equal the data date.
 */

import { getSetting } from "@/modules/settings/settings";

export interface ImportTemplate {
  id: string;
  source: string;
  purpose: string;
  confirmId: string;
  /** Present once the template has been defined from a real export. */
  parse?: (csv: string) => Array<Record<string, string>>;
}

export const IMPORT_TEMPLATES: readonly ImportTemplate[] = Object.freeze([
  { id: "chainalysis", source: "Chainalysis", purpose: "Screening and KYT alerts export (CHK-04)", confirmId: "CONFIRM-CHAINALYSIS-EXPORT" },
  { id: "mtd_variance", source: "Power BI (MTD report)", purpose: "Optional daily variance extract (CHK-02)", confirmId: "CONFIRM-MTD-EXTRACT" },
  { id: "tatum", source: "Tatum", purpose: "Daily report (CHK-15)", confirmId: "CONFIRM-TATUM" },
  { id: "inbound", source: "Inbound transactions", purpose: "Inbound threshold breaches extract (CHK-05)", confirmId: "CONFIRM-INBOUND-EXTRACT" },
  { id: "travel_rule_recon", source: "Travel rule reconciliation", purpose: "Reconciliation output of the existing process (CHK-09)", confirmId: "CONFIRM-TR-RECON-EXPORT" },
]);

export function templateStatus(t: ImportTemplate): "ready" | "template_not_defined" {
  return t.parse ? "ready" : "template_not_defined";
}

function normaliseDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return null;
}

/**
 * Problems with an uploaded file's name for the template and data date
 * (empty = acceptable). No configured pattern is itself a problem: files are
 * refused rather than accepted unchecked (TODO(CONFIRM-IMPORT-FILENAMES)).
 */
export async function filenameIssues(templateId: string, filename: string, dataDate: string): Promise<string[]> {
  const patterns = await getSetting("imports.filenamePatterns");
  const source = patterns[templateId];
  if (!source) return [`No expected filename pattern is configured for "${templateId}" (CONFIRM-IMPORT-FILENAMES). The file was not imported.`];
  let re: RegExp;
  try {
    re = new RegExp(source);
  } catch {
    return [`The filename pattern for "${templateId}" is not a valid regular expression.`];
  }
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const m = re.exec(base);
  if (!m) return [`File name "${base}" does not match the expected pattern for ${templateId}. The file was not imported.`];
  const date = m.groups?.date ? normaliseDate(m.groups.date) : null;
  if (!date) return [`File name "${base}" has no readable date. The file was not imported.`];
  if (date !== dataDate) return [`File name date ${date} does not match the data date ${dataDate}. The file was not imported.`];
  return [];
}

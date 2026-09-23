/**
 * Import-based sources for Phase 1 (spec §8.6). Each template is built from a
 * real export; until then it is listed with its CONFIRM blocker and uploads
 * are refused. No parser is guessed.
 */

export interface ImportTemplate {
  id: string;
  source: string;
  purpose: string;
  confirmId: string;
  /** Present once the template has been defined from a real export. */
  parse?: (csv: string) => Array<Record<string, string>>;
}

export const IMPORT_TEMPLATES: readonly ImportTemplate[] = Object.freeze([
  { id: "chainalysis", source: "Chainalysis", purpose: "Screening and KYT alerts export", confirmId: "CONFIRM-CHAINALYSIS-EXPORT" },
  { id: "mtd_variance", source: "Power BI (MTD report)", purpose: "Optional daily variance extract", confirmId: "CONFIRM-MTD-EXTRACT" },
  { id: "tatum", source: "Tatum", purpose: "Daily report", confirmId: "CONFIRM-TATUM" },
  { id: "inbound", source: "Inbound transactions", purpose: "Inbound extract", confirmId: "CONFIRM-INBOUND-EXTRACT" },
]);

export function templateStatus(t: ImportTemplate): "ready" | "template_not_defined" {
  return t.parse ? "ready" : "template_not_defined";
}

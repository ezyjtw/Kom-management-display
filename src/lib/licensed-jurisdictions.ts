/**
 * Jurisdictions in which the deploying firm holds a licence. This is
 * deployment configuration, not product code: set
 * NEXT_PUBLIC_LICENSED_JURISDICTIONS to a comma-separated list of keys from
 * JURISDICTION_LABELS (for example "UK,EU"). Unset means none are marked.
 */
export function parseLicensedJurisdictions(raw: string | undefined): Set<string> {
  return new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export const LICENSED_JURISDICTIONS: Set<string> = parseLicensedJurisdictions(process.env.NEXT_PUBLIC_LICENSED_JURISDICTIONS);

/** Human list for prompts and labels, e.g. "UK, EU". "none configured" when empty. */
export function licensedJurisdictionList(set: Set<string> = LICENSED_JURISDICTIONS): string {
  return set.size ? [...set].join(", ") : "none configured";
}

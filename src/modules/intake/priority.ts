/**
 * Spec §9.4: deterministic priority. P1 if any keyword appears (case-insensitive,
 * whole words/phrases), otherwise P2. Never P0 automatically. No AI (H3).
 */
export function derivePriority(text: string, keywords: readonly string[]): "P1" | "P2" {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (!k) continue;
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(hay)) return "P1";
  }
  return "P2";
}

/** Summary per spec §9.2 rule 5: first 120 characters, sanitised to one line. */
export function summarise(text: string): string {
  const clean = text.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "(no text)";
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}

export function clientSlug(displayName: string | null | undefined): string {
  if (!displayName) return "unknown";
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "unknown";
}

/**
 * H12 guards for client-visible content (spec §9.7), applied server-side
 * before any JSM call or outbound message:
 * - it names no other client (display names, the custody provider organisation ids,
 *   account numbers);
 * - it contains none of the internal description (internal notes never reach
 *   the client).
 */

import { prisma } from "@/lib/prisma";

export class ClientContentError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "ClientContentError";
  }
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** References to other clients found in the text. */
export async function otherClientReferences(text: string, clientId: string): Promise<string[]> {
  const others = await prisma.client.findMany({
    where: { id: { not: clientId } },
    select: { displayName: true, custodyOrgId: true, custodyAccountNos: true },
  });
  const found: string[] = [];
  for (const c of others) {
    const terms = [c.displayName, c.custodyOrgId, ...(Array.isArray(c.custodyAccountNos) ? (c.custodyAccountNos as string[]) : [])]
      .filter((t): t is string => typeof t === "string" && t.trim().length >= 3);
    for (const term of terms) {
      if (new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term.trim())}([^A-Za-z0-9]|$)`, "i").test(text)) found.push(term.trim());
    }
  }
  return [...new Set(found)];
}

/** Chunks of the internal description (sentences or lines of 20+ characters) that appear in the text. */
export function internalTextLeaks(text: string, internalDescription: string | null | undefined): string[] {
  if (!internalDescription) return [];
  const body = normalise(text);
  const whole = normalise(internalDescription);
  if (whole.length >= 20 && body.includes(whole)) return [internalDescription.slice(0, 60)];
  return internalDescription
    .split(/(?<=[.!?])\s+|\n+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 20 && body.includes(normalise(c)))
    .map((c) => c.slice(0, 60));
}

/** Throws ClientContentError unless the client-visible text is scoped to this client and free of internal text. */
export async function assertClientVisible(text: string, clientId: string, internalDescription?: string | null): Promise<void> {
  const issues: string[] = [];
  const others = await otherClientReferences(text, clientId);
  if (others.length) issues.push(`The client-facing text mentions another client (${others.length} reference(s)); remove it.`);
  if (internalTextLeaks(text, internalDescription).length) issues.push("The client-facing text contains internal description text; internal notes never go to the client.");
  if (issues.length) throw new ClientContentError(issues);
}

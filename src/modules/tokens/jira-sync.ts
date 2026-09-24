/**
 * CHK-13 (spec §12): coin reviews are synced two-way with the TOKENS Jira
 * project. The Jira ticket is the record; the Tokens module is a view plus
 * structured fields.
 * - New review: a TOKENS ticket is opened (or an existing key linked).
 * - Status and structured-field changes are written to the ticket first as a
 *   comment (write-first: a refused write changes nothing locally).
 * - Inbound: Jira sync keeps the coin_review WorkItem's state; the Tokens
 *   view shows it. TODO(CONFIRM-TOKENS-WORKFLOW): mapping review statuses to
 *   TOKENS transitions once the workflow is confirmed.
 */

import type { TokenReview, WorkItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureTicketedWorkItem } from "@/modules/work-items/tickets";
import { commentInternal } from "@/modules/work-items/ticket-writeback";

export const TOKENS_PROJECT = "TOKENS";

async function linkedItem(token: Pick<TokenReview, "id" | "jiraTicket">): Promise<WorkItem | null> {
  if (token.jiraTicket) {
    const byKey = await prisma.workItem.findFirst({ where: { ticketKey: token.jiraTicket } });
    if (byKey) return byKey;
  }
  return prisma.workItem.findUnique({ where: { sourceSystem_sourceId: { sourceSystem: "token_review", sourceId: token.id } } });
}

/** Open (or link) the TOKENS ticket for a review and store its key on the review. */
export async function ticketTokenReview(tokenId: string): Promise<WorkItem | null> {
  const token = await prisma.tokenReview.findUnique({ where: { id: tokenId } });
  if (!token) return null;
  const existing = await linkedItem(token);
  if (existing?.ticketKey) {
    if (token.jiraTicket !== existing.ticketKey) await prisma.tokenReview.update({ where: { id: tokenId }, data: { jiraTicket: existing.ticketKey } });
    return existing;
  }
  const item = await ensureTicketedWorkItem({
    kind: "coin_review",
    title: `Coin review: ${token.symbol} (${token.name})`,
    team: "Team 2",
    taskCode: "CHK-13",
    sourceSystem: "token_review",
    sourceId: token.id,
    clockStartedAt: token.proposedAt,
    metadata: { tokenReviewId: token.id, symbol: token.symbol },
    ticket: {
      projectKey: TOKENS_PROJECT,
      summary: `Coin review: ${token.symbol} (${token.name})`,
      description: `Coin review proposed in KOMmand Centre.\nSymbol: ${token.symbol}\nName: ${token.name}\nNetwork: ${token.network || "n/a"}\nType: ${token.tokenType}`,
      labels: ["coin-review"],
    },
  });
  if (item.ticketKey && token.jiraTicket !== item.ticketKey) await prisma.tokenReview.update({ where: { id: tokenId }, data: { jiraTicket: item.ticketKey } });
  return item;
}

/** Write a review change to its TOKENS ticket first. No ticket: nothing to write (the change is reported as unticketed). */
export async function writeTokenChange(tokenId: string, text: string): Promise<void> {
  const token = await prisma.tokenReview.findUnique({ where: { id: tokenId }, select: { id: true, jiraTicket: true } });
  if (!token) return;
  const item = await linkedItem(token);
  if (item?.ticketKey) await commentInternal(item.id, text);
}

/** For the Tokens view: Jira state per review key, plus TOKENS tickets with no review record. */
export async function jiraView(tokens: Array<Pick<TokenReview, "id" | "jiraTicket">>) {
  const items = await prisma.workItem.findMany({
    where: { OR: [{ ticketKey: { startsWith: `${TOKENS_PROJECT}-` } }, { kind: "coin_review" }] },
    select: { id: true, ticketKey: true, ticketUrl: true, state: true, title: true, sourceSystem: true, sourceId: true },
  });
  const byKey = new Map(items.filter((i) => i.ticketKey).map((i) => [i.ticketKey!, i]));
  const linkedKeys = new Set(tokens.map((t) => t.jiraTicket).filter(Boolean));
  const linkedIds = new Set(tokens.map((t) => t.id));
  return {
    stateFor: (key: string) => byKey.get(key) ?? null,
    jiraOnly: items.filter((i) => i.ticketKey && !linkedKeys.has(i.ticketKey) && !(i.sourceSystem === "token_review" && linkedIds.has(i.sourceId))),
  };
}

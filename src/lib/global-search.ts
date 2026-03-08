/**
 * Global search across all operational modules.
 *
 * Searches across: comms threads, incidents, travel rule cases, projects,
 * employees, staking wallets, settlements, token reviews, screening entries.
 *
 * Returns unified search results with module-level grouping.
 */

import { prisma } from "@/lib/prisma";

export interface SearchResult {
  id: string;
  module: string;
  type: string;
  title: string;
  subtitle: string;
  url: string;
  relevance: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  byModule: Record<string, number>;
  durationMs: number;
}

/**
 * Perform a global search across all modules.
 */
export async function globalSearch(
  query: string,
  opts: { limit?: number; modules?: string[] } = {},
): Promise<SearchResponse> {
  const start = Date.now();
  const limit = opts.limit ?? 50;
  const q = query.trim();

  if (!q || q.length < 2) {
    return { query: q, results: [], total: 0, byModule: {}, durationMs: 0 };
  }

  const searchModules = opts.modules ?? [
    "comms", "incidents", "travel_rule", "projects",
    "employees", "staking", "settlements", "tokens", "screening",
  ];

  const searches: Promise<SearchResult[]>[] = [];

  if (searchModules.includes("comms")) searches.push(searchCommsThreads(q, limit));
  if (searchModules.includes("incidents")) searches.push(searchIncidents(q, limit));
  if (searchModules.includes("travel_rule")) searches.push(searchTravelRuleCases(q, limit));
  if (searchModules.includes("projects")) searches.push(searchProjects(q, limit));
  if (searchModules.includes("employees")) searches.push(searchEmployees(q, limit));
  if (searchModules.includes("staking")) searches.push(searchStakingWallets(q, limit));
  if (searchModules.includes("settlements")) searches.push(searchSettlements(q, limit));
  if (searchModules.includes("tokens")) searches.push(searchTokenReviews(q, limit));
  if (searchModules.includes("screening")) searches.push(searchScreeningEntries(q, limit));

  const allResults = (await Promise.all(searches)).flat();

  // Sort by relevance descending
  allResults.sort((a, b) => b.relevance - a.relevance);

  // Count by module
  const byModule: Record<string, number> = {};
  for (const r of allResults) {
    byModule[r.module] = (byModule[r.module] || 0) + 1;
  }

  return {
    query: q,
    results: allResults.slice(0, limit),
    total: allResults.length,
    byModule,
    durationMs: Date.now() - start,
  };
}

// ─── Module-specific search functions ───

async function searchCommsThreads(q: string, limit: number): Promise<SearchResult[]> {
  const threads = await prisma.commsThread.findMany({
    where: {
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { clientOrPartnerTag: { contains: q, mode: "insensitive" } },
        { sourceThreadRef: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, subject: true, clientOrPartnerTag: true, status: true, priority: true, source: true },
  });

  return threads.map((t) => ({
    id: t.id,
    module: "comms",
    type: "thread",
    title: t.subject,
    subtitle: `${t.source} · ${t.status} · ${t.priority} · ${t.clientOrPartnerTag}`,
    url: `/comms/thread/${t.id}`,
    relevance: t.subject.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchIncidents(q: string, limit: number): Promise<SearchResult[]> {
  const incidents = await prisma.incident.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { provider: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { externalTicketRef: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, provider: true, severity: true, status: true },
  });

  return incidents.map((i) => ({
    id: i.id,
    module: "incidents",
    type: "incident",
    title: i.title,
    subtitle: `${i.provider} · ${i.severity} · ${i.status}`,
    url: `/incidents`,
    relevance: i.title.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchTravelRuleCases(q: string, limit: number): Promise<SearchResult[]> {
  const cases = await prisma.travelRuleCase.findMany({
    where: {
      OR: [
        { transactionId: { contains: q, mode: "insensitive" } },
        { txHash: { contains: q, mode: "insensitive" } },
        { asset: { contains: q, mode: "insensitive" } },
        { senderAddress: { contains: q, mode: "insensitive" } },
        { receiverAddress: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: { id: true, transactionId: true, asset: true, amount: true, status: true, direction: true },
  });

  return cases.map((c) => ({
    id: c.id,
    module: "travel_rule",
    type: "case",
    title: `${c.asset} ${c.amount} ${c.direction}`,
    subtitle: `TX: ${c.transactionId} · ${c.status}`,
    url: `/travel-rule`,
    relevance: c.transactionId.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchProjects(q: string, limit: number): Promise<SearchResult[]> {
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, status: true, team: true, priority: true },
  });

  return projects.map((p) => ({
    id: p.id,
    module: "projects",
    type: "project",
    title: p.name,
    subtitle: `${p.team} · ${p.status} · ${p.priority}`,
    url: `/projects`,
    relevance: p.name.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchEmployees(q: string, limit: number): Promise<SearchResult[]> {
  const employees = await prisma.employee.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, team: true },
  });

  return employees.map((e) => ({
    id: e.id,
    module: "employees",
    type: "employee",
    title: e.name,
    subtitle: `${e.email} · ${e.role} · ${e.team}`,
    url: `/employee/${e.id}`,
    relevance: e.name.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchStakingWallets(q: string, limit: number): Promise<SearchResult[]> {
  const wallets = await prisma.stakingWallet.findMany({
    where: {
      OR: [
        { walletAddress: { contains: q, mode: "insensitive" } },
        { asset: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
        { validator: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: { id: true, walletAddress: true, asset: true, clientName: true, stakedAmount: true, status: true },
  });

  return wallets.map((w) => ({
    id: w.id,
    module: "staking",
    type: "wallet",
    title: `${w.asset} — ${w.clientName || w.walletAddress.substring(0, 16) + "..."}`,
    subtitle: `${w.stakedAmount.toLocaleString()} staked · ${w.status}`,
    url: `/staking`,
    relevance: w.walletAddress.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchSettlements(q: string, limit: number): Promise<SearchResult[]> {
  const settlements = await prisma.oesSettlement.findMany({
    where: {
      OR: [
        { settlementRef: { contains: q, mode: "insensitive" } },
        { clientName: { contains: q, mode: "insensitive" } },
        { asset: { contains: q, mode: "insensitive" } },
        { onChainTxHash: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: { id: true, settlementRef: true, clientName: true, asset: true, amount: true, status: true, venue: true },
  });

  return settlements.map((s) => ({
    id: s.id,
    module: "settlements",
    type: "settlement",
    title: `${s.asset} ${s.amount.toLocaleString()} — ${s.clientName}`,
    subtitle: `${s.venue} · ${s.settlementRef} · ${s.status}`,
    url: `/settlements`,
    relevance: s.settlementRef.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

async function searchTokenReviews(q: string, limit: number): Promise<SearchResult[]> {
  const tokens = await prisma.tokenReview.findMany({
    where: {
      OR: [
        { symbol: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { network: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
    select: { id: true, symbol: true, name: true, status: true, riskLevel: true, network: true },
  });

  return tokens.map((t) => ({
    id: t.id,
    module: "tokens",
    type: "token",
    title: `${t.symbol} — ${t.name}`,
    subtitle: `${t.network} · ${t.status} · Risk: ${t.riskLevel}`,
    url: `/tokens`,
    relevance: t.symbol.toLowerCase() === q.toLowerCase() ? 15 : 5,
  }));
}

async function searchScreeningEntries(q: string, limit: number): Promise<SearchResult[]> {
  const entries = await prisma.screeningEntry.findMany({
    where: {
      OR: [
        { transactionId: { contains: q, mode: "insensitive" } },
        { txHash: { contains: q, mode: "insensitive" } },
        { asset: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: { id: true, transactionId: true, asset: true, amount: true, classification: true, screeningStatus: true },
  });

  return entries.map((e) => ({
    id: e.id,
    module: "screening",
    type: "screening_entry",
    title: `${e.asset} ${e.amount} — ${e.classification}`,
    subtitle: `TX: ${e.transactionId} · ${e.screeningStatus}`,
    url: `/screening`,
    relevance: e.transactionId.toLowerCase().includes(q.toLowerCase()) ? 10 : 5,
  }));
}

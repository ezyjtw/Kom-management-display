import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/**
 * GET /api/clients
 *
 * Aggregates per-client health metrics from comms threads and travel rule cases.
 * Identifies problem clients: frequent emailers, recurring SLA breaches,
 * failing transactions, and open travel rule gaps.
 *
 * Returns a ranked list of clients with issue counts and severity scores.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") || "30", 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch all threads with a client tag from the lookback period
    const threads = await prisma.commsThread.findMany({
      where: {
        clientOrPartnerTag: { not: "" },
        createdAt: { gte: since },
      },
      select: {
        id: true,
        clientOrPartnerTag: true,
        source: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        lastMessageAt: true,
        lastActionAt: true,
        ownerUserId: true,
        ttoDeadline: true,
        ttfaDeadline: true,
        messages: {
          select: { id: true, authorType: true, timestamp: true },
          orderBy: { timestamp: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Fetch travel rule cases from the same period
    const travelCases = await prisma.travelRuleCase.findMany({
      where: {
        createdAt: { gte: since },
      },
      select: {
        id: true,
        transactionId: true,
        asset: true,
        direction: true,
        amount: true,
        matchStatus: true,
        status: true,
        slaDeadline: true,
        createdAt: true,
        resolvedAt: true,
      },
    });

    // Group threads by client
    const clientMap = new Map<string, {
      name: string;
      threadCount: number;
      messageCount: number;
      externalMessageCount: number;
      openThreads: number;
      highPriorityThreads: number;
      slaBreaches: number;
      sources: Set<string>;
      latestActivity: Date;
      threads: Array<{
        id: string;
        subject: string;
        status: string;
        priority: string;
        source: string;
        messageCount: number;
        createdAt: string;
      }>;
    }>();

    const now = new Date();

    for (const t of threads) {
      const client = t.clientOrPartnerTag;
      if (!clientMap.has(client)) {
        clientMap.set(client, {
          name: client,
          threadCount: 0,
          messageCount: 0,
          externalMessageCount: 0,
          openThreads: 0,
          highPriorityThreads: 0,
          slaBreaches: 0,
          sources: new Set(),
          latestActivity: new Date(0),
          threads: [],
        });
      }

      const c = clientMap.get(client)!;
      c.threadCount++;
      c.messageCount += t.messages.length;
      c.externalMessageCount += t.messages.filter(m => m.authorType === "external").length;
      c.sources.add(t.source);

      const isOpen = !["Done", "Closed"].includes(t.status);
      if (isOpen) c.openThreads++;
      if (t.priority === "P0" || t.priority === "P1") c.highPriorityThreads++;

      // Check SLA breaches: TTO breach if unassigned past deadline
      if (!t.ownerUserId && t.ttoDeadline && now > new Date(t.ttoDeadline)) {
        c.slaBreaches++;
      }
      // TTFA breach if assigned but no action past deadline
      if (t.ownerUserId && !t.lastActionAt && t.ttfaDeadline && now > new Date(t.ttfaDeadline)) {
        c.slaBreaches++;
      }

      const threadDate = new Date(t.lastMessageAt);
      if (threadDate > c.latestActivity) c.latestActivity = threadDate;

      c.threads.push({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        source: t.source,
        messageCount: t.messages.length,
        createdAt: t.createdAt.toISOString(),
      });
    }

    // Travel rule case stats — group by asset (as proxy for client counterparty)
    // Also count total unresolved, overdue, and failing patterns
    let trCasesOpen = 0;
    let trCasesOverdue = 0;
    let trCasesTotal = travelCases.length;
    const trAssetIssues = new Map<string, { total: number; open: number; overdue: number }>();

    for (const tc of travelCases) {
      const isOpen = tc.status !== "Resolved";
      if (isOpen) trCasesOpen++;
      const isOverdue = isOpen && tc.slaDeadline && now > new Date(tc.slaDeadline);
      if (isOverdue) trCasesOverdue++;

      if (!trAssetIssues.has(tc.asset)) {
        trAssetIssues.set(tc.asset, { total: 0, open: 0, overdue: 0 });
      }
      const ai = trAssetIssues.get(tc.asset)!;
      ai.total++;
      if (isOpen) ai.open++;
      if (isOverdue) ai.overdue++;
    }

    // Build client list sorted by severity score
    const clients = Array.from(clientMap.values()).map((c) => {
      // Severity score: weighted sum of issue indicators
      const severity =
        c.slaBreaches * 10 +
        c.highPriorityThreads * 5 +
        c.openThreads * 2 +
        c.externalMessageCount * 0.5;

      return {
        name: c.name,
        threadCount: c.threadCount,
        messageCount: c.messageCount,
        externalMessageCount: c.externalMessageCount,
        openThreads: c.openThreads,
        highPriorityThreads: c.highPriorityThreads,
        slaBreaches: c.slaBreaches,
        sources: Array.from(c.sources),
        latestActivity: c.latestActivity.toISOString(),
        severity: Math.round(severity * 10) / 10,
        recentThreads: c.threads.slice(0, 5),
      };
    });

    clients.sort((a, b) => b.severity - a.severity);

    const travelRuleSummary = {
      total: trCasesTotal,
      open: trCasesOpen,
      overdue: trCasesOverdue,
      byAsset: Array.from(trAssetIssues.entries())
        .map(([asset, stats]) => ({ asset, ...stats }))
        .sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    };

    return apiSuccess({
      clients,
      travelRule: travelRuleSummary,
      period: { days, since: since.toISOString() },
    });
  } catch (error) {
    return handleApiError(error, "clients GET");
  }
}

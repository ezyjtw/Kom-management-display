import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/tokens
 * List all tokens in the review pipeline with demand signals and summary stats.
 * Supports filtering by status and riskLevel query params.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const riskLevel = searchParams.get("riskLevel");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (riskLevel) where.riskLevel = riskLevel;

    const tokens = await prisma.tokenReview.findMany({
      where,
      include: {
        demandSignals: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ demandScore: "desc" }, { updatedAt: "desc" }],
    });

    const data = tokens.map((t) => {
      let custodianSupport: string[] = [];
      try { custodianSupport = JSON.parse(t.custodianSupport); } catch { /* */ }
      let vendorNotes: Record<string, string> = {};
      try { if (t.vendorNotes) vendorNotes = JSON.parse(t.vendorNotes); } catch { /* */ }
      let aiResearchResult: Record<string, unknown> | null = null;
      try { if (t.aiResearchResult) aiResearchResult = JSON.parse(t.aiResearchResult); } catch { /* */ }

      return {
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        network: t.network,
        contractAddress: t.contractAddress,
        tokenType: t.tokenType,
        status: t.status,
        proposedById: t.proposedById,
        proposedByName: null as string | null,
        proposedAt: t.proposedAt,
        reviewedById: t.reviewedById,
        reviewedAt: t.reviewedAt,
        complianceById: t.complianceById,
        complianceAt: t.complianceAt,
        approvedAt: t.approvedAt,
        rejectedAt: t.rejectedAt,
        liveAt: t.liveAt,
        rejectionReason: t.rejectionReason,
        riskLevel: t.riskLevel,
        riskNotes: t.riskNotes,
        regulatoryNotes: t.regulatoryNotes,
        sanctionsCheck: t.sanctionsCheck,
        amlRiskAssessed: t.amlRiskAssessed,
        custodianSupport,
        stakingAvailable: t.stakingAvailable,
        chainalysisSupport: t.chainalysisSupport,
        notabeneSupport: t.notabeneSupport,
        fireblocksSupport: t.fireblocksSupport,
        ledgerSupport: t.ledgerSupport,
        vendorNotes,
        aiResearchResult,
        aiResearchedAt: t.aiResearchedAt,
        aiRecommendation: t.aiRecommendation,
        demandScore: t.demandScore,
        demandSignals: t.demandSignals.map((s) => ({
          id: s.id,
          signalType: s.signalType,
          source: s.source,
          description: s.description,
          weight: s.weight,
          recordedById: s.recordedById,
          createdAt: s.createdAt,
        })),
        marketCapTier: t.marketCapTier,
        notes: t.notes,
        createdAt: t.createdAt,
      };
    });

    const summary = {
      total: data.length,
      proposed: data.filter((d) => d.status === "proposed").length,
      underReview: data.filter((d) => d.status === "under_review").length,
      complianceReview: data.filter((d) => d.status === "compliance_review").length,
      approved: data.filter((d) => d.status === "approved").length,
      rejected: data.filter((d) => d.status === "rejected").length,
      live: data.filter((d) => d.status === "live").length,
      highRisk: data.filter((d) => d.riskLevel === "high" || d.riskLevel === "critical").length,
    };

    return NextResponse.json({ success: true, data: { tokens: data, summary } });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/tokens
 * Actions on tokens:
 * - create: Propose a new token for review
 * - update_status: Move token through the review pipeline
 * - add_signal: Add a demand signal
 * - update: Update token details (risk, notes, compliance checks)
 *
 * Body: { action, ...params }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { action } = body;

    if (!action) {
      return NextResponse.json({ success: false, error: "action is required" }, { status: 400 });
    }

    const actorId = auth.employeeId || auth.id;

    switch (action) {
      case "create": {
        const { symbol, name, network, contractAddress, tokenType, riskLevel, marketCapTier, notes, custodianSupport, stakingAvailable } = body;
        if (!symbol || !name) {
          return NextResponse.json({ success: false, error: "symbol and name are required" }, { status: 400 });
        }

        const token = await prisma.tokenReview.create({
          data: {
            symbol: symbol.toUpperCase(),
            name,
            network: network || "",
            contractAddress: contractAddress || "",
            tokenType: tokenType || "native",
            riskLevel: riskLevel || "medium",
            marketCapTier: marketCapTier || "unknown",
            notes: notes || "",
            custodianSupport: custodianSupport ? JSON.stringify(custodianSupport) : "[]",
            stakingAvailable: stakingAvailable || false,
            proposedById: actorId,
            status: "proposed",
          },
        });

        return NextResponse.json({ success: true, data: { id: token.id } });
      }

      case "update_status": {
        const { tokenId, newStatus, reason } = body;
        if (!tokenId || !newStatus) {
          return NextResponse.json({ success: false, error: "tokenId and newStatus are required" }, { status: 400 });
        }

        const validStatuses = ["proposed", "under_review", "compliance_review", "approved", "rejected", "live"];
        if (!validStatuses.includes(newStatus)) {
          return NextResponse.json({ success: false, error: `Invalid status: ${newStatus}` }, { status: 400 });
        }

        const updateData: Record<string, unknown> = { status: newStatus };

        // Set timestamps and reviewer fields based on status
        if (newStatus === "under_review") {
          updateData.reviewedById = actorId;
          updateData.reviewedAt = new Date();
        } else if (newStatus === "compliance_review") {
          updateData.complianceById = actorId;
          updateData.complianceAt = new Date();
        } else if (newStatus === "approved") {
          updateData.approvedAt = new Date();
        } else if (newStatus === "rejected") {
          updateData.rejectedAt = new Date();
          updateData.rejectionReason = reason || "";
        } else if (newStatus === "live") {
          updateData.liveAt = new Date();
        }

        await prisma.tokenReview.update({
          where: { id: tokenId },
          data: updateData,
        });

        return NextResponse.json({ success: true });
      }

      case "add_signal": {
        const { tokenId, signalType, source, description, weight } = body;
        if (!tokenId || !signalType) {
          return NextResponse.json({ success: false, error: "tokenId and signalType are required" }, { status: 400 });
        }

        await prisma.tokenDemandSignal.create({
          data: {
            tokenReviewId: tokenId,
            signalType,
            source: source || "",
            description: description || "",
            weight: weight || 1,
            recordedById: actorId,
          },
        });

        // Recompute demand score: sum of signal weights, capped at 100
        const signals = await prisma.tokenDemandSignal.findMany({
          where: { tokenReviewId: tokenId },
        });
        const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0) * 10);
        await prisma.tokenReview.update({
          where: { id: tokenId },
          data: { demandScore: score },
        });

        return NextResponse.json({ success: true });
      }

      case "update": {
        const { tokenId } = body;
        if (!tokenId) {
          return NextResponse.json({ success: false, error: "tokenId is required" }, { status: 400 });
        }

        const updateData: Record<string, unknown> = {};
        const allowedFields = [
          "riskLevel", "riskNotes", "regulatoryNotes", "sanctionsCheck",
          "amlRiskAssessed", "stakingAvailable", "marketCapTier", "notes",
          "network", "contractAddress",
          "chainalysisSupport", "notabeneSupport", "fireblocksSupport", "ledgerSupport",
        ];
        for (const field of allowedFields) {
          if (body[field] !== undefined) updateData[field] = body[field];
        }
        if (body.custodianSupport !== undefined) {
          updateData.custodianSupport = JSON.stringify(body.custodianSupport);
        }
        if (body.vendorNotes !== undefined) {
          updateData.vendorNotes = JSON.stringify(body.vendorNotes);
        }

        await prisma.tokenReview.update({
          where: { id: tokenId },
          data: updateData,
        });

        return NextResponse.json({ success: true });
      }

      case "save_research": {
        const { tokenId, researchResult, recommendation } = body;
        if (!tokenId || !researchResult) {
          return NextResponse.json({ success: false, error: "tokenId and researchResult are required" }, { status: 400 });
        }

        await prisma.tokenReview.update({
          where: { id: tokenId },
          data: {
            aiResearchResult: JSON.stringify(researchResult),
            aiResearchedAt: new Date(),
            aiRecommendation: recommendation || "",
          },
        });

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

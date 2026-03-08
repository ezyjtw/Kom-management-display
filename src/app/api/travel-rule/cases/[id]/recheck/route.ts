import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import {
  fetchTransfers,
  isNotabeneConfigured,
  hasOriginatorData,
  hasBeneficiaryData,
  extractPartyName,
} from "@/lib/integrations/notabene";
import type { NotabeneTransfer, TravelRuleMatchStatus } from "@/types";
import { apiSuccess, apiValidationError, apiNotFoundError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * POST /api/travel-rule/cases/:id/recheck
 *
 * Re-fetches Notabene transfers and re-evaluates the match status for this
 * case. Used after a client provides travel rule information and the analyst
 * has entered it into Notabene.
 *
 * Returns the updated match status and whether it can be auto-resolved.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    if (!isNotabeneConfigured()) {
      return apiValidationError("Notabene is not configured");
    }

    const travelCase = await prisma.travelRuleCase.findUnique({
      where: { id: params.id },
    });

    if (!travelCase) {
      return apiNotFoundError("Case");
    }

    if (travelCase.status === "Resolved") {
      return apiValidationError("Case is already resolved");
    }

    // If we already have a Notabene transfer ID, fetch that specific transfer
    // Otherwise search for a match by fetching all recent transfers
    let matchedTransfer: NotabeneTransfer | null = null;
    let newMatchStatus: TravelRuleMatchStatus = "unmatched";

    if (travelCase.notabeneTransferId) {
      // Direct fetch of the known transfer
      const { fetchTransfer } = await import("@/lib/integrations/notabene");
      try {
        matchedTransfer = await fetchTransfer(travelCase.notabeneTransferId);
      } catch {
        // Transfer may no longer exist; fall through to search
      }
    }

    if (!matchedTransfer) {
      // Search by tx hash or address+amount
      const { transfers } = await fetchTransfers({ perPage: 200 });
      matchedTransfer = findMatchForCase(travelCase, transfers);
    }

    // Derive new match status
    if (matchedTransfer) {
      if (!hasOriginatorData(matchedTransfer)) {
        newMatchStatus = "missing_originator";
      } else if (!hasBeneficiaryData(matchedTransfer)) {
        newMatchStatus = "missing_beneficiary";
      } else {
        newMatchStatus = "matched";
      }
    }

    const previousMatchStatus = travelCase.matchStatus;
    const improved = newMatchStatus !== previousMatchStatus;
    const canAutoResolve = newMatchStatus === "matched";

    // Update the case if the match status improved
    const updateData: Record<string, unknown> = {};
    if (improved) {
      updateData.matchStatus = newMatchStatus;
    }
    if (matchedTransfer && !travelCase.notabeneTransferId) {
      updateData.notabeneTransferId = matchedTransfer.id;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.travelRuleCase.update({
        where: { id: params.id },
        data: updateData,
      });
    }

    const actorId = auth.employeeId || auth.id;

    // Build detail info for the response and audit
    const originatorName = matchedTransfer
      ? extractPartyName(matchedTransfer.originator, "originator")
      : null;
    const beneficiaryName = matchedTransfer
      ? extractPartyName(matchedTransfer.beneficiary, "beneficiary")
      : null;

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "travel_rule_case_updated",
        entityType: "travel_rule_case",
        entityId: params.id,
        userId: actorId,
        details: JSON.stringify({
          description: improved
            ? `Notabene recheck: ${previousMatchStatus} → ${newMatchStatus}`
            : `Notabene recheck: no change (${newMatchStatus})`,
          previousMatchStatus,
          newMatchStatus,
          notabeneTransferId: matchedTransfer?.id ?? null,
        }),
      },
    });

    return apiSuccess({
      previousMatchStatus,
      newMatchStatus,
      improved,
      canAutoResolve,
      notabeneTransferId: matchedTransfer?.id ?? null,
      notabeneStatus: matchedTransfer?.status ?? null,
      originatorName,
      beneficiaryName,
    });
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/cases/[id]/recheck");
  }
}

/**
 * Find a Notabene transfer that matches this case by tx hash or
 * address+amount+asset.
 */
function findMatchForCase(
  travelCase: {
    txHash: string;
    asset: string;
    amount: number;
    senderAddress: string;
    receiverAddress: string;
  },
  transfers: NotabeneTransfer[],
): NotabeneTransfer | null {
  // Primary: match by tx hash
  if (travelCase.txHash) {
    const hash = travelCase.txHash.toLowerCase();
    for (const t of transfers) {
      if (t.transactionHash && t.transactionHash.toLowerCase() === hash) {
        return t;
      }
    }
  }

  // Secondary: match by address + amount + asset
  for (const t of transfers) {
    const tAsset = (t.transactionAsset || "").toUpperCase();
    if (tAsset !== travelCase.asset.toUpperCase()) continue;

    const tAmount = parseFloat(t.transactionAmount) || 0;
    if (Math.abs(tAmount - travelCase.amount) > 0.0001) continue;

    const addresses = new Set<string>();
    if (t.originator?.accountNumber) {
      for (const a of t.originator.accountNumber) addresses.add(a.toLowerCase());
    }
    if (t.beneficiary?.accountNumber) {
      for (const a of t.beneficiary.accountNumber) addresses.add(a.toLowerCase());
    }

    const senderMatch =
      travelCase.senderAddress &&
      addresses.has(travelCase.senderAddress.toLowerCase());
    const receiverMatch =
      travelCase.receiverAddress &&
      addresses.has(travelCase.receiverAddress.toLowerCase());

    if (senderMatch || receiverMatch) return t;
  }

  return null;
}

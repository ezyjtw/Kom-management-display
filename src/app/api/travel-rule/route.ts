import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import {
  fetchPendingTransactions,
  isKomainuConfigured,
} from "@/lib/integrations/komainu";
import type { KomainuTransaction } from "@/lib/integrations/komainu";
import {
  fetchTransfers,
  isNotabeneConfigured,
  extractPartyName,
  hasOriginatorData,
  hasBeneficiaryData,
} from "@/lib/integrations/notabene";
import type {
  NotabeneTransfer,
  TravelRuleReconciliationRow,
  TravelRuleMatchStatus,
  TravelRuleOverview,
} from "@/types";
import { apiSuccess, handleApiError } from "@/lib/api/response";

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/**
 * Build a lookup map of Notabene transfers keyed by tx hash (lowercased).
 * Falls back to address+amount matching for transfers without a hash.
 */
function buildNotabeneIndex(transfers: NotabeneTransfer[]) {
  const byHash = new Map<string, NotabeneTransfer>();
  const byAddressAmount: Array<{
    transfer: NotabeneTransfer;
    addresses: Set<string>;
    amount: number;
    asset: string;
  }> = [];

  for (const t of transfers) {
    if (t.transactionHash) {
      byHash.set(t.transactionHash.toLowerCase(), t);
    }

    // Also index by address-amount for fuzzy matching
    const addresses = new Set<string>();
    if (t.originator?.accountNumber) {
      for (const a of t.originator.accountNumber) addresses.add(a.toLowerCase());
    }
    if (t.beneficiary?.accountNumber) {
      for (const a of t.beneficiary.accountNumber) addresses.add(a.toLowerCase());
    }

    byAddressAmount.push({
      transfer: t,
      addresses,
      amount: parseFloat(t.transactionAmount) || 0,
      asset: (t.transactionAsset || "").toUpperCase(),
    });
  }

  return { byHash, byAddressAmount };
}

function findMatch(
  tx: KomainuTransaction,
  index: ReturnType<typeof buildNotabeneIndex>,
): NotabeneTransfer | null {
  // Primary: match by tx hash
  if (tx.tx_hash) {
    const match = index.byHash.get(tx.tx_hash.toLowerCase());
    if (match) return match;
  }

  // Secondary: match by address + amount + asset
  for (const entry of index.byAddressAmount) {
    if (entry.asset !== tx.asset.toUpperCase()) continue;
    if (Math.abs(entry.amount - tx.amount) > 0.0001) continue;

    const senderMatch = tx.sender_address && entry.addresses.has(tx.sender_address.toLowerCase());
    const receiverMatch = tx.receiver_address && entry.addresses.has(tx.receiver_address.toLowerCase());

    if (senderMatch || receiverMatch) return entry.transfer;
  }

  return null;
}

function deriveMatchStatus(
  transfer: NotabeneTransfer | null,
): TravelRuleMatchStatus {
  if (!transfer) return "unmatched";
  if (!hasOriginatorData(transfer)) return "missing_originator";
  if (!hasBeneficiaryData(transfer)) return "missing_beneficiary";
  return "matched";
}

// ---------------------------------------------------------------------------
// API handler
// ---------------------------------------------------------------------------

/**
 * GET /api/travel-rule
 * Real-time reconciliation: Komainu transactions vs Notabene transfers.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const komainuConfigured = isKomainuConfigured();
    const notabeneConfigured = isNotabeneConfigured();

    // Fetch data from both sources in parallel
    const [komainuResult, notabeneResult] = await Promise.allSettled([
      komainuConfigured
        ? fetchPendingTransactions({ pageSize: 200 })
        : Promise.resolve({ data: [] as KomainuTransaction[] }),
      notabeneConfigured
        ? fetchTransfers({ perPage: 200 })
        : Promise.resolve({ transfers: [] as NotabeneTransfer[], total: 0 }),
    ]);

    const transactions: KomainuTransaction[] =
      komainuResult.status === "fulfilled"
        ? ("data" in komainuResult.value
            ? komainuResult.value.data
            : [])
        : [];

    const transfers: NotabeneTransfer[] =
      notabeneResult.status === "fulfilled"
        ? ("transfers" in notabeneResult.value
            ? notabeneResult.value.transfers
            : [])
        : [];

    // Build index and reconcile
    const index = buildNotabeneIndex(transfers);

    let matched = 0;
    let unmatched = 0;
    let missingOriginator = 0;
    let missingBeneficiary = 0;

    const rows: TravelRuleReconciliationRow[] = transactions.map((tx) => {
      const transfer = findMatch(tx, index);
      const matchStatus = deriveMatchStatus(transfer);

      switch (matchStatus) {
        case "matched":
          matched++;
          break;
        case "unmatched":
          unmatched++;
          break;
        case "missing_originator":
          missingOriginator++;
          break;
        case "missing_beneficiary":
          missingBeneficiary++;
          break;
      }

      return {
        transactionId: tx.id,
        txHash: tx.tx_hash || "",
        direction: tx.direction,
        asset: tx.asset,
        amount: tx.amount,
        senderAddress: tx.sender_address,
        receiverAddress: tx.receiver_address,
        createdAt: tx.created_at,
        status: tx.status,
        matchStatus,
        notabeneTransferId: transfer?.id ?? null,
        notabeneStatus: transfer?.status ?? null,
        hasOriginator: transfer ? hasOriginatorData(transfer) : false,
        hasBeneficiary: transfer ? hasBeneficiaryData(transfer) : false,
        originatorName: transfer
          ? extractPartyName(transfer.originator, "originator")
          : null,
        beneficiaryName: transfer
          ? extractPartyName(transfer.beneficiary, "beneficiary")
          : null,
        alerts: [],
      };
    });

    // Generate urgent alerts for compliance gaps
    const alertRows = rows.filter(
      (r) =>
        r.matchStatus === "unmatched" ||
        r.matchStatus === "missing_originator" ||
        r.matchStatus === "missing_beneficiary",
    );

    for (const row of alertRows) {
      const alertType =
        row.matchStatus === "missing_originator"
          ? "travel_rule_missing_originator"
          : row.matchStatus === "missing_beneficiary"
            ? "travel_rule_missing_beneficiary"
            : "travel_rule_unmatched";

      const message =
        row.matchStatus === "unmatched"
          ? `No travel rule data found for ${row.asset} ${row.direction} transaction ${row.txHash || row.transactionId}`
          : row.matchStatus === "missing_originator"
            ? `Missing originator info for ${row.asset} ${row.direction} transaction ${row.txHash || row.transactionId}`
            : `Missing beneficiary info for ${row.asset} ${row.direction} transaction ${row.txHash || row.transactionId}`;

      // Avoid duplicate active alerts for the same transaction
      const existing = await prisma.alert.findFirst({
        where: {
          type: alertType,
          status: "active",
          message: { contains: row.transactionId },
        },
      });

      if (!existing) {
        const alert = await prisma.alert.create({
          data: {
            type: alertType,
            priority: row.matchStatus === "unmatched" ? "P0" : "P1",
            message,
            destination: "in_app",
          },
        });
        row.alerts.push(alert.id);
      }
    }

    const overview: TravelRuleOverview = {
      rows,
      summary: {
        total: rows.length,
        matched,
        unmatched,
        missingOriginator,
        missingBeneficiary,
      },
      configured: {
        komainu: komainuConfigured,
        notabene: notabeneConfigured,
      },
    };

    return apiSuccess(overview);
  } catch (error) {
    return handleApiError(error, "GET /api/travel-rule");
  }
}

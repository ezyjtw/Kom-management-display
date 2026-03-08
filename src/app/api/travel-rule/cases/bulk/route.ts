import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { TRAVEL_RULE_SLA } from "@/lib/sla";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

interface BulkRow {
  transactionId: string;
  txHash?: string;
  direction?: string;
  asset?: string;
  amount?: number;
  senderAddress?: string;
  receiverAddress?: string;
  matchStatus: string;
  notabeneTransferId?: string | null;
}

/**
 * POST /api/travel-rule/cases/bulk
 *
 * Bulk operations on travel rule cases.
 * Body: {
 *   action: "create_cases" | "assign" | "mark_not_required"
 *   rows?: BulkRow[]          // for create_cases
 *   caseIds?: string[]        // for assign / mark_not_required
 *   ownerUserId?: string      // for assign
 * }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { action, rows, caseIds, ownerUserId } = body;
    const actorId = auth.employeeId || auth.id;

    // create_cases: batch-create from reconciliation table rows.
    // Skips rows that already have a case (deduplication via compound unique).
    if (action === "create_cases") {
      if (!Array.isArray(rows) || rows.length === 0) {
        return apiValidationError("rows array is required for create_cases");
      }

      const created: string[] = [];
      const skipped: string[] = [];

      for (const row of rows as BulkRow[]) {
        if (!row.transactionId || !row.matchStatus) continue;

        const existing = await prisma.travelRuleCase.findUnique({
          where: {
            transactionId_matchStatus: {
              transactionId: row.transactionId,
              matchStatus: row.matchStatus,
            },
          },
        });

        if (existing) {
          skipped.push(existing.id);
          continue;
        }

        const now = new Date();
        const slaDeadline = new Date(now.getTime() + TRAVEL_RULE_SLA.resolution * 3_600_000);

        const travelCase = await prisma.travelRuleCase.create({
          data: {
            transactionId: row.transactionId,
            txHash: row.txHash || "",
            direction: row.direction || "",
            asset: row.asset || "",
            amount: row.amount || 0,
            senderAddress: row.senderAddress || "",
            receiverAddress: row.receiverAddress || "",
            matchStatus: row.matchStatus,
            notabeneTransferId: row.notabeneTransferId || null,
            status: "Open",
            slaDeadline,
          },
        });
        created.push(travelCase.id);
      }

      await prisma.auditLog.create({
        data: {
          action: "travel_rule_bulk_action",
          entityType: "travel_rule_case",
          entityId: created[0] || "bulk",
          userId: actorId,
          details: JSON.stringify({
            description: `Bulk created ${created.length} cases (${skipped.length} skipped as duplicates)`,
            action: "create_cases",
            createdIds: created,
            skippedIds: skipped,
          }),
        },
      });

      return apiSuccess({ created: created.length, skipped: skipped.length, ids: created });
    }

    // assign: set ownerUserId and auto-transition status to "Investigating".
    // Uses $transaction to apply all updates atomically.
    if (action === "assign") {
      if (!Array.isArray(caseIds) || caseIds.length === 0 || !ownerUserId) {
        return apiValidationError("caseIds and ownerUserId required for assign");
      }

      await prisma.$transaction(
        caseIds.map((id: string) =>
          prisma.travelRuleCase.update({
            where: { id },
            data: {
              ownerUserId,
              status: "Investigating", // auto-transition
            },
          }),
        ),
      );

      // Resolve name for audit
      const emp = await prisma.employee.findUnique({
        where: { id: ownerUserId },
        select: { name: true },
      });

      await prisma.auditLog.create({
        data: {
          action: "travel_rule_bulk_action",
          entityType: "travel_rule_case",
          entityId: caseIds[0],
          userId: actorId,
          details: JSON.stringify({
            description: `Bulk assigned ${caseIds.length} cases to ${emp?.name || ownerUserId}`,
            action: "assign",
            caseIds,
            ownerUserId,
          }),
        },
      });

      return apiSuccess({ updated: caseIds.length });
    }

    // mark_not_required: close cases as "Not Required" (e.g. internal transfers,
    // test transactions, or amounts below the travel rule threshold).
    if (action === "mark_not_required") {
      if (!Array.isArray(caseIds) || caseIds.length === 0) {
        return apiValidationError("caseIds required for mark_not_required");
      }

      await prisma.$transaction(
        caseIds.map((id: string) =>
          prisma.travelRuleCase.update({
            where: { id },
            data: {
              status: "Resolved",
              resolutionType: "not_required",
              resolvedAt: new Date(),
            },
          }),
        ),
      );

      await prisma.auditLog.create({
        data: {
          action: "travel_rule_bulk_action",
          entityType: "travel_rule_case",
          entityId: caseIds[0],
          userId: actorId,
          details: JSON.stringify({
            description: `Bulk resolved ${caseIds.length} cases as "Not Required"`,
            action: "mark_not_required",
            caseIds,
          }),
        },
      });

      return apiSuccess({ resolved: caseIds.length });
    }

    return apiValidationError("Invalid action. Must be create_cases, assign, or mark_not_required");
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/cases/bulk");
  }
}

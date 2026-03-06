import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/settlements
 *
 * List OES settlements with optional filters:
 *   ?status=pending&mappingStatus=mismatch&client=Acme
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const mappingStatus = searchParams.get("mappingStatus");
    const client = searchParams.get("client");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (mappingStatus) where.mappingStatus = mappingStatus;
    if (client) where.clientName = { contains: client, mode: "insensitive" };

    const settlements = await prisma.oesSettlement.findMany({
      where,
      orderBy: [{ status: "asc" }, { expectedSettleAt: "desc" }],
    });

    const summary = {
      total: settlements.length,
      pending: settlements.filter((s) => s.status === "pending").length,
      completed: settlements.filter((s) => s.status === "completed").length,
      failed: settlements.filter((s) => s.status === "failed").length,
      mismatched: settlements.filter((s) => s.mappingStatus === "mismatch").length,
      unmapped: settlements.filter((s) => s.mappingStatus === "pending").length,
    };

    return NextResponse.json({
      success: true,
      data: { settlements, summary },
    });
  } catch (error) {
    console.error("Settlements GET error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settlements
 *
 * Create a new OES settlement record.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      settlementRef,
      clientName,
      clientAccount,
      asset,
      amount,
      direction,
      counterparty,
      expectedSettleAt,
      oesTradeId,
    } = body;

    if (!settlementRef || !clientName || !asset || !amount || !direction || !expectedSettleAt) {
      return NextResponse.json(
        { success: false, error: "settlementRef, clientName, asset, amount, direction, and expectedSettleAt are required" },
        { status: 400 },
      );
    }

    const settlement = await prisma.oesSettlement.create({
      data: {
        settlementRef,
        clientName,
        clientAccount: clientAccount || "",
        asset,
        amount: parseFloat(amount),
        direction,
        counterparty: counterparty || "",
        expectedSettleAt: new Date(expectedSettleAt),
        oesTradeId: oesTradeId || "",
      },
    });

    return NextResponse.json({ success: true, data: settlement }, { status: 201 });
  } catch (error) {
    console.error("Settlements POST error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/settlements
 *
 * Update a settlement: map it, mark complete, flag mismatch, etc.
 * Body: { id, mappingStatus?, status?, mappingNote?, komainuTxId?, actualSettleAt? }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "id is required" },
        { status: 400 },
      );
    }

    const data: Record<string, unknown> = {};
    if (updates.mappingStatus) data.mappingStatus = updates.mappingStatus;
    if (updates.status) data.status = updates.status;
    if (updates.mappingNote !== undefined) data.mappingNote = updates.mappingNote;
    if (updates.komainuTxId !== undefined) data.komainuTxId = updates.komainuTxId;
    if (updates.actualSettleAt) data.actualSettleAt = new Date(updates.actualSettleAt);

    // If marking as completed or mapped, record reviewer
    if (updates.status === "completed" || updates.mappingStatus === "mapped") {
      const actorId = auth.employeeId || auth.id;
      data.reviewedById = actorId;
      data.reviewedAt = new Date();
    }

    if (updates.status === "completed" && !data.actualSettleAt) {
      data.actualSettleAt = new Date();
    }

    const settlement = await prisma.oesSettlement.update({
      where: { id },
      data,
    });

    return NextResponse.json({ success: true, data: settlement });
  } catch (error) {
    console.error("Settlements PATCH error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

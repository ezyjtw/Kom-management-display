import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/settlements
 *
 * List OES settlement instructions with optional filters:
 *   ?venue=okx&matchStatus=mismatch&cycle=2026-03-07&client=Acme
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const venue = searchParams.get("venue");
    const status = searchParams.get("status");
    const matchStatus = searchParams.get("matchStatus");
    const cycle = searchParams.get("cycle");
    const client = searchParams.get("client");

    const where: Record<string, unknown> = {};
    if (venue) where.venue = venue;
    if (status) where.status = status;
    if (matchStatus) where.matchStatus = matchStatus;
    if (cycle) where.settlementCycle = { contains: cycle };
    if (client) where.clientName = { contains: client, mode: "insensitive" };

    const settlements = await prisma.oesSettlement.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { settlementCycle: "desc" },
        { createdAt: "desc" },
      ],
    });

    // Enrich with maker/checker names
    const employeeIds = [
      ...new Set([
        ...settlements.map((s) => s.makerById).filter(Boolean),
        ...settlements.map((s) => s.checkerById).filter(Boolean),
      ]),
    ] as string[];

    const employees = employeeIds.length > 0
      ? await prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = Object.fromEntries(employees.map((e) => [e.id, e.name]));

    const summary = {
      total: settlements.length,
      pending: settlements.filter((s) => s.status === "pending").length,
      confirmed: settlements.filter((s) => s.status === "confirmed").length,
      completed: settlements.filter((s) => s.status === "completed").length,
      escalated: settlements.filter((s) => s.status === "escalated").length,
      failed: settlements.filter((s) => s.status === "failed").length,
      matched: settlements.filter((s) => s.matchStatus === "matched").length,
      mismatched: settlements.filter((s) => s.matchStatus === "mismatch").length,
      missingTx: settlements.filter((s) => s.matchStatus === "missing_tx").length,
      flagged: settlements.filter((s) => s.matchStatus === "flagged").length,
      byVenue: {
        okx: settlements.filter((s) => s.venue === "okx").length,
        fireblocks: settlements.filter((s) => s.venue === "fireblocks").length,
      },
    };

    const enriched = settlements.map((s) => ({
      ...s,
      makerByName: s.makerById ? nameMap[s.makerById] || null : null,
      checkerByName: s.checkerById ? nameMap[s.checkerById] || null : null,
    }));

    return NextResponse.json({ success: true, data: { settlements: enriched, summary } });
  } catch (error) {
    console.error("Settlements GET error:", error);
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/settlements
 *
 * Create a new OES settlement record (from a settlement cycle instruction).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      settlementRef, venue, clientName, clientAccount, asset, amount,
      direction, settlementCycle, exchangeInstructionId,
      collateralWallet, custodyWallet,
    } = body;

    if (!settlementRef || !clientName || !asset || !amount || !direction) {
      return NextResponse.json(
        { success: false, error: "settlementRef, clientName, asset, amount, and direction are required" },
        { status: 400 },
      );
    }

    if (isNaN(parseFloat(amount))) {
      return NextResponse.json(
        { success: false, error: "amount must be a valid number" },
        { status: 400 },
      );
    }

    const settlement = await prisma.oesSettlement.create({
      data: {
        settlementRef,
        venue: venue || "okx",
        clientName,
        clientAccount: clientAccount || "",
        asset,
        amount: parseFloat(amount),
        direction,
        settlementCycle: settlementCycle || "",
        exchangeInstructionId: exchangeInstructionId || "",
        collateralWallet: collateralWallet || "",
        custodyWallet: custodyWallet || "",
      },
    });

    return NextResponse.json({ success: true, data: settlement }, { status: 201 });
  } catch (error) {
    console.error("Settlements POST error:", error);
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/settlements
 *
 * Update a settlement — maker/checker confirm, match tx, flag, escalate.
 *
 * Body: { id, action: string, ...fields }
 *
 * Actions:
 *   match_tx         — link on-chain tx hash to this instruction
 *   maker_confirm    — maker verifies instruction matches on-chain
 *   checker_approve  — checker approves the match
 *   flag_mismatch    — flag a mismatch with note
 *   escalate         — escalate to exchange
 *   update_delegation — update OKX delegation status
 *   complete         — mark settlement as completed
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, action, ...fields } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const actorId = auth.employeeId || auth.id;
    const data: Record<string, unknown> = {};

    switch (action) {
      case "match_tx":
        data.onChainTxHash = fields.onChainTxHash || "";
        data.matchStatus = "matched";
        break;

      case "maker_confirm":
        data.makerById = actorId;
        data.makerAt = new Date();
        data.status = "confirmed";
        break;

      case "checker_approve":
        data.checkerById = actorId;
        data.checkerAt = new Date();
        data.status = "completed";
        break;

      case "flag_mismatch":
        data.matchStatus = fields.matchStatus || "mismatch";
        data.matchNote = fields.matchNote || "";
        data.status = "escalated";
        break;

      case "escalate":
        data.status = "escalated";
        data.escalationNote = fields.escalationNote || "";
        data.matchStatus = "flagged";
        break;

      case "update_delegation":
        if (fields.delegationStatus) data.delegationStatus = fields.delegationStatus;
        if (fields.delegatedAmount !== undefined && !isNaN(parseFloat(fields.delegatedAmount))) data.delegatedAmount = parseFloat(fields.delegatedAmount);
        break;

      case "complete":
        data.status = "completed";
        if (!fields.skipChecker) {
          data.checkerById = actorId;
          data.checkerAt = new Date();
        }
        break;

      default:
        // Direct field updates
        if (fields.status) data.status = fields.status;
        if (fields.matchStatus) data.matchStatus = fields.matchStatus;
        if (fields.onChainTxHash !== undefined) data.onChainTxHash = fields.onChainTxHash;
        if (fields.fireblockssTxId !== undefined) data.fireblockssTxId = fields.fireblockssTxId;
        if (fields.oesSignerGroup !== undefined) data.oesSignerGroup = fields.oesSignerGroup;
        if (fields.matchNote !== undefined) data.matchNote = fields.matchNote;
        break;
    }

    const settlement = await prisma.oesSettlement.update({ where: { id }, data });
    return NextResponse.json({ success: true, data: settlement });
  } catch (error) {
    console.error("Settlements PATCH error:", error);
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

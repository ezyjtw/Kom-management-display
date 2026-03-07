import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/usdc-ramp
 *
 * List USDC on/off ramp tickets with optional filters:
 *   ?status=instruction_received&direction=onramp&client=Acme
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const direction = searchParams.get("direction");
    const client = searchParams.get("client");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (client) where.clientName = { contains: client, mode: "insensitive" };

    const tickets = await prisma.usdcRampRequest.findMany({
      where,
      orderBy: [
        { completedAt: { sort: "asc", nulls: "first" } },
        { priority: "asc" },
        { requestedAt: "desc" },
      ],
    });

    // Enrich with maker/checker names
    const employeeIds = [
      ...new Set([
        ...tickets.map((t) => t.makerById).filter(Boolean),
        ...tickets.map((t) => t.checkerById).filter(Boolean),
      ]),
    ] as string[];

    const employees = employeeIds.length > 0
      ? await prisma.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = Object.fromEntries(employees.map((e) => [e.id, e.name]));

    const completed = tickets.filter((t) => t.status === "completed");

    const summary = {
      total: tickets.length,
      active: tickets.filter((t) => t.status !== "completed" && t.status !== "rejected").length,
      awaitingCheckerApproval: tickets.filter((t) =>
        ["usd_received", "instruction_accepted"].includes(t.status) ||
        (t.makerById && !t.checkerById && t.status !== "completed"),
      ).length,
      completed: completed.length,
      feeBufferLow: tickets.some((t) => t.feeBufferLow),
      totalOnrampVolume: completed.filter((t) => t.direction === "onramp").reduce((s, t) => s + t.amount, 0),
      totalOfframpVolume: completed.filter((t) => t.direction === "offramp").reduce((s, t) => s + t.amount, 0),
    };

    const enriched = tickets.map((t) => ({
      ...t,
      makerByName: t.makerById ? nameMap[t.makerById] || null : null,
      checkerByName: t.checkerById ? nameMap[t.checkerById] || null : null,
    }));

    return NextResponse.json({ success: true, data: { tickets: enriched, summary } });
  } catch (error) {
    console.error("USDC ramp GET error:", error);
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/usdc-ramp
 *
 * Create a new USDC ramp ticket (instruction received).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      clientName, clientAccount, direction, amount, fiatCurrency, fiatAmount,
      bankReference, instructionRef, custodyWalletId, ssiDetails, priority,
      notes,
    } = body;

    if (!clientName || !direction || !amount) {
      return NextResponse.json(
        { success: false, error: "clientName, direction, and amount are required" },
        { status: 400 },
      );
    }
    if (direction !== "onramp" && direction !== "offramp") {
      return NextResponse.json(
        { success: false, error: "direction must be 'onramp' or 'offramp'" },
        { status: 400 },
      );
    }

    const ticket = await prisma.usdcRampRequest.create({
      data: {
        clientName,
        clientAccount: clientAccount || "",
        direction,
        amount: parseFloat(amount),
        fiatCurrency: fiatCurrency || "USD",
        fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
        bankReference: bankReference || "",
        instructionRef: instructionRef || "",
        custodyWalletId: custodyWalletId || "",
        ssiDetails: ssiDetails || "",
        priority: priority || "normal",
        notes: notes || "",
        status: "instruction_received",
        requestedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, data: ticket }, { status: 201 });
  } catch (error) {
    console.error("USDC ramp POST error:", error);
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/usdc-ramp
 *
 * Update a ramp ticket — advance workflow, maker/checker actions, add evidence.
 *
 * Body: { id, action: string, ...fields }
 *
 * Actions:
 *   advance_status  — move to next workflow status
 *   maker_confirm   — maker signs off on current step
 *   checker_approve — checker approves current step
 *   add_evidence    — append evidence ref
 *   update_checks   — toggle kycAmlOk, ssiVerified, walletWhitelisted, gasWalletOk, etc.
 *   flag_buffer     — mark fee buffer as low
 *   notify_client   — mark client as notified
 *   reject          — reject the ticket
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
      case "advance_status":
        if (!fields.status) {
          return NextResponse.json({ success: false, error: "status is required" }, { status: 400 });
        }
        data.status = fields.status;
        if (fields.status === "completed") data.completedAt = new Date();
        break;

      case "maker_confirm":
        data.makerById = actorId;
        data.makerAt = new Date();
        if (fields.makerNote) data.makerNote = fields.makerNote;
        if (fields.status) data.status = fields.status;
        break;

      case "checker_approve":
        data.checkerById = actorId;
        data.checkerAt = new Date();
        if (fields.checkerNote) data.checkerNote = fields.checkerNote;
        if (fields.status) data.status = fields.status;
        break;

      case "update_checks":
        if (fields.kycAmlOk !== undefined) data.kycAmlOk = fields.kycAmlOk;
        if (fields.ssiVerified !== undefined) data.ssiVerified = fields.ssiVerified;
        if (fields.walletWhitelisted !== undefined) data.walletWhitelisted = fields.walletWhitelisted;
        if (fields.gasWalletOk !== undefined) data.gasWalletOk = fields.gasWalletOk;
        if (fields.expressEnabled !== undefined) data.expressEnabled = fields.expressEnabled;
        break;

      case "add_evidence": {
        const ticket = await prisma.usdcRampRequest.findUnique({ where: { id } });
        if (!ticket) {
          return NextResponse.json({ success: false, error: "Ticket not found" }, { status: 404 });
        }
        let existing: string[] = [];
        try { existing = JSON.parse(ticket.evidence) as string[]; } catch { /* ignore */ }
        existing.push(fields.evidenceRef || "");
        data.evidence = JSON.stringify(existing);
        break;
      }

      case "flag_buffer":
        data.feeBufferLow = true;
        break;

      case "notify_client":
        data.clientNotifiedAt = new Date();
        break;

      case "reject":
        data.status = "rejected";
        data.rejectionReason = fields.rejectionReason || "";
        break;

      default:
        // Simple field updates
        if (fields.status) data.status = fields.status;
        if (fields.onChainTxHash !== undefined) data.onChainTxHash = fields.onChainTxHash;
        if (fields.issuerConfirmation !== undefined) data.issuerConfirmation = fields.issuerConfirmation;
        if (fields.holdingWalletId !== undefined) data.holdingWalletId = fields.holdingWalletId;
        if (fields.notes !== undefined) data.notes = fields.notes;
        if (fields.bankReference !== undefined) data.bankReference = fields.bankReference;
        if (fields.priority) data.priority = fields.priority;
        break;
    }

    const ticket = await prisma.usdcRampRequest.update({ where: { id }, data });
    return NextResponse.json({ success: true, data: ticket });
  } catch (error) {
    console.error("USDC ramp PATCH error:", error);
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

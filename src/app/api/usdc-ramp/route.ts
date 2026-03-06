import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/usdc-ramp
 *
 * List USDC on/off ramp requests with optional filters:
 *   ?status=pending&direction=onramp&client=Acme
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

    const requests = await prisma.usdcRampRequest.findMany({
      where,
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    });

    const completed = requests.filter((r) => r.status === "completed");

    const summary = {
      total: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      awaitingFunds: requests.filter((r) => r.status === "awaiting_funds").length,
      processing: requests.filter((r) => r.status === "processing").length,
      completed: completed.length,
      rejected: requests.filter((r) => r.status === "rejected").length,
      totalOnrampVolume: completed
        .filter((r) => r.direction === "onramp")
        .reduce((sum, r) => sum + r.amount, 0),
      totalOfframpVolume: completed
        .filter((r) => r.direction === "offramp")
        .reduce((sum, r) => sum + r.amount, 0),
    };

    // Enrich with assignee names
    const assigneeIds = [...new Set(requests.map((r) => r.assignedToId).filter(Boolean))] as string[];
    const employees = assigneeIds.length > 0
      ? await prisma.employee.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = Object.fromEntries(employees.map((e) => [e.id, e.name]));

    const enriched = requests.map((r) => ({
      ...r,
      assignedToName: r.assignedToId ? nameMap[r.assignedToId] || null : null,
    }));

    return NextResponse.json({
      success: true,
      data: { requests: enriched, summary },
    });
  } catch (error) {
    console.error("USDC ramp GET error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/usdc-ramp
 *
 * Create a new USDC ramp request.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const {
      clientName,
      clientAccount,
      direction,
      amount,
      fiatCurrency,
      fiatAmount,
      bankReference,
      walletAddress,
      priority,
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

    const rampRequest = await prisma.usdcRampRequest.create({
      data: {
        clientName,
        clientAccount: clientAccount || "",
        direction,
        amount: parseFloat(amount),
        fiatCurrency: fiatCurrency || "USD",
        fiatAmount: fiatAmount ? parseFloat(fiatAmount) : null,
        bankReference: bankReference || "",
        walletAddress: walletAddress || "",
        priority: priority || "normal",
        notes: notes || "",
        requestedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, data: rampRequest }, { status: 201 });
  } catch (error) {
    console.error("USDC ramp POST error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/usdc-ramp
 *
 * Update a ramp request: assign, change status, add txHash, etc.
 * Body: { id, status?, assignedToId?, txHash?, notes?, rejectionReason? }
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
    if (updates.status) data.status = updates.status;
    if (updates.assignedToId !== undefined) data.assignedToId = updates.assignedToId;
    if (updates.txHash !== undefined) data.txHash = updates.txHash;
    if (updates.notes !== undefined) data.notes = updates.notes;
    if (updates.rejectionReason !== undefined) data.rejectionReason = updates.rejectionReason;
    if (updates.priority) data.priority = updates.priority;

    if (updates.status === "completed") {
      data.completedAt = new Date();
    }

    const rampRequest = await prisma.usdcRampRequest.update({
      where: { id },
      data,
    });

    return NextResponse.json({ success: true, data: rampRequest });
  } catch (error) {
    console.error("USDC ramp PATCH error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

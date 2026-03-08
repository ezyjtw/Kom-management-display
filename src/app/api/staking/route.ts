import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

function computeRewardHealth(wallet: { expectedNextRewardAt: Date | null; lastRewardAt: Date | null }): string {
  if (!wallet.expectedNextRewardAt) return "no_data";
  const now = new Date();
  const hoursUntil = (wallet.expectedNextRewardAt.getTime() - now.getTime()) / 3600000;
  if (hoursUntil < 0) return "overdue";
  if (hoursUntil < 4) return "approaching";
  return "on_time";
}

/**
 * GET /api/staking
 * List staking wallets with filters: ?asset=ETH&status=active&rewardModel=daily
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const asset = searchParams.get("asset");
    const status = searchParams.get("status");
    const rewardModel = searchParams.get("rewardModel");
    const clientName = searchParams.get("clientName");

    const where: Record<string, unknown> = {};
    if (asset) where.asset = asset;
    if (status) where.status = status;
    if (rewardModel) where.rewardModel = rewardModel;
    if (clientName) where.clientName = { contains: clientName, mode: "insensitive" };

    const wallets = await prisma.stakingWallet.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const data = wallets.map((w) => {
      let tags: string[] = [];
      try { tags = typeof w.tags === "string" ? JSON.parse(w.tags) : (w.tags as string[] ?? []); } catch { /* */ }
      const rewardHealth = computeRewardHealth(w);
      const varianceFlag = w.onChainBalance != null && w.platformBalance != null
        ? Math.abs(w.onChainBalance - w.platformBalance) > w.varianceThreshold
        : false;

      return { ...w, tags, rewardHealth, varianceFlag };
    });

    const active = data.filter((w) => w.status === "active");
    return NextResponse.json({
      success: true,
      data: {
        wallets: data,
        summary: {
          total: data.length,
          active: active.length,
          overdue: active.filter((w) => w.rewardHealth === "overdue").length,
          approaching: active.filter((w) => w.rewardHealth === "approaching").length,
          coldStaking: data.filter((w) => w.isColdStaking).length,
          reconciliationFlags: data.filter((w) => w.varianceFlag).length,
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/staking
 * Create a staking wallet.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { walletAddress, asset, rewardModel } = body;

    if (!walletAddress || !asset || !rewardModel) {
      return NextResponse.json(
        { success: false, error: "walletAddress, asset, and rewardModel are required" },
        { status: 400 },
      );
    }

    const wallet = await prisma.stakingWallet.create({
      data: {
        walletAddress,
        asset,
        rewardModel,
        validator: body.validator || "",
        stakedAmount: typeof body.stakedAmount === "number" && !isNaN(body.stakedAmount) ? body.stakedAmount : 0,
        clientName: body.clientName || "",
        isColdStaking: body.isColdStaking || false,
        isTestWallet: body.isTestWallet || false,
        stakeDate: body.stakeDate ? new Date(body.stakeDate) : null,
        expectedFirstRewardDate: body.expectedFirstRewardDate ? new Date(body.expectedFirstRewardDate) : null,
        expectedNextRewardAt: body.expectedNextRewardAt ? new Date(body.expectedNextRewardAt) : null,
        onChainBalance: body.onChainBalance ?? null,
        platformBalance: body.platformBalance ?? null,
        varianceThreshold: body.varianceThreshold ?? 0.01,
        tags: JSON.stringify(body.tags || []),
        notes: body.notes || "",
      },
    });

    return NextResponse.json({ success: true, data: wallet }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

/**
 * PATCH /api/staking
 * Update a staking wallet. Body: { id, ...fields }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (fields.validator !== undefined) updateData.validator = fields.validator;
    if (fields.stakedAmount !== undefined) updateData.stakedAmount = fields.stakedAmount;
    if (fields.clientName !== undefined) updateData.clientName = fields.clientName;
    if (fields.isColdStaking !== undefined) updateData.isColdStaking = fields.isColdStaking;
    if (fields.isTestWallet !== undefined) updateData.isTestWallet = fields.isTestWallet;
    if (fields.lastRewardAt !== undefined) updateData.lastRewardAt = fields.lastRewardAt ? new Date(fields.lastRewardAt) : null;
    if (fields.expectedNextRewardAt !== undefined) updateData.expectedNextRewardAt = fields.expectedNextRewardAt ? new Date(fields.expectedNextRewardAt) : null;
    if (fields.actualFirstRewardDate !== undefined) updateData.actualFirstRewardDate = fields.actualFirstRewardDate ? new Date(fields.actualFirstRewardDate) : null;
    if (fields.onChainBalance !== undefined) updateData.onChainBalance = fields.onChainBalance;
    if (fields.platformBalance !== undefined) updateData.platformBalance = fields.platformBalance;
    if (fields.varianceThreshold !== undefined) updateData.varianceThreshold = fields.varianceThreshold;
    if (fields.tags !== undefined) updateData.tags = JSON.stringify(fields.tags);
    if (fields.notes !== undefined) updateData.notes = fields.notes;
    if (fields.status !== undefined) updateData.status = fields.status;

    const wallet = await prisma.stakingWallet.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true, data: wallet });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

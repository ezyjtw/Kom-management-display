import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultScoringConfig } from "@/lib/scoring";
import { requireRole, safeErrorMessage } from "@/lib/auth-user";

export async function GET() {
  try {
    // Get active scoring config
    const config = await prisma.scoringConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });

    if (!config) {
      // Return default config
      return NextResponse.json({
        success: true,
        data: {
          id: "default",
          version: "1.0.0",
          config: JSON.stringify(getDefaultScoringConfig()),
          active: true,
          createdBy: "system",
          createdAt: new Date().toISOString(),
          notes: "Default scoring configuration",
        },
      });
    }

    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Admin only
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { version, config, notes } = body;

    if (!version || !config) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: version, config" },
        { status: 400 }
      );
    }

    // Deactivate all existing configs
    await prisma.scoringConfig.updateMany({
      where: { active: true },
      data: { active: false },
    });

    const newConfig = await prisma.scoringConfig.create({
      data: {
        version,
        config: typeof config === "string" ? config : JSON.stringify(config),
        active: true,
        createdById: auth.id,
        notes: notes || "",
      },
    });

    // Write audit log for config change
    await prisma.auditLog.create({
      data: {
        action: "config_update",
        entityType: "scoring_config",
        entityId: newConfig.id,
        userId: auth.id,
        details: JSON.stringify({
          version,
          notes: notes || "",
        }),
      },
    });

    return NextResponse.json({ success: true, data: newConfig }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}


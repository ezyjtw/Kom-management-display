import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultScoringConfig } from "@/lib/scoring";

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
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { version, config, createdBy, notes } = body;

    if (!version || !config || !createdBy) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
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
        createdBy,
        notes: notes || "",
      },
    });

    return NextResponse.json({ success: true, data: newConfig }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}


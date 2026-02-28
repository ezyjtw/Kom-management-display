import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const role = searchParams.get("role");
    const active = searchParams.get("active") !== "false";

    const where: Record<string, unknown> = { active };
    if (team) where.team = team;
    if (role) where.role = role;

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ success: true, data: employees });
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
    const { name, email, role, team, region } = body;

    if (!name || !email || !role || !team) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: name, email, role, team" },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.create({
      data: { name, email, role, team, region: region || "Global" },
    });

    return NextResponse.json({ success: true, data: employee }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

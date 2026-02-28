import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        scores: {
          include: { period: true },
          orderBy: { period: { startDate: "desc" } },
        },
        knowledgeScores: {
          include: { period: true },
          orderBy: { period: { startDate: "desc" } },
        },
        employeeNotes: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: "Employee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: employee });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, role, team, region, active } = body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (team !== undefined) data.team = team;
    if (region !== undefined) data.region = region;
    if (active !== undefined) data.active = active;

    const employee = await prisma.employee.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({ success: true, data: employee });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

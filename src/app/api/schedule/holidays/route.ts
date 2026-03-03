import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/schedule/holidays
 * Get public holidays. Filters: ?region, ?year
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get("region");
    const year = searchParams.get("year");

    const where: Record<string, unknown> = {};
    if (region) {
      where.OR = [{ region }, { region: "Global" }];
    }
    if (year) {
      where.date = {
        gte: new Date(`${year}-01-01`),
        lte: new Date(`${year}-12-31`),
      };
    }

    const holidays = await prisma.publicHoliday.findMany({
      where,
      orderBy: { date: "asc" },
    });

    const data = holidays.map((h) => ({
      id: h.id,
      date: h.date.toISOString(),
      name: h.name,
      region: h.region,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/schedule/holidays
 * Create a public holiday. Admin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { date, name, region } = body;

    if (!date || !name) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: date, name" },
        { status: 400 }
      );
    }

    const holiday = await prisma.publicHoliday.upsert({
      where: {
        date_region: {
          date: new Date(date),
          region: region || "Global",
        },
      },
      update: { name },
      create: {
        date: new Date(date),
        name,
        region: region || "Global",
      },
    });

    return NextResponse.json({ success: true, data: holiday }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 }
    );
  }
}

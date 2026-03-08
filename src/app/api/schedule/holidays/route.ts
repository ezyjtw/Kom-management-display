import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

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

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error, "holidays GET");
  }
}

/**
 * POST /api/schedule/holidays
 * Create a public holiday. Admin only.
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { date, name, region } = body;

    if (!date || !name) {
      return apiValidationError("Missing required fields: date, name");
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

    return apiSuccess(holiday, undefined, 201);
  } catch (error) {
    return handleApiError(error, "holidays POST");
  }
}

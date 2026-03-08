import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/travel-rule/vasp-directory
 * List all VASP contacts.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const contacts = await prisma.vaspContact.findMany({
      orderBy: { vaspName: "asc" },
    });
    return apiSuccess(contacts);
  } catch (error) {
    return handleApiError(error, "GET /api/travel-rule/vasp-directory");
  }
}

/**
 * POST /api/travel-rule/vasp-directory
 * Create or update a VASP contact.
 *
 * Body: { vaspDid, vaspName, email, notes? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { vaspDid, vaspName, email, notes } = body;

    if (!vaspDid || !vaspName || !email) {
      return apiValidationError("vaspDid, vaspName, and email are required");
    }

    const [contact] = await prisma.$transaction([
      prisma.vaspContact.upsert({
        where: { vaspDid },
        update: { vaspName, email, notes: notes || "" },
        create: { vaspDid, vaspName, email, notes: notes || "" },
      }),
      prisma.auditLog.create({
        data: {
          action: "vasp_contact_upsert",
          entityType: "vasp_contact",
          entityId: "pending",
          userId: auth.employeeId || auth.id,
          details: JSON.stringify({ vaspDid, vaspName, email }),
        },
      }),
    ]);

    return apiSuccess(contact);
  } catch (error) {
    return handleApiError(error, "POST /api/travel-rule/vasp-directory");
  }
}

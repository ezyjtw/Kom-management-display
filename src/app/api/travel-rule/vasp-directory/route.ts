import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

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
    return NextResponse.json({ success: true, data: contacts });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
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

  try {
    const body = await request.json();
    const { vaspDid, vaspName, email, notes } = body;

    if (!vaspDid || !vaspName || !email) {
      return NextResponse.json(
        { success: false, error: "vaspDid, vaspName, and email are required" },
        { status: 400 },
      );
    }

    const contact = await prisma.vaspContact.upsert({
      where: { vaspDid },
      update: { vaspName, email, notes: notes || "" },
      create: { vaspDid, vaspName, email, notes: notes || "" },
    });

    await prisma.auditLog.create({
      data: {
        action: "vasp_contact_upsert",
        entityType: "vasp_contact",
        entityId: contact.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ vaspDid, vaspName, email }),
      },
    });

    return NextResponse.json({ success: true, data: contact });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

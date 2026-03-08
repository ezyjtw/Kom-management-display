import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import {
  apiSuccess,
  apiValidationError,
  apiNotFoundError,
  apiConflictError,
  apiForbiddenError,
  handleApiError,
} from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

const VALID_CHANNELS = ["email", "slack", "phone", "portal"];

/**
 * GET /api/client-preferences
 *
 * List all client contact preferences with optional filters.
 * Query params: ?active=true&channel=email&search=acme
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const active = searchParams.get("active");
    const channel = searchParams.get("channel");
    const search = searchParams.get("search");

    const where: Record<string, unknown> = {};
    if (active !== null) where.active = active === "true";
    if (channel) where.preferredChannel = channel;
    if (search) {
      where.OR = [
        { clientName: { contains: search, mode: "insensitive" } },
        { displayName: { contains: search, mode: "insensitive" } },
        { primaryEmail: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    const preferences = await prisma.clientContactPreference.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { clientName: "asc" },
    });

    // Build summary
    const all = await prisma.clientContactPreference.groupBy({
      by: ["preferredChannel", "active"],
      _count: true,
    });

    const summary = {
      total: preferences.length,
      active: preferences.filter((p) => p.active).length,
      byChannel: {
        email: 0,
        slack: 0,
        phone: 0,
        portal: 0,
      } as Record<string, number>,
      withTravelRuleContact: preferences.filter((p) => p.travelRuleContact).length,
      withEscalation: preferences.filter((p) => p.escalationEmail || p.escalationPhone).length,
    };

    for (const row of all) {
      if (row.active && summary.byChannel[row.preferredChannel] !== undefined) {
        summary.byChannel[row.preferredChannel] = row._count;
      }
    }

    // Parse tags from JSON string
    const data = preferences.map((p) => ({
      ...p,
      tags: parseTags(p.tags),
      lastContactedAt: p.lastContactedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    return apiSuccess({ preferences: data, summary });
  } catch (error) {
    return handleApiError(error, "client-preferences GET");
  }
}

/**
 * POST /api/client-preferences
 *
 * Create a new client contact preference record.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const authz = checkAuthorization(auth, "employee", "create");
  if (!authz.allowed) return apiForbiddenError(authz.reason);

  try {
    const body = await request.json();
    const { clientName, preferredChannel } = body;

    if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
      return apiValidationError("clientName is required");
    }

    if (preferredChannel && !VALID_CHANNELS.includes(preferredChannel)) {
      return apiValidationError(
        `preferredChannel must be one of: ${VALID_CHANNELS.join(", ")}`,
      );
    }

    // Check for duplicate
    const existing = await prisma.clientContactPreference.findUnique({
      where: { clientName: clientName.trim() },
    });
    if (existing) {
      return apiConflictError(`Client "${clientName}" already has contact preferences`);
    }

    const actorId = auth.employeeId || auth.id;

    const preference = await prisma.clientContactPreference.create({
      data: {
        clientName: clientName.trim(),
        displayName: body.displayName || "",
        preferredChannel: preferredChannel || "email",
        primaryEmail: body.primaryEmail || "",
        secondaryEmail: body.secondaryEmail || "",
        slackChannel: body.slackChannel || "",
        phoneNumber: body.phoneNumber || "",
        timezone: body.timezone || "UTC",
        businessHoursStart: body.businessHoursStart || "09:00",
        businessHoursEnd: body.businessHoursEnd || "17:00",
        businessDays: body.businessDays || "mon,tue,wed,thu,fri",
        language: body.language || "en",
        vaspDid: body.vaspDid || "",
        travelRuleContact: body.travelRuleContact || "",
        escalationEmail: body.escalationEmail || "",
        escalationPhone: body.escalationPhone || "",
        notes: body.notes || "",
        tags: JSON.stringify(body.tags || []),
        createdById: actorId,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    await createAuditEntry({
      action: "client_preference_created",
      entityType: "client_contact_preference",
      entityId: preference.id,
      userId: actorId,
      summary: `Created contact preferences for ${clientName}`,
      after: { clientName, preferredChannel: preference.preferredChannel },
    });

    return apiSuccess(
      {
        ...preference,
        tags: parseTags(preference.tags),
        lastContactedAt: null,
        createdAt: preference.createdAt.toISOString(),
        updatedAt: preference.updatedAt.toISOString(),
      },
      undefined,
      201,
    );
  } catch (error) {
    return handleApiError(error, "client-preferences POST");
  }
}

/**
 * PATCH /api/client-preferences
 *
 * Update an existing client contact preference.
 * Body: { id, ...fields }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return apiValidationError("id is required");
    }

    const existing = await prisma.clientContactPreference.findUnique({
      where: { id },
    });
    if (!existing) {
      return apiNotFoundError("Client preference");
    }

    if (fields.preferredChannel && !VALID_CHANNELS.includes(fields.preferredChannel)) {
      return apiValidationError(
        `preferredChannel must be one of: ${VALID_CHANNELS.join(", ")}`,
      );
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      "displayName", "preferredChannel", "primaryEmail", "secondaryEmail",
      "slackChannel", "phoneNumber", "timezone", "businessHoursStart",
      "businessHoursEnd", "businessDays", "language", "vaspDid",
      "travelRuleContact", "escalationEmail", "escalationPhone",
      "notes", "active",
    ];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        updateData[field] = fields[field];
      }
    }

    if (fields.tags !== undefined) {
      updateData.tags = JSON.stringify(fields.tags);
    }

    if (fields.lastContactedAt !== undefined) {
      updateData.lastContactedAt = fields.lastContactedAt
        ? new Date(fields.lastContactedAt)
        : null;
    }

    const actorId = auth.employeeId || auth.id;

    const updated = await prisma.clientContactPreference.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    await createAuditEntry({
      action: "client_preference_updated",
      entityType: "client_contact_preference",
      entityId: id,
      userId: actorId,
      summary: `Updated contact preferences for ${existing.clientName}`,
      before: { preferredChannel: existing.preferredChannel, active: existing.active },
      after: updateData,
    });

    return apiSuccess({
      ...updated,
      tags: parseTags(updated.tags),
      lastContactedAt: updated.lastContactedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error, "client-preferences PATCH");
  }
}

// ─── Helpers ───

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

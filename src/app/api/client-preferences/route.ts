import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { auditedAction } from "@/lib/api/audit";
import {
  apiSuccess,
  apiValidationError,
  apiNotFoundError,
  apiConflictError,
  apiForbiddenError,
  handleApiError,
} from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { z } from "zod";
import { auditActor } from "@/modules/core-data/audit-actor";

const preferenceFields = {
  displayName: z.string().max(200).optional(),
  preferredChannel: z.enum(["email", "slack", "phone", "portal"]).optional(),
  primaryEmail: z.union([z.string().email().max(320), z.literal("")]).optional(),
  secondaryEmail: z.union([z.string().email().max(320), z.literal("")]).optional(),
  slackChannel: z.string().max(100).optional(),
  phoneNumber: z.string().max(50).optional(),
  timezone: z.string().max(64).optional(),
  businessHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  businessHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  businessDays: z.string().max(40).optional(),
  language: z.string().max(10).optional(),
  vaspDid: z.string().max(300).optional(),
  travelRuleContact: z.string().max(300).optional(),
  escalationEmail: z.union([z.string().email().max(320), z.literal("")]).optional(),
  escalationPhone: z.string().max(50).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().max(50)).max(50).optional(),
};
const createPreferenceSchema = z.object({ clientName: z.string().trim().min(1).max(200), ...preferenceFields });
const updatePreferenceSchema = z.object({
  id: z.string().min(1).max(100),
  ...preferenceFields,
  active: z.boolean().optional(),
  lastContactedAt: z.string().max(40).nullable().optional(),
});

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
    const _parsed = createPreferenceSchema.safeParse(await request.json());
    if (!_parsed.success) return apiValidationError(_parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    const body = _parsed.data;
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

    // Client contact details drive client communication: fail-closed audit.
    const actor = auditActor(auth);
    const preference = await auditedAction(
      {
        action: "client_preference_created",
        entityType: "client_contact_preference",
        entityId: "new",
        userId: actor.userId,
        summary: `Create contact preferences for ${clientName}`,
        after: { clientName, preferredChannel: preferredChannel || "email" },
        metadata: actor.metadata,
      },
      () => prisma.clientContactPreference.create({
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
      }),
      undefined,
      { entityId: (r) => r.id },
    );

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
    const _parsed = updatePreferenceSchema.safeParse(await request.json());
    if (!_parsed.success) return apiValidationError(_parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    const body = _parsed.data;
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

    const fieldValues = fields as Record<string, unknown>;
    for (const field of allowedFields) {
      if (fieldValues[field] !== undefined) {
        updateData[field] = fieldValues[field];
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

    const actor = auditActor(auth);
    const updated = await auditedAction(
      {
        action: "client_preference_updated",
        entityType: "client_contact_preference",
        entityId: id,
        userId: actor.userId,
        summary: `Update contact preferences for ${existing.clientName}`,
        before: { preferredChannel: existing.preferredChannel, active: existing.active },
        after: updateData,
        metadata: actor.metadata,
      },
      () => prisma.clientContactPreference.update({
        where: { id },
        data: updateData,
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      }),
    );

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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { getAllFlags, isFeatureEnabled, invalidateFlagCache } from "@/lib/feature-flags";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

/**
 * GET /api/feature-flags
 * List all feature flags (admin view) or check specific flag.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    // Check a specific flag for the current user
    if (key) {
      const enabled = await isFeatureEnabled(key, {
        role: auth.role,
        team: auth.team || undefined,
        userId: auth.id,
      });
      return apiSuccess({ key, enabled });
    }

    // List all flags (admin/lead only)
    if (auth.role !== "admin" && auth.role !== "lead") {
      // Non-admin: return only their enabled flags
      const flags = await getAllFlags();
      const enabledFlags: Record<string, boolean> = {};
      for (const flag of flags) {
        enabledFlags[flag.key] = await isFeatureEnabled(flag.key, {
          role: auth.role,
          team: auth.team || undefined,
          userId: auth.id,
        });
      }
      return apiSuccess({ flags: enabledFlags });
    }

    const flags = await getAllFlags();
    return apiSuccess({ flags });
  } catch (error) {
    return handleApiError(error, "feature-flags GET");
  }
}

/**
 * POST /api/feature-flags
 * Create or update a feature flag (admin only).
 * Body: { key, name, description?, enabled?, roles?, teams?, percentage? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { key, name, description, enabled, roles, teams, percentage } = body;

    if (!key || !name) {
      return apiValidationError("key and name are required");
    }

    const flag = await prisma.featureFlag.upsert({
      where: { key },
      update: {
        name,
        description: description ?? undefined,
        enabled: enabled ?? undefined,
        roles: roles ? JSON.stringify(roles) : undefined,
        teams: teams ? JSON.stringify(teams) : undefined,
        percentage: percentage ?? undefined,
      },
      create: {
        key,
        name,
        description: description || "",
        enabled: enabled ?? false,
        roles: roles ? JSON.stringify(roles) : "[]",
        teams: teams ? JSON.stringify(teams) : "[]",
        percentage: percentage ?? 100,
      },
    });

    invalidateFlagCache();

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: "feature_flag_updated",
        entityType: "feature_flag",
        entityId: flag.id,
        userId: auth.employeeId || auth.id,
        details: JSON.stringify({ key, enabled: flag.enabled }),
      },
    });

    return apiSuccess(flag, undefined, 201);
  } catch (error) {
    return handleApiError(error, "feature-flags POST");
  }
}

/**
 * DELETE /api/feature-flags?key=some_flag
 * Delete a feature flag (admin only).
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) return apiValidationError("key query parameter is required");

    await prisma.featureFlag.delete({ where: { key } });
    invalidateFlagCache();

    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error, "feature-flags DELETE");
  }
}

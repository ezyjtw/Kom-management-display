/**
 * GET /api/scores/config - Get active scoring configuration
 * POST /api/scores/config - Create new config (draft)
 * PUT /api/scores/config - Update config status (review → approve → activate)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveScoringConfig } from "@/lib/scoring";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, handleApiError, apiForbiddenError, apiValidationError, apiNotFoundError } from "@/lib/api/response";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const includeHistory = searchParams.get("history") === "true";

    const activeConfig = await getActiveScoringConfig();

    if (includeHistory) {
      const allConfigs = await prisma.scoringConfig.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      return apiSuccess({
        active: activeConfig,
        history: allConfigs.map((c) => ({
          id: c.id,
          version: c.version,
          active: c.active,
          createdById: c.createdById,
          createdAt: c.createdAt,
          notes: c.notes,
        })),
      });
    }

    return apiSuccess(activeConfig);
  } catch (error) {
    return handleApiError(error, "scores/config");
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "scoring_config", "create");
  if (!authz.allowed) return apiForbiddenError();

  try {
    const body = await request.json();
    const { version, config, notes } = body;

    if (!version || !config) {
      return apiValidationError("version and config are required");
    }

    // Check version uniqueness
    const existing = await prisma.scoringConfig.findUnique({ where: { version } });
    if (existing) {
      return apiValidationError(`Config version '${version}' already exists`);
    }

    const newConfig = await prisma.scoringConfig.create({
      data: {
        version,
        config: typeof config === "string" ? config : JSON.stringify(config),
        active: false,
        createdById: auth.id,
        notes: notes || `Draft config created by ${auth.name}`,
      },
    });

    await createAuditEntry({
      action: "config_change",
      entityType: "scoring_config",
      entityId: newConfig.id,
      userId: auth.employeeId || auth.id,
      summary: `New scoring config draft '${version}' created`,
      after: { version, notes },
    });

    return apiSuccess(newConfig);
  } catch (error) {
    return handleApiError(error, "scores/config POST");
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole("admin");
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "scoring_config", "configure");
  if (!authz.allowed) return apiForbiddenError();

  try {
    const body = await request.json();
    const { configId, action: configAction, notes } = body;

    if (!configId || !configAction) {
      return apiValidationError("configId and action are required");
    }

    const config = await prisma.scoringConfig.findUnique({ where: { id: configId } });
    if (!config) return apiNotFoundError("Scoring config");

    if (configAction === "activate") {
      // Deactivate all other configs
      await prisma.scoringConfig.updateMany({
        where: { active: true },
        data: { active: false },
      });

      // Activate this one
      const updated = await prisma.scoringConfig.update({
        where: { id: configId },
        data: { active: true, notes: notes ? `${config.notes}\nActivated: ${notes}` : config.notes },
      });

      await createAuditEntry({
        action: "config_activated",
        entityType: "scoring_config",
        entityId: configId,
        userId: auth.employeeId || auth.id,
        summary: `Scoring config '${config.version}' activated`,
        before: { active: false },
        after: { active: true },
        metadata: { notes },
      });

      return apiSuccess(updated);
    }

    return apiValidationError("Invalid action. Supported: 'activate'");
  } catch (error) {
    return handleApiError(error, "scores/config PUT");
  }
}

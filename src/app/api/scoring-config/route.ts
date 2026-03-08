/**
 * GET /api/scoring-config - Get active scoring configuration
 * POST /api/scoring-config - Create new config draft (does NOT auto-activate)
 *
 * Config activation must go through the approval workflow:
 *   draft → review → approved → active
 * Use PUT /api/scores/config to transition config status.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultScoringConfig } from "@/lib/scoring";
import { requireRole } from "@/lib/auth-user";
import { checkAuthorization } from "@/modules/auth/services/authorization";
import { createAuditEntry } from "@/lib/api/audit";
import { apiSuccess, apiForbiddenError, apiValidationError, handleApiError } from "@/lib/api/response";

export async function GET() {
  try {
    const config = await prisma.scoringConfig.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });

    if (!config) {
      return apiSuccess({
        id: "default",
        version: "1.0.0",
        config: getDefaultScoringConfig(),
        active: true,
        status: "active",
        createdBy: "system",
        createdAt: new Date().toISOString(),
        notes: "Default scoring configuration",
      });
    }

    // config is a native Json column — return it directly
    const configData = typeof config.config === "string"
      ? JSON.parse(config.config)
      : config.config;

    return apiSuccess({ ...config, config: configData });
  } catch (error) {
    return handleApiError(error, "scoring-config GET");
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
      return apiValidationError("Missing required fields: version, config");
    }

    // Check version uniqueness
    const existing = await prisma.scoringConfig.findUnique({ where: { version } });
    if (existing) {
      return apiValidationError(`Config version '${version}' already exists`);
    }

    // Create as draft — activation requires review and approval
    const newConfig = await prisma.scoringConfig.create({
      data: {
        version,
        config: typeof config === "string" ? JSON.parse(config) : config,
        active: false,
        status: "draft",
        createdById: auth.id,
        notes: notes || `Draft created by ${auth.name}`,
      },
    });

    await createAuditEntry({
      action: "config_draft_created",
      entityType: "scoring_config",
      entityId: newConfig.id,
      userId: auth.employeeId || auth.id,
      summary: `New scoring config draft '${version}' created`,
      after: { version, status: "draft" },
    });

    return apiSuccess(newConfig, undefined, 201);
  } catch (error) {
    return handleApiError(error, "scoring-config POST");
  }
}

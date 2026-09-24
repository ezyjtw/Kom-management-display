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
import { auditedAction } from "@/lib/api/audit";
import { apiSuccess, apiForbiddenError, apiValidationError, handleApiError } from "@/lib/api/response";
import { validateBody, createScoringConfigSchema } from "@/lib/validation";
import { featureGate } from "@/lib/feature-gate";
import { auditActor } from "@/modules/core-data/audit-actor";

export async function GET() {
  const gated = await featureGate("people.scoring");
  if (gated) return gated;

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
  const gated = await featureGate("people.scoring");
  if (gated) return gated;

  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  const authz = checkAuthorization(auth, "scoring_config", "create");
  if (!authz.allowed) return apiForbiddenError();

  try {
    const body = await request.json();
    const parsed = validateBody(createScoringConfigSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
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
    const actor = auditActor(auth);
    // Fail-closed: a configuration change without an audit record does not happen.
    const newConfig = await auditedAction(
      {
        action: "config_draft_created",
        entityType: "scoring_config",
        entityId: "new",
        userId: actor.userId,
        summary: `New scoring config draft '${version}' created`,
        after: { version, status: "draft" },
        metadata: actor.metadata,
      },
      () => prisma.scoringConfig.create({
        data: {
          version,
          config: typeof config === "string" ? JSON.parse(config) : config,
          active: false,
          status: "draft",
          createdById: auth.id,
          notes: notes || `Draft created by ${auth.name}`,
        },
      }),
      undefined,
      { entityId: (r) => r.id },
    );

    return apiSuccess(newConfig, undefined, 201);
  } catch (error) {
    return handleApiError(error, "scoring-config POST");
  }
}

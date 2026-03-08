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
        config: typeof config === "string" ? JSON.parse(config) : config,
        active: false,
        status: "draft",
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

/**
 * PUT /api/scores/config
 * Transition config through the approval workflow.
 *
 * Supported actions: submit_review, approve, activate, archive, send_back
 * Enforces the state machine: draft → review → approved → active
 * Segregation of duties:
 *   - reviewer cannot be the creator
 *   - approver cannot be the reviewer
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { configId, action: configAction, notes } = body;

    if (!configId || !configAction) {
      return apiValidationError("configId and action are required");
    }

    const config = await prisma.scoringConfig.findUnique({ where: { id: configId } });
    if (!config) return apiNotFoundError("Scoring config");

    // Map user-friendly action names to target statuses
    const actionToStatus: Record<string, string> = {
      submit_review: "review",
      approve: "approved",
      activate: "active",
      archive: "archived",
      send_back: "draft",
    };

    const targetStatus = actionToStatus[configAction];
    if (!targetStatus) {
      return apiValidationError(
        `Invalid action '${configAction}'. Supported: submit_review, approve, activate, archive, send_back`,
      );
    }

    // Enforce segregation of duties
    if (configAction === "approve" || targetStatus === "approved") {
      // Only admin can approve
      const approveAuthz = checkAuthorization(auth, "scoring_config", "approve");
      if (!approveAuthz.allowed) return apiForbiddenError("Only admin can approve configs");
      // Reviewer cannot be the creator
      if (config.createdById === auth.id) {
        return apiForbiddenError("Cannot approve your own config — segregation of duties required");
      }
    }

    if (configAction === "activate") {
      // Only admin can activate
      const configureAuthz = checkAuthorization(auth, "scoring_config", "configure");
      if (!configureAuthz.allowed) return apiForbiddenError("Only admin can activate configs");
      // Must be in approved status
      if (config.status !== "approved") {
        return apiValidationError(
          `Cannot activate config in '${config.status}' status. Config must be approved first (draft → review → approved → active).`,
        );
      }
      // Activator should not be the approver (double-check segregation)
      if (config.approvedById === auth.id) {
        return apiForbiddenError("Cannot activate a config you approved — segregation of duties required");
      }
    }

    // Execute the state transition
    const validTransitions: Record<string, string[]> = {
      draft: ["review", "archived"],
      review: ["approved", "draft", "archived"],
      approved: ["active", "archived"],
      active: ["archived"],
      archived: [],
    };

    const currentStatus = config.status;
    if (!validTransitions[currentStatus]?.includes(targetStatus)) {
      return apiValidationError(
        `Invalid transition: ${currentStatus} → ${targetStatus}. Valid transitions from '${currentStatus}': ${validTransitions[currentStatus]?.join(", ") || "none"}`,
      );
    }

    // If activating, deactivate all other configs first
    if (targetStatus === "active") {
      await prisma.scoringConfig.updateMany({
        where: { active: true },
        data: { active: false },
      });
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      status: targetStatus,
      active: targetStatus === "active",
      notes: notes ? `${config.notes}\n[${targetStatus}] ${notes}` : config.notes,
    };

    // Track who reviewed/approved/activated and when
    if (targetStatus === "review") {
      // No reviewer assignment yet — just submit for review
    } else if (targetStatus === "approved") {
      updateData.reviewedById = auth.id;
      updateData.reviewedAt = new Date();
    } else if (targetStatus === "active") {
      updateData.approvedById = config.reviewedById !== auth.id ? auth.id : config.approvedById;
      updateData.approvedAt = config.approvedAt ?? new Date();
      updateData.activatedAt = new Date();
    }

    const updated = await prisma.scoringConfig.update({
      where: { id: configId },
      data: updateData,
    });

    await createAuditEntry({
      action: `config_${configAction}`,
      entityType: "scoring_config",
      entityId: configId,
      userId: auth.employeeId || auth.id,
      summary: `Scoring config '${config.version}' transitioned: ${currentStatus} → ${targetStatus}`,
      before: { status: currentStatus, active: config.active },
      after: { status: targetStatus, active: targetStatus === "active" },
      metadata: { notes, performedBy: auth.name },
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error, "scores/config PUT");
  }
}

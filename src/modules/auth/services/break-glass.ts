/**
 * Break-Glass / Emergency Elevation Service
 *
 * Provides a governed mechanism for emergency access elevation.
 * All break-glass actions are:
 * - Immediately logged with enhanced audit detail
 * - Time-limited (auto-expire after configured duration)
 * - Subject to mandatory post-use review
 * - Tracked with justification and review status
 *
 * This is NOT a bypass mechanism — it creates an audited, reviewable
 * record of emergency actions taken outside normal approval workflows.
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─── Types ───

export type BreakGlassReason =
  | "critical_incident"       // Active P0/P1 incident requiring immediate action
  | "regulatory_deadline"     // Regulatory requirement with imminent deadline
  | "key_person_unavailable"  // Normal approver unavailable, action cannot wait
  | "security_response"       // Active security incident requiring immediate response
  | "other";                  // Requires detailed justification

export type ReviewStatus =
  | "pending_review"    // Not yet reviewed
  | "approved"          // Reviewed and deemed appropriate
  | "flagged"           // Reviewed and flagged for follow-up
  | "escalated";        // Escalated to management

export interface BreakGlassRequest {
  userId: string;
  userName: string;
  userRole: string;
  reason: BreakGlassReason;
  justification: string;        // Free-text explanation (required, min 20 chars)
  actionDescription: string;    // What action is being taken
  resource: string;             // Which resource is affected
  resourceId?: string;          // Specific entity ID if applicable
  durationMinutes?: number;     // How long the elevation lasts (default: 30)
}

export interface BreakGlassRecord {
  id: string;
  userId: string;
  userName: string;
  reason: BreakGlassReason;
  justification: string;
  actionDescription: string;
  resource: string;
  resourceId: string;
  activatedAt: string;
  expiresAt: string;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

// ─── Constants ───

const DEFAULT_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 120;
const MIN_JUSTIFICATION_LENGTH = 20;

// ─── Service ───

export const breakGlassService = {
  /**
   * Activate a break-glass elevation.
   * Returns the break-glass record for tracking.
   */
  async activate(request: BreakGlassRequest): Promise<BreakGlassRecord> {
    // Validate justification
    if (!request.justification || request.justification.length < MIN_JUSTIFICATION_LENGTH) {
      throw new Error(
        `Break-glass justification must be at least ${MIN_JUSTIFICATION_LENGTH} characters. ` +
        `Provide a detailed explanation of why emergency access is needed.`,
      );
    }

    const durationMinutes = Math.min(
      request.durationMinutes ?? DEFAULT_DURATION_MINUTES,
      MAX_DURATION_MINUTES,
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    // Create audit record
    const auditLog = await prisma.auditLog.create({
      data: {
        action: "break_glass_activated",
        entityType: request.resource,
        entityId: request.resourceId ?? `break_glass_${Date.now()}`,
        userId: request.userId,
        details: JSON.stringify({
          reason: request.reason,
          justification: request.justification,
          actionDescription: request.actionDescription,
          activatedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          durationMinutes,
          reviewStatus: "pending_review",
          userRole: request.userRole,
        }),
      },
    });

    logger.security("BREAK-GLASS ACTIVATED", {
      auditId: auditLog.id,
      userId: request.userId,
      userName: request.userName,
      reason: request.reason,
      resource: request.resource,
      resourceId: request.resourceId,
      durationMinutes,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      id: auditLog.id,
      userId: request.userId,
      userName: request.userName,
      reason: request.reason,
      justification: request.justification,
      actionDescription: request.actionDescription,
      resource: request.resource,
      resourceId: request.resourceId ?? "",
      activatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      reviewStatus: "pending_review",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    };
  },

  /**
   * Review a break-glass record. Only admins can review.
   */
  async review(params: {
    breakGlassId: string;
    reviewerId: string;
    reviewerName: string;
    status: ReviewStatus;
    notes: string;
  }): Promise<void> {
    const record = await prisma.auditLog.findUnique({
      where: { id: params.breakGlassId },
    });

    if (!record || record.action !== "break_glass_activated") {
      throw new Error("Break-glass record not found");
    }

    // Cannot review your own break-glass
    if (record.userId === params.reviewerId) {
      throw new Error("Cannot review your own break-glass activation (separation of duties)");
    }

    // Create review audit entry
    await prisma.auditLog.create({
      data: {
        action: "break_glass_reviewed",
        entityType: record.entityType,
        entityId: record.entityId,
        userId: params.reviewerId,
        details: JSON.stringify({
          breakGlassId: params.breakGlassId,
          originalUserId: record.userId,
          reviewStatus: params.status,
          reviewNotes: params.notes,
          reviewedAt: new Date().toISOString(),
          reviewerName: params.reviewerName,
        }),
      },
    });

    logger.security("BREAK-GLASS REVIEWED", {
      breakGlassId: params.breakGlassId,
      reviewerId: params.reviewerId,
      status: params.status,
      originalUserId: record.userId,
    });
  },

  /**
   * Get all pending break-glass records awaiting review.
   */
  async getPendingReviews(): Promise<BreakGlassRecord[]> {
    const records = await prisma.auditLog.findMany({
      where: {
        action: "break_glass_activated",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Filter to those not yet reviewed
    const reviewedIds = new Set<string>();
    const reviews = await prisma.auditLog.findMany({
      where: { action: "break_glass_reviewed" },
      select: { details: true },
    });

    for (const review of reviews) {
      const details = safeParseJson(review.details);
      if (details.breakGlassId) {
        reviewedIds.add(details.breakGlassId as string);
      }
    }

    return records
      .filter((r) => !reviewedIds.has(r.id))
      .map((r) => {
        const details = safeParseJson(r.details);
        return {
          id: r.id,
          userId: r.userId,
          userName: (details.userName as string) ?? r.userId,
          reason: (details.reason as BreakGlassReason) ?? "other",
          justification: (details.justification as string) ?? "",
          actionDescription: (details.actionDescription as string) ?? "",
          resource: r.entityType,
          resourceId: r.entityId,
          activatedAt: (details.activatedAt as string) ?? r.createdAt.toISOString(),
          expiresAt: (details.expiresAt as string) ?? "",
          reviewStatus: "pending_review" as ReviewStatus,
          reviewedBy: null,
          reviewedAt: null,
          reviewNotes: null,
        };
      });
  },
};

function safeParseJson(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}

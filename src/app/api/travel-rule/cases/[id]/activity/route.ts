import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/**
 * GET /api/travel-rule/cases/:id/activity
 *
 * Returns a unified chronological feed merging AuditLog entries
 * and CaseNote entries for the given case.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "travel_rule_case", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const [auditEntries, notes] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          entityType: "travel_rule_case",
          entityId: params.id,
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.caseNote.findMany({
        where: { caseId: params.id },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Build unified feed
    const feed: Array<{
      id: string;
      type: "audit" | "note";
      action?: string;
      description: string;
      actorName: string;
      content?: string;
      details?: string;
      createdAt: Date;
    }> = [];

    for (const entry of auditEntries) {
      let details: Record<string, unknown> = {};
      try {
        details = typeof entry.details === "string" ? JSON.parse(entry.details || "{}") : (entry.details as Record<string, unknown> ?? {});
      } catch {
        // ignore
      }

      let description = entry.action;
      if (details.description) {
        description = details.description as string;
      } else {
        switch (entry.action) {
          case "travel_rule_case_created":
            description = "Case opened";
            break;
          case "travel_rule_email_sent":
            description = `Email sent to ${(details.recipientEmail as string) || "counterparty"}`;
            break;
          case "travel_rule_case_updated": {
            const parts: string[] = [];
            const ownerChange = details.ownerChange as { newName?: string } | undefined;
            const statusChange = details.statusChange as { previous?: string; new?: string } | undefined;
            if (ownerChange) {
              parts.push(`Assigned to ${ownerChange.newName || "someone"}`);
            }
            if (statusChange) {
              parts.push(`Status: ${statusChange.previous} → ${statusChange.new}`);
            }
            description = parts.length > 0 ? parts.join("; ") : "Case updated";
            break;
          }
          case "case_note_added":
            description = "Note added";
            break;
          case "travel_rule_bulk_action":
            description = `Bulk action: ${(details.action as string) || "update"}`;
            break;
          default:
            description = entry.action.replace(/_/g, " ");
        }
      }

      feed.push({
        id: entry.id,
        type: "audit",
        action: entry.action,
        description,
        actorName: entry.user?.name || "System",
        details: typeof entry.details === "string" ? entry.details : JSON.stringify(entry.details),
        createdAt: entry.createdAt,
      });
    }

    for (const note of notes) {
      feed.push({
        id: note.id,
        type: "note",
        action: "note",
        description: "Note added",
        actorName: note.author?.name || "Unknown",
        content: note.content,
        createdAt: note.createdAt,
      });
    }

    // Sort combined feed by time descending
    feed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return apiSuccess(feed);
  } catch (error) {
    return handleApiError(error, "travel-rule activity");
  }
}

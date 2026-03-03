import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

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
        details = JSON.parse(entry.details || "{}");
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
            description = `Email sent to ${(details as any).recipientEmail || "counterparty"}`;
            break;
          case "travel_rule_case_updated": {
            const parts: string[] = [];
            if (details.ownerChange) {
              parts.push(`Assigned to ${(details as any).ownerChange?.newName || "someone"}`);
            }
            if (details.statusChange) {
              parts.push(`Status: ${(details as any).statusChange?.previous} → ${(details as any).statusChange?.new}`);
            }
            description = parts.length > 0 ? parts.join("; ") : "Case updated";
            break;
          }
          case "case_note_added":
            description = "Note added";
            break;
          case "travel_rule_bulk_action":
            description = `Bulk action: ${(details as any).action || "update"}`;
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
        details: entry.details,
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

    return NextResponse.json({ success: true, data: feed });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

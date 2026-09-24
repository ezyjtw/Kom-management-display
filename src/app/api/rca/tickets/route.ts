import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { z } from "zod";
import { validateBody } from "@/lib/validation";
import { browseUrl, getIssue, isAtlassianConfigured } from "@/lib/integrations/atlassian/client";
import { env } from "@/lib/env";
import { auditedResponse } from "@/lib/api/audit";
import { auditActor } from "@/modules/core-data/audit-actor";

/**
 * Only tickets on the Komainu Jira site are read here. Vendor tickets on other
 * Atlassian sites (e.g. the Ledger service desk) arrive through vendor emails
 * (spec §8.5, §12 CHK-12); no credentials for vendor sites are ever stored.
 */
function onKomainuSite(url: string): boolean {
  if (!url) return true;
  try {
    return new URL(url).host === new URL(env("ATLASSIAN_BASE_URL") ?? "https://invalid.invalid").host;
  } catch {
    return false;
  }
}

// Statuses that providers use to "close" tickets — if the ticket moves to one
// of these and our RCA isn't done, it's a premature closure.
const PROVIDER_DONE_STATUSES = ["Done", "Closed", "Resolved", "Complete", "Won't Do", "Cancelled"];

function isClosedStatus(status: string): boolean {
  return PROVIDER_DONE_STATUSES.some((s) => status.toLowerCase() === s.toLowerCase());
}

/**
 * GET /api/rca/tickets?incidentId=xxx
 * Fetch the current status of an external ticket from Jira and detect premature closures.
 * If no incidentId, syncs all incidents that have an external ticket ref.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "incident", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const { searchParams } = new URL(request.url);
    const incidentId = searchParams.get("incidentId");

    if (!isAtlassianConfigured()) {
      return apiSuccess({ configured: false, message: "Jira not configured" });
    }

    // Find incidents to sync
    const where: Record<string, unknown> = {
      externalTicketRef: { not: "" },
    };
    if (incidentId) where.id = incidentId;

    const incidents = await prisma.incident.findMany({
      where,
      select: {
        id: true,
        externalTicketRef: true,
        externalTicketStatus: true,
        rcaStatus: true,
        externalTicketDisputed: true,
        externalTicketDisputeReason: true,
        provider: true,
        title: true,
        externalTicketUrl: true,
      },
    });

    if (incidents.length === 0) {
      return apiSuccess({ configured: true, synced: 0, incidents: [] });
    }

    const results: Array<{
      incidentId: string;
      ticketRef: string;
      previousStatus: string;
      currentStatus: string;
      prematureClosure: boolean;
    }> = [];

    for (const inc of incidents) {
      if (!onKomainuSite(inc.externalTicketUrl)) continue; // vendor site: status comes from vendor emails
      try {
        const issue = await getIssue(inc.externalTicketRef, ["status", "resolution"]).catch(() => null);
        // Ticket might not exist or access denied — skip
        if (!issue) continue;

        const currentStatus = issue.fields?.status?.name || "Unknown";
        const previousStatus = inc.externalTicketStatus;

        // Update the incident's external ticket status
        await prisma.incident.update({
          where: { id: inc.id },
          data: {
            externalTicketStatus: currentStatus,
            externalTicketLastSyncAt: new Date(),
          },
        });

        let prematureClosure = false;

        // Detect status change
        if (previousStatus && previousStatus !== currentStatus) {
          await prisma.externalTicketEvent.create({
            data: {
              incidentId: inc.id,
              event: "status_changed",
              fromStatus: previousStatus,
              toStatus: currentStatus,
              performedBy: "jira_sync",
            },
          });

          // Detect premature closure: provider closed it but our RCA isn't done
          if (
            isClosedStatus(currentStatus) &&
            !isClosedStatus(previousStatus) &&
            inc.rcaStatus !== "closed" &&
            inc.rcaStatus !== "none"
          ) {
            prematureClosure = true;

            await prisma.externalTicketEvent.create({
              data: {
                incidentId: inc.id,
                event: "provider_closed",
                fromStatus: previousStatus,
                toStatus: currentStatus,
                performedBy: "jira_sync",
                reason: `Provider closed ticket while RCA status is "${inc.rcaStatus}"`,
              },
            });

            // Auto-flag the dispute
            await prisma.incident.update({
              where: { id: inc.id },
              data: {
                externalTicketDisputed: true,
                externalTicketDisputeReason:
                  inc.externalTicketDisputeReason ||
                  `Ticket closed prematurely — RCA still in "${inc.rcaStatus}" status`,
              },
            });
          }
        }

        results.push({
          incidentId: inc.id,
          ticketRef: inc.externalTicketRef,
          previousStatus,
          currentStatus,
          prematureClosure,
        });
      } catch {
        // Individual ticket fetch failures shouldn't break the loop
        continue;
      }
    }

    return apiSuccess({
      configured: true,
      synced: results.length,
      incidents: results,
    });
  } catch (error) {
    return handleApiError(error, "rca/tickets GET");
  }
}

/**
 * POST /api/rca/tickets
 * Actions on external (provider) tickets:
 * - link: link a provider ticket to an incident
 * - dispute: dispute a premature closure (optional draft comment for the provider)
 * - reopen_request: record that we are asking the provider to reopen (draft comment)
 * - comment_sent: a person confirms they sent the drafted comment to the provider
 * - resolve_dispute: the dispute is resolved
 *
 * Comments to providers are drafts only (spec §12 CHK-12): KOMmand Centre never
 * posts to a provider ticket; a person sends the text and records it here.
 */
const rcaActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), incidentId: z.string().min(1), ticketRef: z.string().trim().min(1).max(100), ticketUrl: z.string().url().max(500).optional() }),
  z.object({ action: z.literal("dispute"), incidentId: z.string().min(1), reason: z.string().trim().min(3).max(2000), draftComment: z.string().max(5000).optional() }),
  z.object({ action: z.literal("reopen_request"), incidentId: z.string().min(1), reason: z.string().trim().max(2000).optional(), draftComment: z.string().trim().min(3).max(5000) }),
  z.object({ action: z.literal("comment_sent"), incidentId: z.string().min(1), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("resolve_dispute"), incidentId: z.string().min(1), reason: z.string().trim().max(2000).optional() }),
]);

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authz = requireAuthorization(auth, "incident", "update");
  if (authz instanceof NextResponse) return authz;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const auditActorInfo = auditActor(auth);
    // Fail-closed audit (spec §17.7, audit policy: src/lib/api/audit-policy.ts).
    return await auditedResponse(
      { action: "rca_ticket_action", entityType: "incident", entityId: new URL(request.url).pathname, userId: auditActorInfo.userId, summary: "RCA ticket action", metadata: auditActorInfo.metadata },
      async () => {
        const parsed = validateBody(rcaActionSchema, await request.json());
        if (!parsed.success) return apiValidationError(parsed.error);
        const body = parsed.data;
        const { incidentId } = body;
        const actorId = auth.employeeId || auth.id;

        switch (body.action) {
          case "link": {
            const url = body.ticketUrl || browseUrl(body.ticketRef) || "";
            await prisma.$transaction([
              prisma.incident.update({ where: { id: incidentId }, data: { externalTicketRef: body.ticketRef, externalTicketUrl: url } }),
              prisma.externalTicketEvent.create({
                data: { incidentId, event: "status_changed", toStatus: "linked", performedBy: actorId, reason: `Linked external ticket ${body.ticketRef}` },
              }),
            ]);
            return apiSuccess(undefined);
          }

          case "dispute": {
            await prisma.$transaction([
              prisma.incident.update({ where: { id: incidentId }, data: { externalTicketDisputed: true, externalTicketDisputeReason: body.reason } }),
              prisma.externalTicketEvent.create({
                data: { incidentId, event: "disputed", performedBy: actorId, reason: body.reason, jiraComment: body.draftComment ? `DRAFT (not sent): ${body.draftComment}` : "" },
              }),
            ]);
            return apiSuccess({ draftComment: body.draftComment ?? null, sent: false });
          }

          case "reopen_request": {
            await prisma.externalTicketEvent.create({
              data: {
                incidentId, event: "reopen_requested", performedBy: actorId,
                reason: body.reason || "Requested provider to reopen ticket",
                jiraComment: `DRAFT (not sent): ${body.draftComment}`,
              },
            });
            return apiSuccess({ draftComment: body.draftComment, sent: false });
          }

          case "comment_sent": {
            await prisma.externalTicketEvent.create({
              data: { incidentId, event: "comment_sent_by_human", performedBy: actorId, reason: body.note || "Drafted comment sent to the provider by a person" },
            });
            return apiSuccess(undefined);
          }

          case "resolve_dispute": {
            await prisma.$transaction([
              prisma.incident.update({ where: { id: incidentId }, data: { externalTicketDisputed: false, externalTicketDisputeReason: "" } }),
              prisma.externalTicketEvent.create({
                data: { incidentId, event: "reopen_confirmed", performedBy: actorId, reason: body.reason || "Dispute resolved — ticket reopened or satisfactory" },
              }),
            ]);
            return apiSuccess(undefined);
          }
        }
      },
    );
  } catch (error) {
    return handleApiError(error, "rca/tickets POST");
  }
}

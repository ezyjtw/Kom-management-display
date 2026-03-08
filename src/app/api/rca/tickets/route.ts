import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { apiSuccess, apiValidationError, handleApiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";

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

  try {
    const { searchParams } = new URL(request.url);
    const incidentId = searchParams.get("incidentId");

    // Get Jira config
    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const apiToken = process.env.JIRA_API_TOKEN;

    if (!baseUrl || !email || !apiToken) {
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
      },
    });

    if (incidents.length === 0) {
      return apiSuccess({ configured: true, synced: 0, incidents: [] });
    }

    const jiraAuth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    const results: Array<{
      incidentId: string;
      ticketRef: string;
      previousStatus: string;
      currentStatus: string;
      prematureClosure: boolean;
    }> = [];

    for (const inc of incidents) {
      try {
        const res = await fetch(
          `${baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${inc.externalTicketRef}?fields=status,resolution`,
          { headers: { Authorization: `Basic ${jiraAuth}`, Accept: "application/json" } },
        );

        if (!res.ok) {
          // Ticket might not exist or access denied — skip
          continue;
        }

        const issue = await res.json();
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
 * Actions on external tickets:
 * - link: Link a Jira ticket to an incident
 * - dispute: Dispute a premature closure
 * - reopen_request: Log that you've asked the provider to reopen
 * - resolve_dispute: Mark a dispute as resolved (they reopened or we're satisfied)
 *
 * Body: { incidentId, action, ticketRef?, ticketUrl?, reason?, jiraComment? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { incidentId, action } = body;

    if (!incidentId || !action) {
      return apiValidationError("incidentId and action are required");
    }

    const actorId = auth.employeeId || auth.id;

    switch (action) {
      case "link": {
        const { ticketRef, ticketUrl } = body;
        if (!ticketRef) {
          return apiValidationError("ticketRef is required");
        }

        // If no URL provided, try to construct from JIRA_BASE_URL
        let url = ticketUrl || "";
        if (!url && process.env.JIRA_BASE_URL) {
          url = `${process.env.JIRA_BASE_URL.replace(/\/$/, "")}/browse/${ticketRef}`;
        }

        await prisma.$transaction([
          prisma.incident.update({
            where: { id: incidentId },
            data: {
              externalTicketRef: ticketRef,
              externalTicketUrl: url,
            },
          }),
          prisma.externalTicketEvent.create({
            data: {
              incidentId,
              event: "status_changed",
              toStatus: "linked",
              performedBy: actorId,
              reason: `Linked external ticket ${ticketRef}`,
            },
          }),
        ]);

        return apiSuccess(undefined);
      }

      case "dispute": {
        const { reason } = body;
        if (!reason) {
          return apiValidationError("reason is required for dispute");
        }

        await prisma.$transaction([
          prisma.incident.update({
            where: { id: incidentId },
            data: {
              externalTicketDisputed: true,
              externalTicketDisputeReason: reason,
            },
          }),
          prisma.externalTicketEvent.create({
            data: {
              incidentId,
              event: "disputed",
              performedBy: actorId,
              reason,
              jiraComment: body.jiraComment || "",
            },
          }),
        ]);

        // If Jira is configured and a comment was provided, post it to the ticket
        if (body.jiraComment) {
          await postJiraComment(incidentId, body.jiraComment);
        }

        return apiSuccess(undefined);
      }

      case "reopen_request": {
        await prisma.externalTicketEvent.create({
          data: {
            incidentId,
            event: "reopen_requested",
            performedBy: actorId,
            reason: body.reason || "Requested provider to reopen ticket",
            jiraComment: body.jiraComment || "",
          },
        });

        if (body.jiraComment) {
          await postJiraComment(incidentId, body.jiraComment);
        }

        return apiSuccess(undefined);
      }

      case "resolve_dispute": {
        await prisma.$transaction([
          prisma.incident.update({
            where: { id: incidentId },
            data: {
              externalTicketDisputed: false,
              externalTicketDisputeReason: "",
            },
          }),
          prisma.externalTicketEvent.create({
            data: {
              incidentId,
              event: "reopen_confirmed",
              performedBy: actorId,
              reason: body.reason || "Dispute resolved — ticket reopened or satisfactory",
            },
          }),
        ]);

        return apiSuccess(undefined);
      }

      default:
        return apiValidationError(`Unknown action: ${action}`);
    }
  } catch (error) {
    return handleApiError(error, "rca/tickets POST");
  }
}

/**
 * Post a comment to a Jira ticket linked to an incident.
 * Silently fails if Jira is not configured or the request fails.
 */
async function postJiraComment(incidentId: string, comment: string) {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return;

  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { externalTicketRef: true },
    });
    if (!incident?.externalTicketRef) return;

    const jiraAuth = Buffer.from(`${email}:${apiToken}`).toString("base64");
    await fetch(
      `${baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${incident.externalTicketRef}/comment`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${jiraAuth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: comment }],
              },
            ],
          },
        }),
      },
    );
  } catch {
    // Silent fail — we log the event locally regardless
  }
}

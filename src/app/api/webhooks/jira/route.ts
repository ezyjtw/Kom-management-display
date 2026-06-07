import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyJiraWebhook } from "@/lib/webhook-verify";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { normaliseSubject, deriveAutoPriority } from "@/lib/thread-utils";
import { computeTtoDeadline } from "@/lib/sla";
import type { ThreadPriority } from "@/types";
import { env } from "@/lib/env";

function mapNormalizedStatus(jiraStatus: string): string {
  const lower = jiraStatus.toLowerCase();
  if (["to do", "open", "backlog", "new"].includes(lower)) return "open";
  if (["in progress", "in review", "in development"].includes(lower)) return "in_progress";
  if (["done", "closed", "resolved"].includes(lower)) return "resolved";
  return lower;
}

function mapPriority(priorityName: string | undefined | null, issueTypeName: string, summary: string): ThreadPriority {
  const p = priorityName?.toLowerCase() ?? "";
  if (["highest", "blocker"].includes(p)) return "P0";
  if (["high", "critical"].includes(p)) return "P1";
  if (["medium"].includes(p)) return "P2";
  if (["low", "lowest", "trivial"].includes(p)) return "P3";

  const issueType = issueTypeName.toLowerCase();
  if (["incident", "outage"].includes(issueType)) return "P0";
  if (["bug"].includes(issueType)) return "P1";
  if (["change", "task"].includes(issueType)) return "P2";
  if (["sub-task", "subtask"].includes(issueType)) return "P3";

  return deriveAutoPriority({ subject: summary }) ?? "P2";
}

async function resolveEmployeeId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const employee = await prisma.employee.findFirst({ where: { email, active: true } });
  return employee?.id ?? null;
}

interface JiraWebhookIssue {
  key: string;
  id: string;
  fields: {
    summary: string;
    description?: string | null;
    status: { name: string };
    priority?: { name: string } | null;
    issuetype: { name: string };
    assignee?: { displayName: string; emailAddress: string } | null;
    reporter?: { displayName: string; emailAddress: string } | null;
    project: { key: string; name: string };
    created: string;
    updated: string;
    labels?: string[];
  };
}

interface JiraWebhookPayload {
  webhookEvent: string;
  timestamp: number;
  issue?: JiraWebhookIssue;
  comment?: {
    id: string;
    body: string | Record<string, unknown>;
    author: { displayName: string; emailAddress?: string };
    created: string;
  };
  changelog?: {
    items: Array<{
      field: string;
      fromString: string | null;
      toString: string | null;
    }>;
  };
}

async function upsertJiraIssueState(issue: JiraWebhookIssue): Promise<void> {
  const normalizedStatus = mapNormalizedStatus(issue.fields.status.name);
  const isResolved = normalizedStatus === "resolved";
  const employeeId = await resolveEmployeeId(issue.fields.assignee?.emailAddress);

  const sourceRef = `jira-${issue.key}`;
  const existingThread = await prisma.commsThread.findFirst({
    where: { sourceThreadRef: sourceRef },
    select: { id: true },
  });

  await prisma.jiraIssueState.upsert({
    where: { issueKey: issue.key },
    create: {
      issueKey: issue.key,
      issueId: issue.id,
      projectKey: issue.fields.project.key,
      summary: issue.fields.summary,
      status: normalizedStatus,
      jiraStatus: issue.fields.status.name,
      priority: mapPriority(issue.fields.priority?.name, issue.fields.issuetype.name, issue.fields.summary),
      issueType: issue.fields.issuetype.name,
      assigneeEmail: issue.fields.assignee?.emailAddress ?? null,
      assigneeName: issue.fields.assignee?.displayName ?? null,
      reporterEmail: issue.fields.reporter?.emailAddress ?? null,
      reporterName: issue.fields.reporter?.displayName ?? null,
      labels: (issue.fields.labels ?? []) as Prisma.InputJsonValue,
      resolvedAt: isResolved ? new Date(issue.fields.updated) : null,
      jiraCreatedAt: new Date(issue.fields.created),
      jiraUpdatedAt: new Date(issue.fields.updated),
      threadId: existingThread?.id ?? null,
      employeeId,
    },
    update: {
      summary: issue.fields.summary,
      status: normalizedStatus,
      jiraStatus: issue.fields.status.name,
      priority: mapPriority(issue.fields.priority?.name, issue.fields.issuetype.name, issue.fields.summary),
      issueType: issue.fields.issuetype.name,
      assigneeEmail: issue.fields.assignee?.emailAddress ?? null,
      assigneeName: issue.fields.assignee?.displayName ?? null,
      labels: (issue.fields.labels ?? []) as Prisma.InputJsonValue,
      resolvedAt: isResolved ? new Date(issue.fields.updated) : null,
      jiraUpdatedAt: new Date(issue.fields.updated),
      lastSyncedAt: new Date(),
      threadId: existingThread?.id ?? null,
      employeeId,
    },
  });
}

async function handleIssueCreated(issue: JiraWebhookIssue): Promise<void> {
  await upsertJiraIssueState(issue);

  const sourceRef = `jira-${issue.key}`;
  const existing = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });
  if (existing) return;

  const priority = mapPriority(issue.fields.priority?.name, issue.fields.issuetype.name, issue.fields.summary);
  const subject = normaliseSubject(issue.fields.summary);
  const createdAt = new Date(issue.fields.created);
  const baseUrl = env("JIRA_BASE_URL")?.replace(/\/$/, "") ?? "";
  const jiraUrl = baseUrl ? `${baseUrl}/browse/${issue.key}` : "";

  const thread = await prisma.commsThread.create({
    data: {
      source: "jira",
      sourceThreadRef: sourceRef,
      participants: JSON.stringify([
        issue.fields.assignee?.emailAddress,
        issue.fields.reporter?.emailAddress,
      ].filter(Boolean)),
      clientOrPartnerTag: issue.fields.project.key,
      subject,
      priority,
      status: "Unassigned",
      queue: "Transaction Operations",
      lastMessageAt: new Date(issue.fields.updated),
      ttoDeadline: computeTtoDeadline(createdAt, priority),
      linkedRecords: JSON.stringify([
        { type: "jira", id: issue.key, label: `${issue.key}: ${subject}`.substring(0, 120), url: jiraUrl },
      ]),
    },
  });

  const descText = typeof issue.fields.description === "string"
    ? issue.fields.description
    : issue.fields.description
      ? JSON.stringify(issue.fields.description).substring(0, 2000)
      : `[${issue.fields.issuetype.name}] ${issue.fields.summary}`;

  await prisma.commsMessage.create({
    data: {
      threadId: thread.id,
      authorName: issue.fields.reporter?.displayName || "Jira",
      authorType: "external",
      bodySnippet: descText.substring(0, 2000),
      bodyLink: jiraUrl,
      timestamp: createdAt,
    },
  });

  await prisma.jiraIssueState.update({
    where: { issueKey: issue.key },
    data: { threadId: thread.id },
  });
}

async function handleIssueUpdated(issue: JiraWebhookIssue, payload: JiraWebhookPayload): Promise<void> {
  await upsertJiraIssueState(issue);

  const sourceRef = `jira-${issue.key}`;
  const thread = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });
  if (!thread) return;

  const data: Record<string, unknown> = {};
  const updatedAt = new Date(issue.fields.updated);
  if (updatedAt > thread.lastMessageAt) data.lastMessageAt = updatedAt;

  const freshSubject = normaliseSubject(issue.fields.summary);
  if (freshSubject !== thread.subject) data.subject = freshSubject;

  if (Object.keys(data).length > 0) {
    await prisma.commsThread.update({ where: { id: thread.id }, data });
  }

  if (payload.changelog?.items) {
    const statusChange = payload.changelog.items.find((i) => i.field === "status");
    if (statusChange) {
      const incident = await prisma.incident.findFirst({
        where: { externalTicketRef: issue.key },
      });
      if (incident) {
        await prisma.externalTicketEvent.create({
          data: {
            incidentId: incident.id,
            event: "status_changed",
            fromStatus: statusChange.fromString ?? "",
            toStatus: statusChange.toString ?? "",
            performedBy: "jira_webhook",
          },
        });
      }
    }
  }
}

async function handleIssueDeleted(issue: JiraWebhookIssue): Promise<void> {
  await prisma.jiraIssueState.updateMany({
    where: { issueKey: issue.key },
    data: { status: "deleted", lastSyncedAt: new Date() },
  });

  const sourceRef = `jira-${issue.key}`;
  const thread = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });
  if (thread) {
    await prisma.commsThread.update({
      where: { id: thread.id },
      data: { status: "Closed" },
    });
  }
}

async function handleCommentEvent(issue: JiraWebhookIssue, payload: JiraWebhookPayload): Promise<void> {
  if (!payload.comment) return;

  const sourceRef = `jira-${issue.key}`;
  const thread = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });
  if (!thread) return;

  const commentBody = typeof payload.comment.body === "string"
    ? payload.comment.body
    : JSON.stringify(payload.comment.body).substring(0, 2000);

  await prisma.commsMessage.create({
    data: {
      threadId: thread.id,
      authorName: payload.comment.author.displayName,
      authorEmail: payload.comment.author.emailAddress ?? "",
      authorType: "external",
      bodySnippet: commentBody.substring(0, 2000),
      timestamp: new Date(payload.comment.created),
    },
  });

  await prisma.commsThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: new Date(payload.comment.created) },
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-hub-signature");

    const isValid = await verifyJiraWebhook(rawBody, signatureHeader);
    if (!isValid) {
      logger.security("Jira webhook rejected: invalid signature");
      return apiSuccess({ error: "Invalid signature" }, undefined, 401);
    }

    const payload: JiraWebhookPayload = JSON.parse(rawBody);
    const webhookEvent = payload.webhookEvent;
    const issue = payload.issue;

    if (!webhookEvent || !issue) {
      return apiSuccess({ status: "ignored", reason: "no event or issue" });
    }

    const eventId = `${payload.timestamp}-${issue.key}`;

    const existing = await prisma.webhookEvent.findUnique({
      where: { source_eventId: { source: "jira", eventId } },
    });
    if (existing) {
      return apiSuccess({ status: "duplicate", eventId });
    }

    await prisma.webhookEvent.create({
      data: {
        source: "jira",
        eventId,
        eventType: webhookEvent,
        payload: payload as unknown as Prisma.InputJsonValue,
        signature: signatureHeader ?? "",
        status: "processing",
      },
    });

    try {
      switch (webhookEvent) {
        case "jira:issue_created":
          await handleIssueCreated(issue);
          break;
        case "jira:issue_updated":
          await handleIssueUpdated(issue, payload);
          break;
        case "jira:issue_deleted":
          await handleIssueDeleted(issue);
          break;
        case "comment_created":
        case "comment_updated":
          await handleCommentEvent(issue, payload);
          break;
        default:
          logger.info("Jira webhook: unhandled event type", { webhookEvent });
      }

      await prisma.webhookEvent.update({
        where: { source_eventId: { source: "jira", eventId } },
        data: { status: "processed", processedAt: new Date() },
      });

      return apiSuccess({ status: "processed", eventId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.webhookEvent.update({
        where: { source_eventId: { source: "jira", eventId } },
        data: { status: "failed", failureReason: message },
      });
      logger.error("Jira webhook processing failed", { eventId, error: message });
      return apiSuccess({ status: "failed", eventId, error: message }, undefined, 500);
    }
  } catch (error) {
    return handleApiError(error, "POST /api/webhooks/jira");
  }
}

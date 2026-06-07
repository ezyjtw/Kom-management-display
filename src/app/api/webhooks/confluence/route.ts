import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyConfluenceWebhook } from "@/lib/webhook-verify";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { normaliseSubject } from "@/lib/thread-utils";
import { env } from "@/lib/env";

interface ConfluenceWebhookPayload {
  timestamp: number;
  event: string;
  page?: {
    id: string;
    title: string;
    status: string;
    space: { key: string };
    version: { number: number; when: string; by: { displayName: string; email?: string } };
    history?: { createdDate: string; createdBy: { displayName: string; email?: string } };
    _links?: { webui?: string };
  };
}

async function resolveEmployeeId(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const employee = await prisma.employee.findFirst({ where: { email, active: true }, select: { id: true } });
  return employee?.id ?? null;
}

async function handlePageCreatedOrUpdated(payload: ConfluenceWebhookPayload): Promise<void> {
  const page = payload.page;
  if (!page) return;

  const authorEmail = page.history?.createdBy?.email ?? null;
  const authorName = page.history?.createdBy?.displayName ?? null;
  const lastEditorEmail = page.version.by?.email ?? null;
  const lastEditorName = page.version.by?.displayName ?? null;
  const employeeId = await resolveEmployeeId(authorEmail);
  const createdInConfluence = page.history?.createdDate ? new Date(page.history.createdDate) : new Date(page.version.when);
  const updatedInConfluence = new Date(page.version.when);

  await prisma.confluencePageState.upsert({
    where: { pageId: page.id },
    create: {
      pageId: page.id,
      spaceKey: page.space.key,
      title: page.title,
      status: page.status,
      authorEmail,
      authorName,
      lastEditorEmail,
      lastEditorName,
      version: page.version.number,
      createdInConfluence,
      updatedInConfluence,
      employeeId,
    },
    update: {
      title: page.title,
      status: page.status,
      lastEditorEmail,
      lastEditorName,
      version: page.version.number,
      updatedInConfluence,
      lastSyncedAt: new Date(),
    },
  });

  const sourceRef = `confluence-${page.id}`;
  const existingThread = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });

  if (existingThread) {
    const data: Record<string, unknown> = {};
    if (updatedInConfluence > existingThread.lastMessageAt) data.lastMessageAt = updatedInConfluence;
    const freshSubject = normaliseSubject(page.title);
    if (freshSubject !== existingThread.subject) data.subject = freshSubject;
    if (Object.keys(data).length > 0) {
      await prisma.commsThread.update({ where: { id: existingThread.id }, data });
    }
    return;
  }

  const baseUrl = env("CONFLUENCE_BASE_URL")?.replace(/\/$/, "") ?? "";
  const pageUrl = page._links?.webui ? `${baseUrl}/wiki${page._links.webui}` : "";

  const thread = await prisma.commsThread.create({
    data: {
      source: "confluence",
      sourceThreadRef: sourceRef,
      participants: JSON.stringify([authorEmail, lastEditorEmail].filter(Boolean)),
      clientOrPartnerTag: page.space.key,
      subject: normaliseSubject(page.title),
      priority: "P3",
      status: "Unassigned",
      queue: "Transaction Operations",
      lastMessageAt: updatedInConfluence,
      linkedRecords: JSON.stringify([
        { type: "confluence", id: page.id, label: page.title.substring(0, 120), url: pageUrl },
      ]),
    },
  });

  await prisma.commsMessage.create({
    data: {
      threadId: thread.id,
      authorName: authorName || "Confluence",
      authorType: "internal",
      bodySnippet: `Confluence page: ${page.title} (v${page.version.number})`,
      bodyLink: pageUrl,
      timestamp: createdInConfluence,
    },
  });
}

async function handlePageTrashed(payload: ConfluenceWebhookPayload): Promise<void> {
  const page = payload.page;
  if (!page) return;

  await prisma.confluencePageState.updateMany({
    where: { pageId: page.id },
    data: { status: "trashed", lastSyncedAt: new Date() },
  });

  const sourceRef = `confluence-${page.id}`;
  const thread = await prisma.commsThread.findFirst({ where: { sourceThreadRef: sourceRef } });
  if (thread) {
    await prisma.commsThread.update({ where: { id: thread.id }, data: { status: "Closed" } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-hub-signature");

    const isValid = await verifyConfluenceWebhook(rawBody, signatureHeader);
    if (!isValid) {
      logger.security("Confluence webhook rejected: invalid signature");
      return apiSuccess({ error: "Invalid signature" }, undefined, 401);
    }

    const payload: ConfluenceWebhookPayload = JSON.parse(rawBody);
    const eventType = payload.event;
    const page = payload.page;

    if (!eventType || !page) {
      return apiSuccess({ status: "ignored", reason: "no event or page" });
    }

    const eventId = `${payload.timestamp}-${page.id}`;

    const existing = await prisma.webhookEvent.findUnique({
      where: { source_eventId: { source: "confluence", eventId } },
    });
    if (existing) {
      return apiSuccess({ status: "duplicate", eventId });
    }

    await prisma.webhookEvent.create({
      data: {
        source: "confluence",
        eventId,
        eventType,
        payload: payload as unknown as Prisma.InputJsonValue,
        signature: signatureHeader ?? "",
        status: "processing",
      },
    });

    try {
      switch (eventType) {
        case "page_created":
        case "page_updated":
          await handlePageCreatedOrUpdated(payload);
          break;
        case "page_trashed":
          await handlePageTrashed(payload);
          break;
        default:
          logger.info("Confluence webhook: unhandled event type", { eventType });
      }

      await prisma.webhookEvent.update({
        where: { source_eventId: { source: "confluence", eventId } },
        data: { status: "processed", processedAt: new Date() },
      });

      return apiSuccess({ status: "processed", eventId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.webhookEvent.update({
        where: { source_eventId: { source: "confluence", eventId } },
        data: { status: "failed", failureReason: message },
      });
      logger.error("Confluence webhook processing failed", { eventId, error: message });
      return apiSuccess({ status: "failed", eventId, error: message }, undefined, 500);
    }
  } catch (error) {
    return handleApiError(error, "POST /api/webhooks/confluence");
  }
}

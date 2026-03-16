/**
 * AI Thread Classifier — Stream 3
 *
 * Classifies comms threads using AI to determine urgency, category,
 * incident potential, and auto-creates draft incidents for service
 * provider channels when warranted.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { isAiEnabled } from "@/lib/ai";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { incidentService } from "@/modules/incidents/services/incident-service";

// ─── Types ───

export interface ThreadClassification {
  urgencyScore: number; // 0-5
  category: string; // incident | question | request | escalation | informational
  summary: string; // 1-2 sentence AI summary
  suggestedPriority: string; // P0 | P1 | P2 | P3
  isIncidentLevel: boolean; // true if this looks like it could be/become an incident
  providerName: string | null; // detected provider name, if any
  affectedServices: string[]; // detected affected services
  confidence: number; // 0-1
}

export const threadClassificationSchema = z.object({
  urgencyScore: z.number().int().min(0).max(5),
  category: z.enum(["incident", "question", "request", "escalation", "informational"]),
  summary: z.string().max(500),
  suggestedPriority: z.enum(["P0", "P1", "P2", "P3"]),
  isIncidentLevel: z.boolean(),
  providerName: z.string().nullable(),
  affectedServices: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

// ─── AI completion (follows existing pattern — complete() is private) ───

async function classifyViaAi(
  systemPrompt: string,
  userMessage: string,
): Promise<string | null> {
  if (!isAiEnabled()) return null;

  const breaker = CircuitBreaker.for("ai_classifier", {
    failureThreshold: 3,
    cooldownMs: 60_000,
  });

  try {
    return await breaker.execute(async () => {
      // Use the same provider detection as ai.ts — import dynamically
      const { getProviderName } = await import("@/lib/ai");
      const provider = getProviderName();

      if (provider === "anthropic") {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        });
        const block = response.content[0];
        return block.type === "text" ? block.text : null;
      }

      if (provider === "groq") {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            max_tokens: 512,
            temperature: 0.2,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
      }

      if (provider === "ollama") {
        const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || "llama3.1",
            stream: false,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.message?.content || null;
      }

      return null;
    });
  } catch (error) {
    logger.error("AI classifier call failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ─── Public functions ───

/**
 * Classify a thread using AI. Non-fatal — returns null on any failure.
 */
export async function classifyThread(
  threadId: string,
): Promise<ThreadClassification | null> {
  try {
    // Fetch thread + messages
    const thread = await prisma.commsThread.findUnique({
      where: { id: threadId },
      include: {
        messages: {
          orderBy: { timestamp: "desc" },
          take: 10,
          select: { bodySnippet: true, authorName: true, timestamp: true },
        },
        slackChannel: {
          select: { channelType: true, channelName: true },
        },
      },
    });

    if (!thread) {
      logger.warn("classifyThread: thread not found", { threadId });
      return null;
    }

    const channelType = thread.slackChannel?.channelType || "unknown";

    // Get active incidents summary (safe subset — NO client names)
    const activeIncidents = await prisma.incident.findMany({
      where: { status: "active" },
      select: {
        title: true,
        provider: true,
        affectedServices: true,
      },
      take: 10,
    });

    const incidentsSummary = activeIncidents.map((i) => ({
      title: i.title,
      provider: i.provider,
      affectedServices: i.affectedServices,
    }));

    // Build messages text
    const messagesText = thread.messages
      .map((m: { authorName: string; bodySnippet: string }) => `[${m.authorName}]: ${(m.bodySnippet || "").substring(0, 300)}`)
      .join("\n");

    const systemPrompt = `You are an operations triage assistant for a digital asset custody firm.
Classify this Slack/email thread for urgency and incident potential.

Respond with ONLY valid JSON matching this schema:
{
  "urgencyScore": <0-5 integer, 5=critical>,
  "category": "incident"|"question"|"request"|"escalation"|"informational",
  "summary": "<1-2 sentence summary>",
  "suggestedPriority": "P0"|"P1"|"P2"|"P3",
  "isIncidentLevel": <boolean — true if service degradation/outage/incident detected>,
  "providerName": "<detected provider or null>",
  "affectedServices": ["<service1>", "<service2>"],
  "confidence": <0-1 float>
}

Rules:
- urgencyScore 5: system outage, security breach, production down
- urgencyScore 4: service degradation, urgent client-facing issue
- urgencyScore 3: important operational issue, provider delays
- urgencyScore 1-2: routine, informational, low-impact
- urgencyScore 0: noise, already resolved
- isIncidentLevel=true only when there's evidence of service degradation or outage
- For provider channels, focus on detecting service issues`;

    const userMessage = `<untrusted_input>
Channel type: ${channelType}
Channel name: ${thread.slackChannel?.channelName || "N/A"}
Thread subject: ${thread.subject}
Thread source: ${thread.source}
Client/Partner: ${thread.clientOrPartnerTag || "N/A"}

Messages (newest first):
${messagesText}
</untrusted_input>

Active incidents for context (internal data):
${JSON.stringify(incidentsSummary)}`;

    const rawResponse = await classifyViaAi(systemPrompt, userMessage);
    if (!rawResponse) {
      logger.warn("classifyThread: AI returned null", { threadId });
      return null;
    }

    // Parse JSON from response
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("classifyThread: no JSON in AI response", { threadId });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn("classifyThread: invalid JSON from AI", { threadId });
      return null;
    }

    const result = threadClassificationSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn("classifyThread: Zod validation failed", {
        threadId,
        errors: result.error.issues,
      });
      return null;
    }

    const classification = result.data;

    // Write classification to thread
    await prisma.commsThread.update({
      where: { id: threadId },
      data: {
        aiClassification: classification as unknown as Prisma.InputJsonValue,
        aiClassifiedAt: new Date(),
        aiUrgencyScore: classification.urgencyScore,
      },
    });

    // If incident-level and service_provider channel, create draft incident
    if (classification.isIncidentLevel && channelType === "service_provider") {
      await createDraftIncident(threadId, classification);
    }

    logger.info("classifyThread: classified successfully", {
      threadId,
      urgencyScore: classification.urgencyScore,
      category: classification.category,
      isIncidentLevel: classification.isIncidentLevel,
    });

    return classification;
  } catch (error) {
    logger.error("classifyThread: unexpected error", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Create a draft incident from a classified thread.
 * Deduplicates: if an active incident with same provider + overlapping services
 * exists within 4 hours, links the thread instead.
 */
export async function createDraftIncident(
  threadId: string,
  classification: ThreadClassification,
): Promise<string | null> {
  try {
    const providerName = classification.providerName;
    if (!providerName) return null;

    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    // Check for existing active incident with same provider
    const existingIncidents = await prisma.incident.findMany({
      where: {
        provider: providerName,
        status: "active",
        createdAt: { gte: fourHoursAgo },
      },
    });

    // Check overlap with affected services
    for (const existing of existingIncidents) {
      const existingServices = Array.isArray(existing.affectedServices)
        ? (existing.affectedServices as string[])
        : [];
      const overlap = classification.affectedServices.some((s) =>
        existingServices.includes(s),
      );

      if (overlap || classification.affectedServices.length === 0) {
        // Link thread to existing incident
        const linkedIds: string[] = (() => {
          try {
            return JSON.parse(existing.linkedThreadIds as string);
          } catch {
            return [];
          }
        })();

        if (!linkedIds.includes(threadId)) {
          linkedIds.push(threadId);
          await prisma.incident.update({
            where: { id: existing.id },
            data: { linkedThreadIds: JSON.stringify(linkedIds) },
          });
        }

        logger.info("createDraftIncident: linked to existing incident", {
          threadId,
          incidentId: existing.id,
        });

        return existing.id;
      }
    }

    // Find a system user for reportedById (use first admin)
    const systemUser = await prisma.employee.findFirst({
      where: { active: true },
      select: { id: true },
    });

    if (!systemUser) {
      logger.error("createDraftIncident: no system user found");
      return null;
    }

    // Create new incident
    const severity = classification.suggestedPriority === "P0"
      ? "critical"
      : classification.suggestedPriority === "P1"
        ? "high"
        : "medium";

    const incident = await incidentService.createIncident({
      title: classification.summary.substring(0, 200),
      provider: providerName,
      severity,
      description: classification.summary,
      impact: `AI-detected from Slack thread. Affected services: ${classification.affectedServices.join(", ") || "unknown"}`,
      reportedById: systemUser.id,
      linkedThreadIds: [threadId],
    });

    // Update incident with Stream 3 fields
    await prisma.incident.update({
      where: { id: incident.id },
      data: {
        detectionSource: "ai_slack",
        affectedServices: classification.affectedServices as Prisma.InputJsonValue,
      },
    });

    logger.info("createDraftIncident: created new incident", {
      threadId,
      incidentId: incident.id,
      provider: providerName,
    });

    return incident.id;
  } catch (error) {
    logger.error("createDraftIncident: failed", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

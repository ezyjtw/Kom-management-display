/**
 * AI Comms Drafter — Stream 3
 *
 * Drafts client communications for incident impact records using AI.
 * Creates ClientCommsDraft entries with status='draft' for human review.
 * Never auto-sends — requires explicit human approval.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isAiEnabled, getProviderName } from "@/lib/ai";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { env } from "@/lib/env";

interface ImpactRecordInput {
  id: string;
  clientName: string;
  affectedServices: string[];
  impactStatus: string;
}

interface IncidentInput {
  id: string;
  title: string;
  provider: string;
  severity: string;
  description: string;
  status: string;
}

/**
 * Draft client comms for a given impact record + incident.
 *
 * - Uses AI to generate a professional, calm notification body
 * - Looks up send channel from ClientContactPreference
 * - Creates ClientCommsDraft with status='draft'
 * - On AI failure: creates draft with empty aiDraft (human writes from scratch)
 */
export async function draftClientComms(
  impactRecord: ImpactRecordInput,
  incident: IncidentInput,
): Promise<string | null> {
  try {
    // Look up client contact preference for send channel
    const clientPref = await prisma.clientContactPreference.findUnique({
      where: { clientName: impactRecord.clientName },
    });

    const sendChannel = clientPref?.preferredChannel === "slack" ? "slack" : "email";
    const sendChannelId = sendChannel === "slack"
      ? (clientPref?.slackChannel || "")
      : (clientPref?.primaryEmail || "");

    // Attempt AI draft
    let aiDraft = "";
    if (isAiEnabled()) {
      aiDraft = await generateAiDraft(impactRecord, incident) || "";
    }

    // Create draft
    const draft = await prisma.clientCommsDraft.create({
      data: {
        incidentId: incident.id,
        clientImpactRecordId: impactRecord.id,
        clientName: impactRecord.clientName,
        aiDraft,
        finalMessage: aiDraft, // Pre-fill with AI draft; human can edit before approving
        sendChannel,
        sendChannelId,
        status: "draft",
        deliveryStatus: "pending",
      },
    });

    logger.info("draftClientComms: draft created", {
      draftId: draft.id,
      clientName: impactRecord.clientName,
      incidentId: incident.id,
      hasAiDraft: aiDraft.length > 0,
      sendChannel,
    });

    return draft.id;
  } catch (error) {
    logger.error("draftClientComms: failed", {
      impactRecordId: impactRecord.id,
      incidentId: incident.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Generate AI draft for client communication.
 */
async function generateAiDraft(
  impactRecord: ImpactRecordInput,
  incident: IncidentInput,
): Promise<string | null> {
  const breaker = CircuitBreaker.for("ai_comms_drafter", {
    failureThreshold: 3,
    cooldownMs: 60_000,
  });

  const systemPrompt = `You are a client communications specialist for a digital asset custody firm.
Draft a client notification about a service incident.

Rules:
- No speculation about cause or timeline
- No specific ETAs or resolution promises
- No technical jargon — keep it accessible
- Professional, calm, reassuring tone
- 3-4 sentences maximum
- Body text only — no subject line, no greeting, no sign-off
- Mention which services are affected
- Acknowledge the impact and assure monitoring`;

  const userMessage = `<untrusted_input>
Incident: ${incident.title}
Provider: ${incident.provider}
Severity: ${incident.severity}
Status: ${incident.status}
Description: ${incident.description}
Client: ${impactRecord.clientName}
Affected services for this client: ${impactRecord.affectedServices.join(", ")}
Impact status: ${impactRecord.impactStatus}
</untrusted_input>

Draft a notification body for this client about this incident.`;

  try {
    return await breaker.execute(async () => {
      const provider = getProviderName();

      if (provider === "anthropic") {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
        const response = await client.messages.create({
          model: env("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514",
          max_tokens: 300,
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
            Authorization: `Bearer ${env("GROQ_API_KEY")}`,
          },
          body: JSON.stringify({
            model: env("GROQ_MODEL") || "llama-3.3-70b-versatile",
            max_tokens: 300,
            temperature: 0.3,
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
        const baseUrl = env("OLLAMA_BASE_URL") || "http://localhost:11434";
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: env("OLLAMA_MODEL") || "llama3.1",
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
    logger.error("generateAiDraft: AI call failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

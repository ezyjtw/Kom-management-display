import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import {
  isAiEnabled,
  getProviderName,
  generateBriefing,
  suggestThreadPriority,
  draftIncidentImpact,
  analyseClientPattern,
  draftTravelRuleEmail,
  researchToken,
  suggestTokensToOnboard,
  summariseDailyChecks,
  analyseStakingAnomaly,
  classifyScreeningRisk,
  draftRcaSummary,
  draftEscalationNote,
  analyseStuckTransactions,
} from "@/lib/ai";
import { apiSuccess, apiValidationError, handleApiError, apiError } from "@/lib/api/response";
import { checkRateLimit, RATE_LIMIT_PRESETS } from "@/lib/api/rate-limit-middleware";
import { validateBody, aiAssistSchema } from "@/lib/validation";

const AI_DISCLAIMER =
  "\n\n---\n_AI-generated guidance for internal use — not a formal compliance, legal, or regulatory sign-off. " +
  "Material decisions (e.g. token go/no-go, screening classifications, regulatory filings) " +
  "require MLRO or board approval per the compliance framework._";

const REGULATORY_ACTIONS = new Set([
  "research_token",
  "suggest_tokens",
  "classify_screening",
  "draft_escalation",
  "draft_rca",
  "draft_travel_email",
]);

/**
 * POST /api/ai/assist
 *
 * Single AI assist endpoint that routes to different AI functions based on
 * the `action` field. Every response is a suggestion — the client must
 * present it for human review before applying.
 *
 * Body: { action: string, data: Record<string, unknown> }
 *
 * Actions:
 *   - "briefing":        Generate morning ops briefing from command center data
 *   - "triage_thread":   Suggest priority for a comms thread
 *   - "draft_impact":    Draft incident operational impact text
 *   - "analyse_client":  Analyse client communication patterns
 *   - "draft_travel_email": Draft travel rule counterparty email
 *   - "summarise_checks":  Generate Jira summary from daily check results
 *   - "analyse_staking":   Explain staking reward anomalies
 *   - "classify_screening": AI-assisted screening risk classification
 *   - "draft_rca":         Draft RCA summary from incident data
 *   - "draft_escalation":  Draft compliance escalation note
 *   - "analyse_stuck_tx":  Analyse stuck transaction patterns
 *   - "status":          Check if AI is enabled (no data needed)
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, RATE_LIMIT_PRESETS.mutation);
  if (limited) return limited;

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const body = await request.json();
    const parsed = validateBody(aiAssistSchema, body);
    if (!parsed.success) return apiValidationError(parsed.error);
    const { action, data } = body;

    if (!action) {
      return apiValidationError("action is required");
    }

    // Status check — lets the UI know if AI features are available
    if (action === "status") {
      return apiSuccess({ enabled: isAiEnabled(), provider: getProviderName() });
    }

    if (!isAiEnabled()) {
      return apiError(
        "AI features not configured. Set GROQ_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL in environment.",
        503,
      );
    }

    let suggestion: unknown = null;

    switch (action) {
      case "briefing":
        suggestion = await generateBriefing(data);
        break;

      case "triage_thread":
        suggestion = await suggestThreadPriority(data);
        break;

      case "draft_impact":
        suggestion = await draftIncidentImpact(data);
        break;

      case "analyse_client":
        suggestion = await analyseClientPattern(data);
        break;

      case "draft_travel_email":
        suggestion = await draftTravelRuleEmail(data);
        break;

      case "research_token":
        suggestion = await researchToken(data);
        break;

      case "suggest_tokens":
        suggestion = await suggestTokensToOnboard(data);
        break;

      case "summarise_checks":
        suggestion = await summariseDailyChecks(data);
        break;

      case "analyse_staking":
        suggestion = await analyseStakingAnomaly(data);
        break;

      case "classify_screening":
        suggestion = await classifyScreeningRisk(data);
        break;

      case "draft_rca":
        suggestion = await draftRcaSummary(data);
        break;

      case "draft_escalation":
        suggestion = await draftEscalationNote(data);
        break;

      case "analyse_stuck_tx":
        suggestion = await analyseStuckTransactions(data);
        break;

      default:
        return apiValidationError(`Unknown action: ${action}`);
    }

    if (suggestion === null) {
      return apiError("AI failed to generate a response. Try again.", 502);
    }

    // Append disclaimer to regulatory-impacting AI outputs
    const isRegulatory = REGULATORY_ACTIONS.has(action);
    if (isRegulatory && typeof suggestion === "string") {
      suggestion = suggestion + AI_DISCLAIMER;
    } else if (isRegulatory && typeof suggestion === "object" && suggestion !== null) {
      const s = suggestion as Record<string, unknown>;
      if (typeof s.text === "string") s.text = s.text + AI_DISCLAIMER;
      else if (typeof s.summary === "string") s.summary = s.summary + AI_DISCLAIMER;
      else if (typeof s.content === "string") s.content = s.content + AI_DISCLAIMER;
      else s._disclaimer = AI_DISCLAIMER.trim();
    }

    // Audit log every AI assist invocation
    try {
      await prisma.auditLog.create({
        data: {
          action: `ai_assist_${action}`,
          entityType: "ai_assist",
          entityId: action,
          userId: auth.employeeId || auth.id,
          details: JSON.stringify({
            action,
            isRegulatory,
            timestamp: new Date().toISOString(),
          }),
        },
      });
    } catch {
      // Non-blocking — audit failure must not break the AI response
    }

    return apiSuccess({
      action,
      suggestion,
      meta: {
        type: "suggestion",
        requiresApproval: true,
        ...(isRegulatory ? { disclaimer: true } : {}),
      },
    });
  } catch (error) {
    return handleApiError(error, "ai assist");
  }
}

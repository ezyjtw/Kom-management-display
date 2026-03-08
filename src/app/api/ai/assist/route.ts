import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
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

  try {
    const body = await request.json();
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

    return apiSuccess({
      action,
      suggestion,
      // Remind the client this is a suggestion, not an action
      meta: { type: "suggestion", requiresApproval: true },
    });
  } catch (error) {
    return handleApiError(error, "ai assist");
  }
}

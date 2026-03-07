import { NextRequest, NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";
import {
  isAiEnabled,
  getProviderName,
  generateBriefing,
  suggestThreadPriority,
  draftIncidentImpact,
  analyseClientPattern,
  draftTravelRuleEmail,
  researchToken,
} from "@/lib/ai";

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
 *   - "status":          Check if AI is enabled (no data needed)
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { action, data } = body;

    if (!action) {
      return NextResponse.json(
        { success: false, error: "action is required" },
        { status: 400 },
      );
    }

    // Status check — lets the UI know if AI features are available
    if (action === "status") {
      return NextResponse.json({
        success: true,
        data: { enabled: isAiEnabled(), provider: getProviderName() },
      });
    }

    if (!isAiEnabled()) {
      return NextResponse.json({
        success: false,
        error: "AI features not configured. Set GROQ_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL in environment.",
      }, { status: 503 });
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

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }

    if (suggestion === null) {
      return NextResponse.json({
        success: false,
        error: "AI failed to generate a response. Try again.",
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      data: {
        action,
        suggestion,
        // Remind the client this is a suggestion, not an action
        meta: { type: "suggestion", requiresApproval: true },
      },
    });
  } catch (error) {
    console.error("AI assist error:", error);
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error) },
      { status: 500 },
    );
  }
}

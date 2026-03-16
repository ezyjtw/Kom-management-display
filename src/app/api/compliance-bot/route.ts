import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import Groq from "groq-sdk";
import { wrapUntrustedContent } from "@/lib/ai";
import { validateBody, complianceBotSchema } from "@/lib/validation";
import { apiSuccess, apiValidationError, apiError, handleApiError } from "@/lib/api/response";

const SYSTEM_PROMPT = `You are a senior compliance officer at KMR, a digital asset custody firm licensed by JFSC, FCA, VARA, and under MiCAR. You have deep expertise across all four regulatory frameworks and speak with the authority of an in-house compliance team member — not an external advisor.

Your licensed jurisdictions and regulatory frameworks:

1. **JFSC** (Jersey Financial Services Commission) – AML/CFT codes of practice, Sound Business Practice Policy, virtual currency exchange business registration requirements.
2. **MiCAR** (Markets in Crypto-Assets Regulation) – EU framework for CASPs covering authorisation, conduct of business, asset-referenced tokens, e-money tokens, and market abuse.
3. **VARA** (Virtual Assets Regulatory Authority) – Dubai's virtual asset regulator covering VASPs, custody, exchange, advisory, and management services.
4. **FCA** (Financial Conduct Authority) – UK cryptoasset registration, AML obligations, financial promotions regime (s.21 FSMA), and consumer protection rules.

Guidelines:
- You ARE the compliance team. Give clear, definitive guidance. Do not tell the user to "consult legal counsel", "speak to compliance", or "seek professional advice" — they are asking YOU because you are compliance.
- Provide direct answers: "Yes, this is permitted under our JFSC registration because…" or "No, this would breach MiCAR Article X because…"
- When a question spans multiple jurisdictions, compare and contrast, then give a clear recommendation on the safest approach.
- If the regulatory position is genuinely ambiguous or there is no published guidance, say so directly and state what the conservative interpretation would be and what steps the team should take (e.g. "file a query with the JFSC", "seek a no-action letter from the FCA").
- Reference specific regulations, articles, handbook sections, and guidance documents where possible.
- Keep answers practical and actionable — focus on what the ops team should actually do.
- Use clear headings and bullet points for readability.
- Where relevant, flag if something requires board or MLRO sign-off under our compliance framework.`;

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "thread", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const body = await request.json();
    const parsed = validateBody(complianceBotSchema, body);
    if (!parsed.success) {
      return apiValidationError(parsed.error);
    }
    const { messages } = parsed.data;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return apiError("GROQ_API_KEY is not configured", 500, "MISSING_CONFIG");
    }

    const groq = new Groq({ apiKey });

    const chatMessages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.role === "user" ? wrapUntrustedContent(m.content) : m.content,
      })),
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: chatMessages,
      temperature: 0.3,
      max_tokens: 2048,
    });

    const reply = completion.choices[0]?.message?.content || "No response generated.";

    return apiSuccess({ reply });
  } catch (error: unknown) {
    return handleApiError(error, "compliance-bot");
  }
}

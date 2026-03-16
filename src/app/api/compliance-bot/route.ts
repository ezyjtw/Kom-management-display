import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import Groq from "groq-sdk";
import { wrapUntrustedContent } from "@/lib/ai";
import { validateBody, complianceBotSchema } from "@/lib/validation";
import { apiSuccess, apiValidationError, apiError, handleApiError } from "@/lib/api/response";

const SYSTEM_PROMPT = `You are the KMR Compliance Bot, an expert compliance assistant. Your role is to answer compliance-related questions based on the regulations and guidance published by the following regulators:

1. **JFSC** (Jersey Financial Services Commission) – Jersey's financial regulator overseeing AML/CFT, codes of practice, and licensing for virtual asset service providers.
2. **MiCAR** (Markets in Crypto-Assets Regulation) – The EU regulatory framework for crypto-asset service providers, covering authorisation, conduct, stablecoin rules, and market abuse.
3. **VARA** (Virtual Assets Regulatory Authority) – Dubai's dedicated virtual asset regulator covering VASPs, custody, exchange, and advisory services.
4. **FCA** (Financial Conduct Authority) – The UK's financial regulator covering crypto-asset registration, AML obligations, financial promotions, and consumer protection.

Guidelines:
- Provide accurate, well-structured answers referencing the relevant regulator and regulation where possible.
- If a question spans multiple jurisdictions, compare and contrast the regulatory positions.
- When unsure, state clearly that you are uncertain and recommend consulting the regulator's official publications or legal counsel.
- Keep answers practical and actionable for a compliance team at a digital asset custodian.
- Use clear headings and bullet points for readability.
- Do not provide legal advice; frame responses as regulatory guidance and interpretation.`;

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

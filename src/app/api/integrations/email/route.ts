import { NextRequest, NextResponse } from "next/server";
import { syncEmailInbox, sendEmailNotification } from "@/lib/integrations/email";

/**
 * POST /api/integrations/email
 * Trigger a sync of the configured email inbox.
 *
 * Body: { queue?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { queue } = body;

    const result = await syncEmailInbox(queue);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/integrations/email
 * Get current email integration status.
 */
export async function GET() {
  const configured =
    !!process.env.IMAP_HOST &&
    !!process.env.IMAP_USER &&
    !!process.env.IMAP_PASSWORD;

  return NextResponse.json({
    success: true,
    data: {
      configured,
      inbox: configured ? process.env.IMAP_USER : null,
      smtpConfigured:
        !!process.env.SMTP_HOST &&
        !!process.env.SMTP_USER &&
        !!process.env.SMTP_PASSWORD,
    },
  });
}

/** POST /api/morning/handover/retry { date, team } — post the handover to the tickets where it failed (spec §14.3). Lead, deputy or admin. */
import { NextRequest } from "next/server";
import { retryHandover, retrySchema } from "@/modules/morning/handover";
import { handoverAction } from "@/modules/morning/http";

export async function POST(request: NextRequest) {
  return handoverAction(request, retrySchema, {
    action: "lead_handover_retried",
    entityId: (body) => `${body.team}:${body.date}`,
    run: (body, auth) => retryHandover(body, { employeeId: auth.employeeId ?? null, role: auth.role }),
    summary: (body) => `Handover retry for ${body.team} on ${body.date}`,
  });
}

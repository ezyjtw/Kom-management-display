/**
 * POST /api/morning/handover { date, team, coveringEmployeeId, note } — the
 * absent lead's handover (spec §14.3). Posts to the lead's open tickets as an
 * internal comment (today: now; later dates: 09:00 on the day).
 */
import { NextRequest } from "next/server";
import { handoverSchema, submitHandover } from "@/modules/morning/handover";
import { handoverAction } from "@/modules/morning/http";

export async function POST(request: NextRequest) {
  return handoverAction(request, handoverSchema, {
    action: "lead_handover_submitted",
    entityId: (body) => `${body.team}:${body.date}`,
    run: (body, auth) => submitHandover(body, { employeeId: auth.employeeId ?? null, role: auth.role }),
    summary: (body) => `Handover for ${body.team} on ${body.date}`,
  });
}

/** POST /api/morning/absence { date, team, absent } — manual lead absence toggle (spec §14.3). Lead, deputy or admin. */
import { NextRequest } from "next/server";
import { absenceSchema, setAbsence } from "@/modules/morning/handover";
import { handoverAction } from "@/modules/morning/http";

export async function POST(request: NextRequest) {
  return handoverAction(request, absenceSchema, {
    action: "lead_absence_set",
    run: (body, auth) => setAbsence(body, { employeeId: auth.employeeId ?? null, role: auth.role }),
    summary: (body) => `${body.team} lead ${body.absent ? "absent" : "present"} on ${body.date}`,
  });
}

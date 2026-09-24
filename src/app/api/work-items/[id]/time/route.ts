/** POST /api/work-items/:id/time { bucketMins } — log time in a fixed bucket (spec §14.2). Never reported per person (H4). */
import { NextRequest } from "next/server";
import { logTime, timeSchema } from "@/modules/work-items/actions";
import { workAction } from "@/modules/work-items/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workAction(request, params, timeSchema, {
    action: "work_item_time_logged",
    context: "work-item time",
    run: async (id, body, auth) => {
      const log = await logTime(id, body.bucketMins, auth.employeeId ?? "system");
      return { id: log.id, bucketMins: log.bucketMins };
    },
    summary: (_id, body) => `Logged ${body.bucketMins} minutes`,
  });
}

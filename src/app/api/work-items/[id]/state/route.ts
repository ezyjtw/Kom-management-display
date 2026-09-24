/** POST /api/work-items/:id/state { state, reason?, transitionName? } — non-closing state change, ticket first (spec §14.2). */
import { NextRequest } from "next/server";
import { setState, stateSchema } from "@/modules/work-items/actions";
import { workAction } from "@/modules/work-items/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workAction(request, params, stateSchema, {
    action: "work_item_state_changed",
    context: "work-item state",
    run: (id, body) => setState(id, body),
    summary: (_id, body) => `State -> ${body.state}${body.reason ? `: ${body.reason}` : ""}`,
  });
}

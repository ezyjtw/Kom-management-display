/** POST /api/work-items/:id/links { key } — link a related Jira ticket (spec §14.2). Jira first. */
import { NextRequest } from "next/server";
import { linkSchema, linkTicket } from "@/modules/work-items/actions";
import { workAction } from "@/modules/work-items/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workAction(request, params, linkSchema, {
    action: "work_item_ticket_linked",
    context: "work-item link",
    run: (id, body) => linkTicket(id, body.key),
    summary: (_id, body) => `Linked related ticket ${body.key}`,
  });
}

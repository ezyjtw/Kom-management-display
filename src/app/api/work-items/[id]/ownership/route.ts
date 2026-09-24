/** POST /api/work-items/:id/ownership { employeeId: "me" | id | null } — take ownership, reassign or unassign (spec §14.2). Jira first. */
import { NextRequest } from "next/server";
import { ownershipSchema, setOwner } from "@/modules/work-items/actions";
import { actorOf, workAction } from "@/modules/work-items/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workAction(request, params, ownershipSchema, {
    action: "work_item_owner_changed",
    context: "work-item ownership",
    run: (id, body, auth) => setOwner(id, body.employeeId, actorOf(auth)),
    summary: (_id, body) => (body.employeeId === "me" ? "Took ownership" : body.employeeId ? "Reassigned" : "Unassigned"),
  });
}

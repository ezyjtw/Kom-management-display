/** POST /api/work-items/:id/notes { text } — internal note, posted as an internal ticket comment (spec §14.2). */
import { NextRequest } from "next/server";
import { addNote, noteSchema } from "@/modules/work-items/actions";
import { workAction } from "@/modules/work-items/http";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return workAction(request, params, noteSchema, {
    action: "work_item_note_added",
    context: "work-item note",
    run: async (id, body) => {
      await addNote(id, body.text);
      return { posted: true };
    },
    summary: () => "Internal note posted to the ticket",
  });
}

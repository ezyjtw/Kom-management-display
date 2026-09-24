import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/response";
import { ClientContentError } from "@/modules/client-incidents/guards";
import { SourceResolutionError } from "@/modules/client-incidents/resolve";
import { ClientIncidentError } from "@/modules/client-incidents/service";
import { TicketWriteError } from "@/modules/work-items/ticket-writeback";

/** Map §9.7 domain errors to responses; everything else goes to the standard handler. */
export function clientIncidentError(error: unknown, context: string): NextResponse {
  if (error instanceof ClientContentError) return NextResponse.json({ success: false, error: error.message, issues: error.issues }, { status: 422 });
  if (error instanceof SourceResolutionError) return NextResponse.json({ success: false, error: error.message }, { status: 422 });
  if (error instanceof ClientIncidentError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  if (error instanceof TicketWriteError) return NextResponse.json({ success: false, error: error.message }, { status: 409 });
  return handleApiError(error, context);
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/comms/threads/:id/notes
 * Add an internal note to a thread. Counts as "activity" for SLA.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { authorId, content } = body;

    if (!authorId || !content) {
      return NextResponse.json(
        { success: false, error: "authorId and content are required" },
        { status: 400 }
      );
    }

    const thread = await prisma.commsThread.findUnique({
      where: { id: params.id },
    });

    if (!thread) {
      return NextResponse.json(
        { success: false, error: "Thread not found" },
        { status: 404 }
      );
    }

    const now = new Date();

    // Create note
    const note = await prisma.threadNote.create({
      data: {
        threadId: params.id,
        authorId,
        content,
      },
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    // Update thread's lastActionAt (adding note counts as activity)
    await prisma.commsThread.update({
      where: { id: params.id },
      data: { lastActionAt: now },
    });

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

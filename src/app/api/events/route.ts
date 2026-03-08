import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth-user";
import { registerClient, removeClient, getConnectedClients } from "@/lib/sse";
import { randomUUID } from "crypto";

/**
 * GET /api/events
 * Server-Sent Events endpoint for real-time push notifications.
 * Clients connect and receive events like SLA breaches, incidents, etc.
 */
export async function GET() {
  const auth = await getAuthUser();
  if (!auth) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 },
    );
  }

  const clientId = randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      // Register client
      registerClient(clientId, auth.id, auth.role, auth.team, controller);

      // Send initial connection event
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`,
        ),
      );

      // Heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
            ),
          );
        } catch {
          clearInterval(heartbeat);
          removeClient(clientId);
        }
      }, 30_000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(heartbeat);
        removeClient(clientId);
      };

      // Store cleanup function for when the connection closes
      (controller as any).__cleanup = cleanup;
    },
    cancel() {
      removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}

/**
 * POST /api/events
 * Get SSE client info (admin only) or broadcast a test event.
 */
export async function POST() {
  const auth = await getAuthUser();
  if (!auth || (auth.role !== "admin" && auth.role !== "lead")) {
    return NextResponse.json(
      { success: false, error: "Admin or Lead role required" },
      { status: 403 },
    );
  }

  const clients = getConnectedClients();
  return NextResponse.json({
    success: true,
    data: { connectedClients: clients.length, clients },
  });
}

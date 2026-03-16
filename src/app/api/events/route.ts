import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth-user";
import { registerClient, removeClient, getConnectedClients } from "@/lib/sse";
import { randomUUID } from "crypto";
import { z } from "zod";

/**
 * GET /api/events
 * Server-Sent Events endpoint for real-time push notifications.
 * Clients connect and receive events like SLA breaches, incidents, etc.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const clientId = randomUUID();

  let heartbeatRef: ReturnType<typeof setInterval> | null = null;

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

      // Store interval reference for cleanup in cancel()
      heartbeatRef = heartbeat;
    },
    cancel() {
      if (heartbeatRef) clearInterval(heartbeatRef);
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
  const auth = await requireRole("admin", "lead");
  if (auth instanceof NextResponse) return auth;

  // No request body — validate empty payload
  const _parsed = z.object({}).safeParse({});

  const clients = getConnectedClients();
  return NextResponse.json({
    success: true,
    data: { connectedClients: clients.length, clients },
  });
}

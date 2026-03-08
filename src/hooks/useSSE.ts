"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

interface UseSSEOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 5000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 10) */
  maxReconnects?: number;
}

/**
 * Hook for connecting to the SSE events endpoint.
 * Returns live events and connection status.
 */
export function useSSE(options: UseSSEOptions = {}) {
  const { autoReconnect = true, reconnectDelay = 5000, maxReconnects = 10 } = options;

  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
    }

    const source = new EventSource("/api/events");
    sourceRef.current = source;

    source.addEventListener("connected", () => {
      setConnected(true);
      reconnectCountRef.current = 0;
    });

    source.addEventListener("heartbeat", () => {
      // Keep-alive, no action needed
    });

    // Listen for all event types
    const eventTypes = [
      "sla_breach",
      "incident_update",
      "high_risk_transaction",
      "confirmation_expired",
      "job_status",
      "alert",
    ];

    for (const type of eventTypes) {
      source.addEventListener(type, (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          const event: SSEEvent = { type, data };
          setLastEvent(event);
          setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100 events
        } catch {
          // Ignore parse errors
        }
      });
    }

    source.onerror = () => {
      setConnected(false);
      source.close();

      if (autoReconnect && reconnectCountRef.current < maxReconnects) {
        reconnectCountRef.current++;
        const delay = reconnectDelay * Math.pow(1.5, reconnectCountRef.current - 1);
        reconnectTimerRef.current = setTimeout(connect, Math.min(delay, 30000));
      }
    };
  }, [autoReconnect, reconnectDelay, maxReconnects]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    setConnected(false);
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connected,
    events,
    lastEvent,
    connect,
    disconnect,
    clearEvents,
  };
}

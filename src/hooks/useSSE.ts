"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

/** All SSE event types the client listens for. */
const ALL_EVENT_TYPES = [
  "sla_breach",
  "incident_update",
  "high_risk_transaction",
  "confirmation_expired",
  "job_status",
  "alert",
  // Stream 1: new event types
  "travel_rule_update",
  "screening_alert",
  "settlement_update",
  "token_review_update",
  "compliance_deadline",
  "staking_anomaly",
] as const;

export type SSEEventType = (typeof ALL_EVENT_TYPES)[number];

interface UseSSEOptions {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 5000) */
  reconnectDelay?: number;
  /** Max reconnect attempts (default: 10) */
  maxReconnects?: number;
  /** Only receive events of these types (default: all) */
  filter?: SSEEventType[];
}

/**
 * Hook for connecting to the SSE events endpoint.
 * Returns live events and connection status.
 */
export function useSSE(options: UseSSEOptions = {}) {
  const { autoReconnect = true, reconnectDelay = 5000, maxReconnects = 10, filter } = options;

  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Stabilize filter reference
  const filterSet = useMemo(
    () => (filter ? new Set(filter) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter?.join(",")],
  );

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
    for (const type of ALL_EVENT_TYPES) {
      source.addEventListener(type, (e) => {
        // Skip events not in filter (if filter is set)
        if (filterSet && !filterSet.has(type)) return;

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
  }, [autoReconnect, reconnectDelay, maxReconnects, filterSet]);

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

/**
 * Convenience hook: subscribe to a single SSE event type.
 * Returns only events matching the specified type.
 */
export function useSSEEventType(eventType: SSEEventType, options: Omit<UseSSEOptions, "filter"> = {}) {
  return useSSE({ ...options, filter: [eventType] });
}

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
  "work_item_update",
] as const;

export type SSEEventType = (typeof ALL_EVENT_TYPES)[number];

interface UseSSEOptions {
  /** Kept for compatibility; reconnection is handled by the shared connection. */
  autoReconnect?: boolean;
  reconnectDelay?: number;
  maxReconnects?: number;
  /** Only receive events of these types (default: all) */
  filter?: SSEEventType[];
}

/**
 * One EventSource per browser tab, shared by every component that listens
 * (load review, Phase 12n). Each tab used to open 2–3 connections. The
 * connection closes shortly after the last listener unmounts, so a route
 * change does not reconnect.
 */
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECTS = 10;
const CLOSE_GRACE_MS = 2_000;

type Listener = (event: SSEEvent) => void;
type StatusListener = (connected: boolean) => void;

const hub = {
  source: null as EventSource | null,
  connected: false,
  reconnects: 0,
  reconnectTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  closeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  listeners: new Set<Listener>(),
  statusListeners: new Set<StatusListener>(),
};

function setConnectedAll(value: boolean) {
  hub.connected = value;
  for (const l of hub.statusListeners) l(value);
}

function openSource() {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  hub.source?.close();
  const source = new EventSource("/api/events");
  hub.source = source;
  source.addEventListener("connected", () => {
    hub.reconnects = 0;
    setConnectedAll(true);
  });
  for (const type of ALL_EVENT_TYPES) {
    source.addEventListener(type, (e) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch {
        return;
      }
      for (const l of hub.listeners) l({ type, data });
    });
  }
  source.onerror = () => {
    setConnectedAll(false);
    source.close();
    if (hub.source === source) hub.source = null;
    if (hub.listeners.size > 0 && hub.reconnects < MAX_RECONNECTS) {
      hub.reconnects++;
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, hub.reconnects - 1), 30_000);
      hub.reconnectTimer = setTimeout(() => { if (hub.listeners.size > 0) openSource(); }, delay);
    }
  };
}

function closeSource() {
  clearTimeout(hub.reconnectTimer);
  hub.source?.close();
  hub.source = null;
  hub.reconnects = 0;
  setConnectedAll(false);
}

/** Subscribe to the shared stream; returns the unsubscribe function. */
export function subscribeSSE(listener: Listener, onStatus: StatusListener): () => void {
  clearTimeout(hub.closeTimer);
  hub.listeners.add(listener);
  hub.statusListeners.add(onStatus);
  if (!hub.source) openSource();
  onStatus(hub.connected);
  return () => {
    hub.listeners.delete(listener);
    hub.statusListeners.delete(onStatus);
    if (hub.listeners.size === 0) hub.closeTimer = setTimeout(closeSource, CLOSE_GRACE_MS);
  };
}

/** Test hook: the number of open EventSources (0 or 1). */
export function sseConnectionCount(): number {
  return hub.source ? 1 : 0;
}

/**
 * Hook for the shared SSE stream. Returns live events and connection status.
 */
export function useSSE(options: UseSSEOptions = {}) {
  const { filter } = options;

  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Stabilize filter reference
  const filterSet = useMemo(
    () => (filter ? new Set<string>(filter) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter?.join(",")],
  );

  const connect = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = subscribeSSE((event) => {
      if (filterSet && !filterSet.has(event.type)) return;
      setLastEvent(event);
      setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100 events
    }, setConnected);
  }, [filterSet]);

  const disconnect = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
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

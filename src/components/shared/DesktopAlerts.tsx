"use client";

/**
 * Desktop notifications (spec §14.4): a sound and a browser notification for
 * new P1 client requests and critical alerts, only when the user has turned
 * them on and granted browser permission. The preference lives in this
 * browser only. Notifications carry a link, never an action.
 */

import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import { useSSE } from "@/hooks/useSSE";

const KEY = "kom.desktopAlerts";

function enabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "on" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // no audio available
  }
}

/** Which events notify: new P1 client requests and critical alerts. */
export function desktopNotificationFor(event: { type: string; data: unknown }): { title: string; body: string; link: string; tag: string } | null {
  const d = (event.data ?? {}) as Record<string, unknown>;
  if (event.type === "work_item_update" && d.change === "created" && d.kind === "client_request" && d.priority === "P1") {
    return { title: "New P1 client request", body: "Open the work queue to take it.", link: `/work/${String(d.workItemId)}`, tag: `wi-${String(d.workItemId)}` };
  }
  if (event.type === "alert" && d.severity === "critical") {
    return { title: `Critical alert ${String(d.type ?? "")}`.trim(), body: String(d.message ?? "").slice(0, 200), link: "/admin/alerts", tag: `alert-${String(d.alertId)}` };
  }
  return null;
}

/** Mounted once in the app shell: listens and notifies. */
export function DesktopAlertsListener() {
  const { lastEvent } = useSSE({ filter: ["work_item_update", "alert"] });
  useEffect(() => {
    if (!lastEvent || !enabled()) return;
    const n = desktopNotificationFor(lastEvent);
    if (!n) return;
    beep();
    const notification = new Notification(n.title, { body: n.body, tag: n.tag });
    notification.onclick = () => {
      window.focus();
      window.location.assign(n.link);
    };
  }, [lastEvent]);
  return null;
}

/** Sidebar switch: asks for browser permission when turned on. */
export function DesktopAlertsToggle() {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(typeof window !== "undefined" && "Notification" in window);
    setOn(enabled());
  }, []);
  if (!supported) return null;

  async function toggle() {
    try {
      if (on) {
        window.localStorage.setItem(KEY, "off");
        setOn(false);
        return;
      }
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      window.localStorage.setItem(KEY, permission === "granted" ? "on" : "off");
      setOn(permission === "granted");
    } catch {
      setOn(false);
    }
  }

  return (
    <button onClick={() => void toggle()} className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground" aria-pressed={on}
      title="Sound and desktop notification for new P1 client requests and critical alerts">
      {on ? <BellRing size={14} className="text-primary" /> : <BellOff size={14} />}
      Desktop alerts: {on ? "on" : "off"}
    </button>
  );
}

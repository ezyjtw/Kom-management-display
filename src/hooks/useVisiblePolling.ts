"use client";

import { useEffect, useRef } from "react";

/**
 * Run `task` now (unless `immediate: false`) and every `intervalMs` while the tab is visible (load review,
 * Phase 12n). A hidden tab makes no requests; when it becomes visible again
 * the task runs at once if a refresh is due.
 */
export function useVisiblePolling(task: () => void | Promise<void>, intervalMs: number, opts: { enabled?: boolean; immediate?: boolean } = {}): void {
  const { enabled = true, immediate = true } = opts;
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;
    let lastRun = 0;
    const run = () => {
      lastRun = Date.now();
      void taskRef.current();
    };
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      run();
    };
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRun >= intervalMs) run();
    };
    if (immediate) run();
    else lastRun = Date.now();
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled, immediate]);
}

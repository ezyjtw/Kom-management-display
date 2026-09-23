"use client";

import { useEffect, useState } from "react";
import { AlertOctagon } from "lucide-react";

const POLL_MS = 60_000;

export function WorkerStatusBanner() {
  const [workerAlive, setWorkerAlive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setWorkerAlive(json?.data?.worker_alive !== false);
      } catch {
        /* network blip: keep last known state */
      }
    }
    check();
    const interval = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (workerAlive) return null;

  return (
    <div role="alert" className="bg-red-600 text-white text-sm px-4 py-2 flex items-center justify-center gap-2">
      <AlertOctagon size={16} />
      Background worker is down — alerts, SLA checks and syncs are not running. Contact IT.
    </div>
  );
}

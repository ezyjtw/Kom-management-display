"use client";

import { useState } from "react";
import { AlertOctagon } from "lucide-react";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import { backgroundFetch } from "@/lib/client/background-fetch";

const POLL_MS = 60_000;

export function WorkerStatusBanner() {
  const [workerAlive, setWorkerAlive] = useState(true);

  useVisiblePolling(async () => {
    try {
      const res = await backgroundFetch("/api/health");
      const json = await res.json();
      setWorkerAlive(json?.data?.worker_alive !== false);
    } catch {
      /* network blip: keep last known state */
    }
  }, POLL_MS);

  if (workerAlive) return null;

  return (
    <div role="alert" className="bg-red-600 text-white text-sm px-4 py-2 flex items-center justify-center gap-2">
      <AlertOctagon size={16} />
      Background worker is down — alerts, SLA checks and syncs are not running. Contact IT.
    </div>
  );
}

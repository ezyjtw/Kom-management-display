"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="max-w-2xl mx-auto mt-20">
        <div className="bg-zinc-900 border border-red-500/20 rounded-lg p-8">
          <h2 className="text-lg font-semibold text-zinc-100 mb-2">Dashboard failed to load</h2>
          <p className="text-sm text-zinc-400 mb-4">
            We couldn&apos;t load the dashboard data. This may be a temporary issue with the database connection.
          </p>
          {error.digest && (
            <p className="text-xs text-zinc-500 font-mono mb-4">Reference: {error.digest}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={reset}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
            >
              Retry
            </button>
            <a
              href="/"
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-md transition-colors"
            >
              Go to Command Centre
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

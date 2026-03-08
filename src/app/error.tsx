"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">Something went wrong</h2>
        <p className="text-sm text-zinc-400 mb-6">
          An unexpected error occurred. This has been logged for investigation.
          {error.digest && (
            <span className="block mt-2 text-xs text-zinc-500 font-mono">
              Reference: {error.digest}
            </span>
          )}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

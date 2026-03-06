"use client";

import { signOut } from "next-auth/react";
import { AlertTriangle, RefreshCw, LogOut } from "lucide-react";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/**
 * Reusable error state with retry and sign-out buttons.
 * Shown when an API call fails — sign-out helps recover from
 * stale sessions, expired tokens, or auth-related errors.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
      <AlertTriangle size={24} className="mx-auto mb-3 text-red-400" />
      <p className="text-sm text-red-400 font-medium mb-1">{message}</p>
      <p className="text-xs text-muted-foreground mb-4">
        If this persists, try signing out and back in.
      </p>
      <div className="flex items-center justify-center gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-card border border-border rounded-lg hover:bg-accent/50 text-foreground"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 text-red-400"
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Monitor, LogOut, Trash2, Globe, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SessionInfo {
  id: string;
  sessionToken: string;
  ipAddress: string;
  userAgent: string;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch("/api/sessions");
      const json = await res.json();
      if (json.success) {
        setSessions(json.data.sessions);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }

  async function revokeAll() {
    if (!confirm("Revoke all your active sessions? You will need to log in again.")) return;
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_all", reason: "manual_revocation" }),
    });
    fetchData();
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><RefreshCw size={24} className="animate-spin mr-3" />Loading sessions...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
          <Monitor size={24} /> Active Sessions
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={revokeAll} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-md">
            <LogOut size={14} /> Revoke All
          </button>
          <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No active sessions.</div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div key={session.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <Monitor size={20} className="text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground font-mono">{session.sessionToken}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                    {session.ipAddress && (
                      <span className="flex items-center gap-1"><Globe size={12} /> {session.ipAddress}</span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> Last active: {formatDistanceToNow(new Date(session.lastActiveAt), { addSuffix: true })}
                    </span>
                    <span>Expires: {formatDistanceToNow(new Date(session.expiresAt), { addSuffix: true })}</span>
                  </div>
                  {session.userAgent && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{session.userAgent}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

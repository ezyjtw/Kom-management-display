"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import {
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  LogOut,
  Clock,
  Zap,
} from "lucide-react";

/**
 * Daily Ops Briefing page.
 *
 * Fetches Command Centre data, sends it to the AI assist endpoint,
 * and displays a generated morning briefing. The briefing is a
 * suggestion — the user can regenerate, copy to clipboard (for Slack),
 * or simply read and move on.
 */
export default function BriefingPage() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [aiProvider, setAiProvider] = useState<string>("none");
  const [copied, setCopied] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  useEffect(() => {
    checkAiStatus();
  }, []);

  async function checkAiStatus() {
    try {
      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const json = await res.json();
      setAiEnabled(json.data?.enabled ?? false);
      setAiProvider(json.data?.provider ?? "none");
    } catch {
      setAiEnabled(false);
    }
  }

  async function generateBriefing() {
    setLoading(true);
    setError(null);
    setBriefing(null);

    try {
      // First fetch the command center data
      const ccRes = await fetch("/api/command-center");
      const ccJson = await ccRes.json();

      if (!ccJson.success) {
        setError("Failed to fetch operational data");
        setLoading(false);
        return;
      }

      // Send to AI for briefing generation
      const aiRes = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "briefing",
          data: ccJson.data,
        }),
      });
      const aiJson = await aiRes.json();

      if (aiJson.success && aiJson.data?.suggestion) {
        setBriefing(aiJson.data.suggestion);
        setGeneratedAt(new Date());
      } else {
        setError(aiJson.error || "Failed to generate briefing");
      }
    } catch {
      setError("Network error — could not reach server");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!briefing) return;
    await navigator.clipboard.writeText(briefing);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles size={24} className="text-primary" />
            Ops Briefing
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            AI-generated morning briefing from live operational data
          </p>
        </div>
        <div className="flex items-center gap-2">
          {aiEnabled !== null && (
            <span className={`text-xs px-2 py-1 rounded-full ${aiEnabled ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
              {aiEnabled ? `AI Connected (${aiProvider})` : "AI Not Configured"}
            </span>
          )}
        </div>
      </div>

      {/* AI not configured warning */}
      {aiEnabled === false && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-400">AI features not configured</p>
              <p className="text-xs text-muted-foreground mt-1">
                Set one of <code className="bg-muted px-1 py-0.5 rounded text-foreground">GROQ_API_KEY</code> (free),{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-foreground">ANTHROPIC_API_KEY</code>, or{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-foreground">OLLAMA_BASE_URL</code> in
                your environment to enable AI-powered briefings, thread triage, and incident impact drafting.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                The rest of the dashboard works without it — AI features are an optional enhancement.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Generate button */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap size={20} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Morning Briefing</p>
              <p className="text-xs text-muted-foreground">
                Analyses incidents, SLA breaches, coverage, tasks, and recent activity
              </p>
            </div>
          </div>
          <button
            onClick={generateBriefing}
            disabled={loading || !aiEnabled}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Generate Briefing
              </>
            )}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="bg-muted/30 rounded-lg p-8 text-center">
            <RefreshCw size={24} className="mx-auto mb-3 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analysing operational data and generating briefing...</p>
            <p className="text-xs text-muted-foreground mt-1">This takes a few seconds</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
            <AlertTriangle size={20} className="mx-auto mb-2 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <div className="flex items-center justify-center gap-3 mt-3">
              <button
                onClick={generateBriefing}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-card border border-border rounded-lg hover:bg-accent/50 text-foreground"
              >
                <RefreshCw size={12} /> Retry
              </button>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 text-red-400"
              >
                <LogOut size={12} /> Sign Out
              </button>
            </div>
          </div>
        )}

        {/* Briefing result */}
        {briefing && !loading && (
          <div>
            {/* Metadata bar */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles size={12} className="text-primary" />
                AI-generated suggestion
                {generatedAt && (
                  <>
                    <span className="text-border">·</span>
                    <Clock size={12} />
                    {generatedAt.toLocaleTimeString()}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent/50 text-muted-foreground"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy for Slack"}
                </button>
                <button
                  onClick={generateBriefing}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent/50 text-muted-foreground"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              </div>
            </div>

            {/* Briefing content */}
            <div className="bg-muted/30 rounded-lg p-5 prose prose-sm prose-invert max-w-none">
              {briefing.split("\n").map((line, i) => {
                if (!line.trim()) return <br key={i} />;
                // Bold headers (lines starting with ** or ##)
                if (line.startsWith("## ") || line.startsWith("**")) {
                  return (
                    <p key={i} className="font-semibold text-foreground mt-3 mb-1 text-sm">
                      {line.replace(/^##\s*/, "").replace(/\*\*/g, "")}
                    </p>
                  );
                }
                // Bullet points
                if (line.trimStart().startsWith("- ") || line.trimStart().startsWith("• ")) {
                  const text = line.replace(/^\s*[-•]\s*/, "");
                  return (
                    <div key={i} className="flex gap-2 text-sm text-foreground/90 ml-2 my-0.5">
                      <span className="text-muted-foreground shrink-0">•</span>
                      <span>{text}</span>
                    </div>
                  );
                }
                return <p key={i} className="text-sm text-foreground/90 my-1">{line}</p>;
              })}
            </div>

            {/* Disclaimer */}
            <p className="text-xs text-muted-foreground mt-3 italic">
              This briefing is AI-generated from live data. Always verify critical items against the source screens.
            </p>
          </div>
        )}

        {/* Empty state */}
        {!briefing && !loading && !error && (
          <div className="bg-muted/20 rounded-lg p-8 text-center">
            <Sparkles size={24} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Click &quot;Generate Briefing&quot; to create an AI summary of current operations.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The briefing pulls from all modules: incidents, SLA status, coverage, tasks, and recent activity.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

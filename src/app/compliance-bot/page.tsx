"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { Send, Bot, User, Loader2, AlertCircle, Scale } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const REGULATOR_CHIPS = ["JFSC", "MiCAR", "VARA", "FCA"] as const;

export default function ComplianceBotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/compliance-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to get response");
      }

      setMessages([...updatedMessages, { role: "assistant", content: data.data.reply }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleChipClick = (regulator: string) => {
    setInput((prev) => {
      const prefix = prev.trim() ? `${prev.trim()} ` : "";
      return `${prefix}[${regulator}] `;
    });
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border mb-4">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Scale size={24} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">KMR Compliance Bot</h1>
          <p className="text-sm text-muted-foreground">
            Ask compliance questions about JFSC, MiCAR, VARA & FCA regulations
          </p>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="p-4 bg-primary/5 rounded-full mb-4">
              <Bot size={40} className="text-primary/60" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Welcome to the Compliance Bot
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              I can help you with compliance questions related to digital asset regulations across
              multiple jurisdictions. Try asking about:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
              {[
                "What are JFSC's AML requirements for VASPs?",
                "How does MiCAR classify crypto-assets?",
                "What are VARA's custody requirements?",
                "FCA crypto registration process?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="text-left text-sm p-3 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mt-1">
                <Bot size={16} className="text-primary" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-foreground"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
            {msg.role === "user" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center mt-1">
                <User size={16} className="text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot size={16} className="text-primary" />
            </div>
            <div className="bg-card border border-border rounded-lg px-4 py-3">
              <Loader2 size={16} className="animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Regulator chips */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground">Regulators:</span>
        {REGULATOR_CHIPS.map((reg) => (
          <button
            key={reg}
            onClick={() => handleChipClick(reg)}
            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {reg}
          </button>
        ))}
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a compliance question..."
          rows={2}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="p-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

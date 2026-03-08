"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, ArrowRight, Mail, AlertTriangle, FileText, Users, Coins, BarChart3, Shield, Database, Eye } from "lucide-react";

interface SearchResult {
  id: string;
  module: string;
  type: string;
  title: string;
  subtitle: string;
  url: string;
  relevance: number;
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  byModule: Record<string, number>;
  durationMs: number;
}

const MODULE_ICONS: Record<string, typeof Search> = {
  comms: Mail,
  incidents: AlertTriangle,
  travel_rule: Shield,
  projects: FileText,
  employees: Users,
  staking: Coins,
  settlements: BarChart3,
  tokens: Database,
  screening: Eye,
};

const MODULE_LABELS: Record<string, string> = {
  comms: "Communications",
  incidents: "Incidents",
  travel_rule: "Travel Rule",
  projects: "Projects",
  employees: "Employees",
  staking: "Staking",
  settlements: "Settlements",
  tokens: "Tokens",
  screening: "Screening",
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
      const json = await res.json();
      if (json.success) setResults(json.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  function handleInputChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  }

  function navigateTo(url: string) {
    setOpen(false);
    setQuery("");
    setResults(null);
    window.location.href = url;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted hover:bg-muted/80 rounded-md border border-border"
      >
        <Search size={14} />
        <span>Search...</span>
        <kbd className="ml-2 text-[10px] bg-background px-1.5 py-0.5 rounded border border-border">
          {typeof navigator !== "undefined" && navigator.platform?.includes("Mac") ? "\u2318" : "Ctrl"}K
        </kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={18} className="text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search across all modules..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults(null); }} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="p-4 text-center text-xs text-muted-foreground">Searching...</div>
          )}

          {results && !loading && (
            <>
              {results.total === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No results found for &ldquo;{results.query}&rdquo;</div>
              ) : (
                <>
                  {/* Module counts */}
                  <div className="px-4 py-2 flex items-center gap-2 flex-wrap border-b border-border">
                    <span className="text-xs text-muted-foreground">{results.total} results</span>
                    {Object.entries(results.byModule).map(([mod, count]) => (
                      <span key={mod} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        {MODULE_LABELS[mod] || mod}: {count}
                      </span>
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-auto">{results.durationMs}ms</span>
                  </div>

                  {/* Result list */}
                  {results.results.map((r) => {
                    const Icon = MODULE_ICONS[r.module] || Search;
                    return (
                      <button
                        key={`${r.module}-${r.id}`}
                        onClick={() => navigateTo(r.url)}
                        className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-muted/50 text-left border-b border-border/50 last:border-0"
                      >
                        <Icon size={16} className="text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground truncate">{r.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.subtitle}</div>
                        </div>
                        <ArrowRight size={14} className="text-muted-foreground flex-shrink-0" />
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}

          {!results && !loading && query.length < 2 && query.length > 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">Type at least 2 characters to search</div>
          )}
        </div>
      </div>
    </div>
  );
}

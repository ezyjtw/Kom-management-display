"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, MessageSquare } from "lucide-react";
import { EmployeeScorecard } from "@/components/dashboard/EmployeeScorecard";
import { EvidencePanel } from "@/components/dashboard/EvidencePanel";
import { FlagBadge } from "@/components/shared/FlagBadge";
import { computeOverallScore, getDefaultScoringConfig } from "@/lib/scoring";
import type { ScoringConfigData } from "@/types";
import type { Category } from "@/types";

interface EmployeeData {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  region: string;
  scores: Array<{
    id: string;
    category: string;
    score: number;
    rawIndex: number;
    evidence: string;
    metadata: string;
    period: { label: string; type: string; startDate: string };
  }>;
  knowledgeScores: Array<{
    id: string;
    operationalUnderstanding: number;
    assetKnowledge: number;
    complianceAwareness: number;
    incidentResponse: number;
    mappedScore: number;
    notes: string;
    period: { label: string };
  }>;
  employeeNotes: Array<{
    id: string;
    content: string;
    noteType: string;
    authorId: string;
    createdAt: string;
    periodLabel: string;
  }>;
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [scoringConfig, setScoringConfig] = useState<ScoringConfigData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      Promise.all([
        fetch(`/api/employees/${params.id}`).then((res) => res.json()),
        fetch("/api/scoring-config").then((res) => res.json()),
      ])
        .then(([empJson, configJson]) => {
          if (empJson.success) setEmployee(empJson.data);
          if (configJson.success && configJson.data?.config) {
            try {
              const parsed = typeof configJson.data.config === "string"
                ? JSON.parse(configJson.data.config)
                : configJson.data.config;
              setScoringConfig(parsed);
            } catch { /* use default */ }
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading employee data...
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Employee not found</p>
        <Link href="/dashboard" className="text-primary hover:underline mt-2 inline-block">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // Build category scores from latest period
  const config = scoringConfig || getDefaultScoringConfig();
  const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];
  const latestScores = new Map<string, typeof employee.scores[0]>();

  for (const s of employee.scores) {
    if (!latestScores.has(s.category) || new Date(s.period.startDate) > new Date(latestScores.get(s.category)!.period.startDate)) {
      latestScores.set(s.category, s);
    }
  }

  const categoryScores = {} as Record<Category, number>;
  for (const cat of categories) {
    categoryScores[cat] = latestScores.get(cat)?.score ?? 3;
  }
  const overallScore = computeOverallScore(categoryScores, config.weights);

  // Build trends (comparing latest two periods per category)
  const trends: Record<string, { current: number; previous: number; delta: number; direction: string }> = {};
  for (const cat of categories) {
    const catScores = employee.scores
      .filter((s) => s.category === cat)
      .sort((a, b) => new Date(b.period.startDate).getTime() - new Date(a.period.startDate).getTime());
    const current = catScores[0]?.score ?? 3;
    const previous = catScores[1]?.score ?? current;
    const delta = Math.round((current - previous) * 10) / 10;
    trends[cat] = { current, previous, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
  }
  const overallPrev = computeOverallScore(
    Object.fromEntries(categories.map((c) => [c, trends[c]?.previous ?? 3])) as Record<Category, number>,
    config.weights
  );
  const overallDelta = Math.round((overallScore - overallPrev) * 10) / 10;
  trends.overall = {
    current: overallScore,
    previous: overallPrev,
    delta: overallDelta,
    direction: overallDelta > 0 ? "up" : overallDelta < 0 ? "down" : "flat",
  };

  // Parse evidence for each category
  const evidenceByCategory = new Map<string, { evidence: unknown[]; metadata: Record<string, unknown> }>();
  for (const [cat, score] of latestScores) {
    try {
      evidenceByCategory.set(cat, {
        evidence: JSON.parse(score.evidence || "[]"),
        metadata: JSON.parse(score.metadata || "{}"),
      });
    } catch {
      evidenceByCategory.set(cat, { evidence: [], metadata: {} });
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">{employee.name}</h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              {employee.role} — {employee.team} — {employee.region}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 ml-8 sm:ml-0">
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-card border border-border rounded-lg hover:bg-accent/50">
            <MessageSquare size={16} />
            <span className="hidden sm:inline">Add Note</span>
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-primary-foreground bg-primary rounded-lg hover:bg-primary/90">
            <Download size={16} />
            <span className="hidden sm:inline">Export Summary</span>
          </button>
        </div>
      </div>

      {/* Scorecard */}
      <EmployeeScorecard
        overallScore={overallScore}
        categoryScores={categoryScores}
        trends={trends}
      />

      {/* Evidence Panels */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-4">Evidence & Detail</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {categories.map((cat) => {
            const data = evidenceByCategory.get(cat);
            return (
              <EvidencePanel
                key={cat}
                category={cat}
                evidence={(data?.evidence as Array<{ type: string; label: string; link?: string; details?: string; severity?: string }>) ?? []}
                metadata={data?.metadata}
              />
            );
          })}
        </div>
      </div>

      {/* Knowledge Score Details */}
      {employee.knowledgeScores.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Crypto Knowledge Assessment</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(() => {
              const latest = employee.knowledgeScores[0];
              return [
                { label: "Operational Understanding", value: latest.operationalUnderstanding },
                { label: "Asset Knowledge", value: latest.assetKnowledge },
                { label: "Compliance Awareness", value: latest.complianceAwareness },
                { label: "Incident Response", value: latest.incidentResponse },
              ].map((dim) => (
                <div key={dim.label} className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{dim.label}</p>
                  <p className="text-xl font-bold mt-1">{dim.value}/10</p>
                </div>
              ));
            })()}
          </div>
          {employee.knowledgeScores[0].notes && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm mt-1">{employee.knowledgeScores[0].notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Employee Notes */}
      <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Notes</h3>
        <div className="space-y-3">
          {employee.employeeNotes.map((note) => (
            <div key={note.id} className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    note.noteType === "manager"
                      ? "bg-blue-500/10 text-blue-400"
                      : note.noteType === "context"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {note.noteType}
                </span>
                <span className="text-xs text-muted-foreground">
                  {note.periodLabel} — {new Date(note.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm text-foreground">{note.content}</p>
            </div>
          ))}
          {employee.employeeNotes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

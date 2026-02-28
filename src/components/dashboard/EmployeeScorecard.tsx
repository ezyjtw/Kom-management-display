"use client";

import { ScoreBadge, ScoreBar } from "@/components/shared/ScoreBadge";
import { TrendIndicator } from "@/components/shared/TrendIndicator";
import type { Category } from "@/types";

const categoryLabels: Record<Category, string> = {
  daily_tasks: "Daily Tasks (Jira)",
  projects: "Projects (Confluence)",
  asset_actions: "Asset Actions",
  quality: "Mistakes vs Positives",
  knowledge: "Crypto Knowledge",
};

const categoryDescriptions: Record<Category, string> = {
  daily_tasks: "Ticket throughput, on-time delivery, cycle time",
  projects: "Documentation, runbooks, process improvements",
  asset_actions: "Client asset operations completed",
  quality: "Error rate offset by positive actions",
  knowledge: "Domain competence assessment",
};

interface EmployeeScorecardProps {
  overallScore: number;
  categoryScores: Record<Category, number>;
  trends: Record<string, { current: number; previous: number; delta: number; direction: string }>;
}

export function EmployeeScorecard({ overallScore, categoryScores, trends }: EmployeeScorecardProps) {
  const categories: Category[] = ["daily_tasks", "projects", "asset_actions", "quality", "knowledge"];

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Overall Score</h3>
          {trends.overall && (
            <TrendIndicator
              delta={trends.overall.delta}
              direction={trends.overall.direction as "up" | "down" | "flat"}
              size="md"
            />
          )}
        </div>
        <div className="flex items-center gap-4">
          <ScoreBadge score={overallScore} size="lg" />
          <div className="flex-1">
            <ScoreBar score={overallScore} />
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Weighted composite score (3-8 scale). Min 3, Max 8.
        </p>
      </div>

      {/* Category Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Category Breakdown</h3>
        <div className="space-y-5">
          {categories.map((cat) => {
            const score = categoryScores[cat] ?? 3;
            const trend = trends[cat];
            return (
              <div key={cat}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="text-sm font-medium text-slate-800">
                      {categoryLabels[cat]}
                    </span>
                    <span className="text-xs text-slate-500 ml-2">
                      {categoryDescriptions[cat]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ScoreBadge score={score} size="sm" />
                    {trend && (
                      <TrendIndicator
                        delta={trend.delta}
                        direction={trend.direction as "up" | "down" | "flat"}
                      />
                    )}
                  </div>
                </div>
                <ScoreBar score={score} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

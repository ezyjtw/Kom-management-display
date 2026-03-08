"use client";

import type { ScoringConfigData, Category } from "@/types";

const categoryLabels: Record<Category, string> = {
  daily_tasks: "Daily Tasks",
  projects: "Projects / Docs",
  asset_actions: "Asset Actions",
  quality: "Mistakes vs Positives",
  knowledge: "Crypto Knowledge",
};

interface ScoringWeightsTabProps {
  config: ScoringConfigData;
  onUpdateWeight: (category: Category, value: number) => void;
}

export default function ScoringWeightsTab({ config, onUpdateWeight }: ScoringWeightsTabProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="text-lg font-semibold mb-4">Category Weights</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Weights determine how each category contributes to the overall score. Must total 1.0 (100%).
      </p>
      <div className="space-y-4">
        {(Object.keys(config.weights) as Category[]).map((cat) => (
          <div key={cat} className="flex items-center gap-4">
            <label className="w-40 text-sm font-medium text-foreground">
              {categoryLabels[cat]}
            </label>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.05}
              value={config.weights[cat]}
              onChange={(e) => onUpdateWeight(cat, parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="w-16 text-sm text-right font-mono">
              {(config.weights[cat] * 100).toFixed(0)}%
            </span>
          </div>
        ))}
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Total</span>
            <span
              className={`text-sm font-mono font-bold ${
                Math.abs(
                  Object.values(config.weights).reduce((a, b) => a + b, 0) - 1
                ) < 0.01
                  ? "text-emerald-600"
                  : "text-red-600"
              }`}
            >
              {(Object.values(config.weights).reduce((a, b) => a + b, 0) * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-muted/50 rounded-lg">
        <h4 className="text-sm font-semibold mb-2">Score Clamping</h4>
        <div className="flex items-center gap-6">
          <div>
            <label className="text-xs text-muted-foreground">Minimum Score</label>
            <p className="text-lg font-bold text-red-600">{config.clampMin}</p>
          </div>
          <div className="flex-1 h-2 bg-muted rounded-full relative">
            <div
              className="absolute h-2 bg-gradient-to-r from-red-400 via-amber-400 to-emerald-400 rounded-full"
              style={{ left: "0%", width: "100%" }}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Maximum Score</label>
            <p className="text-lg font-bold text-emerald-600">{config.clampMax}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Scores are displayed on a 1-10 scale but clamped to {config.clampMin}-{config.clampMax} to prevent
          demoralising extremes and inflation.
        </p>
      </div>
    </div>
  );
}

"use client";

interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showOutOf?: boolean;
}

function getScoreColor(score: number): string {
  if (score >= 6.5) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (score >= 5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function getScoreBarColor(score: number): string {
  if (score >= 6.5) return "bg-emerald-500";
  if (score >= 5) return "bg-amber-500";
  return "bg-red-500";
}

export function ScoreBadge({ score, size = "md", showOutOf = true }: ScoreBadgeProps) {
  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5",
    md: "text-sm px-2 py-1",
    lg: "text-lg px-3 py-1.5 font-semibold",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium ${getScoreColor(score)} ${sizeClasses[size]}`}
    >
      {score.toFixed(1)}{showOutOf && <span className="text-xs opacity-60 ml-0.5">/8</span>}
    </span>
  );
}

export function ScoreBar({ score, label }: { score: number; label?: string }) {
  const percentage = ((score - 3) / 5) * 100; // Map 3-8 to 0-100%

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-600">{label}</span>
          <span className="font-medium">{score.toFixed(1)}</span>
        </div>
      )}
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${getScoreBarColor(score)}`}
          style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
        />
      </div>
    </div>
  );
}

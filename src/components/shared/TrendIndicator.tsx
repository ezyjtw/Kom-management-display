"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface TrendIndicatorProps {
  delta: number;
  direction: "up" | "down" | "flat";
  size?: "sm" | "md";
}

export function TrendIndicator({ delta, direction, size = "sm" }: TrendIndicatorProps) {
  const iconSize = size === "sm" ? 14 : 18;
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  if (direction === "up") {
    return (
      <span className={`inline-flex items-center gap-0.5 text-emerald-600 ${textSize}`}>
        <TrendingUp size={iconSize} />
        +{Math.abs(delta).toFixed(1)}
      </span>
    );
  }

  if (direction === "down") {
    return (
      <span className={`inline-flex items-center gap-0.5 text-red-600 ${textSize}`}>
        <TrendingDown size={iconSize} />
        -{Math.abs(delta).toFixed(1)}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-0.5 text-slate-400 ${textSize}`}>
      <Minus size={iconSize} />
      0.0
    </span>
  );
}

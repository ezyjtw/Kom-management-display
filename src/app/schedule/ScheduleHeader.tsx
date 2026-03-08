import {
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  Sun,
  Palmtree,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import type { Tab, DailySummary } from "./types";

interface ScheduleHeaderProps {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  changeDate: (delta: number) => void;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  dailySummary: DailySummary | null;
}

const tabs: Array<{ key: Tab; label: string; icon: typeof Calendar }> = [
  { key: "rota", label: "Team Rota", icon: RotateCcw },
  { key: "daily", label: "Daily Tasks", icon: CheckCircle2 },
  { key: "oncall", label: "On-Call", icon: Clock },
  { key: "holidays", label: "Holidays", icon: Sun },
  { key: "pto", label: "PTO / Leave", icon: Palmtree },
];

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function ScheduleHeader({
  selectedDate,
  setSelectedDate,
  changeDate,
  activeTab,
  setActiveTab,
  dailySummary,
}: ScheduleHeaderProps) {
  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Schedule & Tasks</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            On-call schedule, daily task allocation, holidays, and PTO management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeDate(-1)} className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg">
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          />
          <button onClick={() => changeDate(1)} className="p-2 text-muted-foreground hover:text-foreground border border-border rounded-lg">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Date Display */}
      <div className="text-sm font-medium text-muted-foreground">
        {formatDate(selectedDate)}
        {dailySummary?.holidays && dailySummary.holidays.length > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded text-xs">
            {dailySummary.holidays.map((h) => h.name).join(", ")}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-card rounded-xl border border-border p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors flex-1 justify-center ${
              activeTab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <Icon size={16} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

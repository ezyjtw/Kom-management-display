import {
  Clock,
  Calendar,
  Users,
  Plus,
  MapPin,
  Home,
  Moon,
  Sun,
  AlertTriangle,
} from "lucide-react";
import type { RotaData, RotaMember, OnCallEntry, Employee } from "./types";
import { TEAMS } from "./types";

interface OnCallRotaProps {
  rotaData: RotaData | null;
}

const SHIFT_BADGES: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  standard: { label: "Standard", color: "bg-blue-500/10 text-blue-400", icon: Clock },
  late: { label: "Late Shift", color: "bg-purple-500/10 text-purple-400", icon: Moon },
  weekend: { label: "Weekend", color: "bg-amber-500/10 text-amber-400", icon: Calendar },
};

const LOCATION_COLORS: Record<string, string> = {
  London: "text-blue-400",
  "Hong Kong": "text-emerald-400",
  Jersey: "text-amber-400",
};

function formatPeriod(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — ${e.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function MemberBadge({ member }: { member: RotaMember }) {
  const shiftCfg = SHIFT_BADGES[member.shiftType] || SHIFT_BADGES.standard;
  const locColor = LOCATION_COLORS[member.location] || "text-muted-foreground";

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border ${member.hasPto ? "opacity-50 bg-red-500/5" : "bg-card"}`}>
      <Users size={14} className="text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{member.employeeName}</span>
          {member.hasPto && (
            <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">PTO</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span className={`flex items-center gap-1 ${locColor}`}>
            <MapPin size={10} />
            {member.location}
          </span>
          {member.isWfh && (
            <span className="flex items-center gap-1 text-purple-400">
              <Home size={10} />
              WFH
            </span>
          )}
          {member.shiftType !== "standard" && (
            <span className={`px-1.5 py-0.5 rounded ${shiftCfg.color}`}>
              {shiftCfg.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── On-Call Schedule Table ───

interface OnCallScheduleProps {
  entries: OnCallEntry[];
  selectedDate: string;
  employees: Employee[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newOnCall: { team: string; employeeId: string; shiftType: string };
  setNewOnCall: (v: OnCallScheduleProps["newOnCall"]) => void;
  onAdd: () => void;
}

export function OnCallSchedule({
  entries,
  selectedDate,
  employees,
  showAdd,
  setShowAdd,
  newOnCall,
  setNewOnCall,
  onAdd,
}: OnCallScheduleProps) {
  // Group entries by date
  const byDate = new Map<string, OnCallEntry[]>();
  entries.forEach((e) => {
    const d = e.date.split("T")[0];
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(e);
  });

  const dates = Array.from(byDate.keys()).sort();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          <Plus size={16} /> Assign On-Call
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Assign On-Call for {selectedDate}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Team</label>
              <select value={newOnCall.team} onChange={(e) => setNewOnCall({ ...newOnCall, team: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Employee</label>
              <select value={newOnCall.employeeId} onChange={(e) => setNewOnCall({ ...newOnCall, employeeId: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="">Select...</option>
                {employees.filter((e) => e.team === newOnCall.team).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Shift</label>
              <select value={newOnCall.shiftType} onChange={(e) => setNewOnCall({ ...newOnCall, shiftType: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="primary">Primary</option>
                <option value="backup">Backup</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Assign</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      {/* Schedule Grid */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Date</th>
                {TEAMS.map((t) => (
                  <th key={t} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No on-call assignments in this range</td></tr>
              ) : (
                dates.map((date) => {
                  const isToday = date === selectedDate;
                  return (
                    <tr key={date} className={`border-b border-border ${isToday ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <span className={`text-sm ${isToday ? "font-semibold text-primary" : "text-foreground"}`}>
                          {new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                      </td>
                      {TEAMS.map((team) => {
                        const teamEntries = byDate.get(date)?.filter((e) => e.team === team) || [];
                        return (
                          <td key={team} className="px-4 py-3">
                            {teamEntries.length === 0 ? (
                              <span className="text-muted-foreground text-xs">&mdash;</span>
                            ) : (
                              teamEntries.map((e) => (
                                <div key={e.id} className="flex items-center gap-1">
                                  <Users size={12} className="text-muted-foreground" />
                                  <span className="text-sm text-foreground">{e.employeeName}</span>
                                  {e.shiftType === "backup" && (
                                    <span className="text-xs text-muted-foreground">(backup)</span>
                                  )}
                                </div>
                              ))
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Rota View ───

export default function OnCallRota({ rotaData }: OnCallRotaProps) {
  if (!rotaData || rotaData.subTeams.length === 0) {
    return <div className="text-muted-foreground text-center py-8">No rota data available</div>;
  }

  return (
    <div className="space-y-4">
      {/* PTO warnings */}
      {rotaData.pto.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
          <h4 className="text-xs font-medium text-amber-400 mb-2 flex items-center gap-1">
            <AlertTriangle size={12} />
            PTO / Leave in this period
          </h4>
          <div className="flex flex-wrap gap-2">
            {rotaData.pto.map((p, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-amber-500/10 text-amber-300 rounded">
                {p.employeeName}: {new Date(p.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — {new Date(p.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sub-team cards */}
      {rotaData.subTeams.map((st) => (
        <div key={st.subTeam.id} className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{st.subTeam.name}</h3>
            <p className="text-xs text-muted-foreground">{st.subTeam.description}</p>
          </div>

          {st.periods.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No assignments for this period</div>
          ) : (
            <div className="divide-y divide-border">
              {st.periods.map((period, idx) => (
                <div key={idx} className="px-4 py-3">
                  {/* Period header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      {formatPeriod(period.startDate, period.endDate)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-accent/50 text-accent-foreground rounded capitalize">
                      {period.rotationCycle} rotation
                    </span>
                  </div>

                  {/* Lead */}
                  {period.lead && (
                    <div className="mb-2">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Team Lead</p>
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-primary/30 ${period.lead.hasPto ? "opacity-50 bg-red-500/5" : "bg-primary/5"}`}>
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                          <Users size={12} className="text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{period.lead.employeeName}</span>
                            {period.lead.hasPto && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">PTO</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className={`flex items-center gap-1 ${LOCATION_COLORS[period.lead.location] || ""}`}>
                              <MapPin size={10} />
                              {period.lead.location}
                            </span>
                            {period.lead.isWfh && (
                              <span className="flex items-center gap-1 text-purple-400"><Home size={10} /> WFH</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Members */}
                  {period.members.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Team Members</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {period.members.map((m) => (
                          <MemberBadge key={m.id} member={m} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Holidays in range */}
      {rotaData.holidays.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Sun size={12} className="text-amber-400" />
            Holidays in this period
          </h4>
          <div className="flex flex-wrap gap-2">
            {rotaData.holidays.map((h, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-amber-500/10 text-amber-300 rounded">
                {h.name} — {new Date(h.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ({h.region})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

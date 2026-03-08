import { Plus, Palmtree } from "lucide-react";
import type { PtoEntry, Employee } from "./types";

interface PtoSectionProps {
  entries: PtoEntry[];
  employees: Employee[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newPto: { employeeId: string; startDate: string; endDate: string; type: string; notes: string };
  setNewPto: (v: PtoSectionProps["newPto"]) => void;
  onAdd: () => void;
}

const typeLabels: Record<string, string> = {
  annual_leave: "Annual Leave",
  sick: "Sick Leave",
  wfh: "WFH",
  other: "Other",
};

const typeColors: Record<string, string> = {
  annual_leave: "bg-blue-500/10 text-blue-400",
  sick: "bg-red-500/10 text-red-400",
  wfh: "bg-purple-500/10 text-purple-400",
  other: "bg-gray-500/10 text-gray-400",
};

export default function PtoSection({
  entries,
  employees,
  showAdd,
  setShowAdd,
  newPto,
  setNewPto,
  onAdd,
}: PtoSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          <Plus size={16} /> Add PTO
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add PTO / Leave</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Employee</label>
              <select value={newPto.employeeId} onChange={(e) => setNewPto({ ...newPto, employeeId: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="">Select...</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.team})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Type</label>
              <select value={newPto.type} onChange={(e) => setNewPto({ ...newPto, type: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="annual_leave">Annual Leave</option>
                <option value="sick">Sick Leave</option>
                <option value="wfh">WFH</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
              <input type="date" value={newPto.startDate} onChange={(e) => setNewPto({ ...newPto, startDate: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">End Date</label>
              <input type="date" value={newPto.endDate} onChange={(e) => setNewPto({ ...newPto, endDate: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">No PTO records for this period</div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                <Palmtree size={16} className="text-emerald-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{p.employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {" — "}
                    {new Date(p.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    {p.notes && ` · ${p.notes}`}
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${typeColors[p.type] || ""}`}>
                  {typeLabels[p.type] || p.type}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

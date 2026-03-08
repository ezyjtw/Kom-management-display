import { Plus, Sun } from "lucide-react";
import type { Holiday } from "./types";

interface HolidaysSectionProps {
  holidays: Holiday[];
  showAdd: boolean;
  setShowAdd: (v: boolean) => void;
  newHoliday: { name: string; region: string };
  setNewHoliday: (v: HolidaysSectionProps["newHoliday"]) => void;
  onAdd: () => void;
}

export default function HolidaysSection({
  holidays,
  showAdd,
  setShowAdd,
  newHoliday,
  setNewHoliday,
  onAdd,
}: HolidaysSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
          <Plus size={16} /> Add Holiday
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Add Public Holiday</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Holiday Name</label>
              <input value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground" placeholder="e.g. Good Friday" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Region</label>
              <select value={newHoliday.region} onChange={(e) => setNewHoliday({ ...newHoliday, region: e.target.value })} className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground">
                <option value="Global">Global</option>
                <option value="EMEA">EMEA</option>
                <option value="APAC">APAC</option>
                <option value="Americas">Americas</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onAdd} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent/50">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {holidays.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">No holidays recorded for this year</div>
        ) : (
          <div className="divide-y divide-border">
            {holidays.map((h) => {
              const d = new Date(h.date);
              const isPast = d < new Date(new Date().toDateString());
              return (
                <div key={h.id} className={`px-4 py-3 flex items-center gap-4 ${isPast ? "opacity-50" : ""}`}>
                  <Sun size={16} className="text-amber-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{h.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded">{h.region}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

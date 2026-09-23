"use client";

/**
 * FAB ICS repo, MVP0 (spec §12 TASK-FAB). Draft process, not operational.
 * The register records what was received and sent; it sends nothing to FAB.
 */

import { useCallback, useEffect, useState } from "react";
import { Landmark, AlertTriangle } from "lucide-react";

interface Instruction { id: string; messageType: string; reference: string; instructionType: string; direction: string; asset: string; amount: number; valueDate: string; receivedAt: string; ackStatus: string; ackSentAt: string | null; correctedByRef: string | null }
interface LogRow { id: string; reference: string; status: string; txHash: string | null; kytStatus: string; occurredAt: string }
interface Balance { id: string; walletRef: string; asset: string; balance: number; recordedAt: string }

const input = "h-8 rounded-md border border-border bg-background px-2 text-xs";

export default function FabPage() {
  const [data, setData] = useState<{ instructions: Instruction[]; settlements: LogRow[]; balances: Balance[] } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const json = await fetch("/api/fab").then((r) => r.json()).catch(() => null);
    if (json?.success) setData(json.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send(url: string, method: string, body: unknown, done: string) {
    setMessage(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    setMessage(res.ok ? { ok: true, text: done } : { ok: false, text: json?.error ?? "Not saved." });
    if (res.ok) await load();
  }

  const iso = (v: FormDataEntryValue | null) => (v ? new Date(String(v)).toISOString() : new Date().toISOString());

  return (
    <div className="space-y-6">
      <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"><Landmark size={22} className="text-primary" /> FAB ICS repo (MVP0)</h1>
      <p role="note" className="p-3 rounded-lg text-sm bg-amber-500/10 text-amber-400 border border-amber-500/20 flex gap-2"><AlertTriangle size={16} className="shrink-0" /> The MVP0 settlement process is draft, not operational, and the outbound maker role is unresolved. This register records messages and settlements; it sends nothing to FAB.</p>
      {message && <div role={message.ok ? "status" : "alert"} className={`p-3 rounded-lg text-sm border ${message.ok ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>{message.text}</div>}

      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold">Instruction register</h2>
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void send("/api/fab/instructions", "POST", {
          messageType: f.get("messageType"), reference: f.get("reference"), instructionType: f.get("instructionType"), direction: f.get("direction"),
          asset: f.get("asset"), amount: Number(f.get("amount")), valueDate: f.get("valueDate"), receivedAt: iso(f.get("receivedAt")),
        }, "Instruction recorded; its ticket is opened."); }}>
          <select name="messageType" aria-label="Message type" className={input}><option>TRD_NTF</option><option>STL_INS</option></select>
          <input name="reference" required placeholder="Trade / agreement reference" aria-label="Reference" className={input} />
          <input name="instructionType" placeholder="Type (e.g. OPEN)" aria-label="Instruction type" className={input} />
          <select name="direction" aria-label="Direction" className={input}><option>RECEIVE</option><option>DELIVER</option></select>
          <input name="asset" required placeholder="Asset" aria-label="Asset" className={`${input} w-20`} />
          <input name="amount" required type="number" step="any" min="0" placeholder="Amount" aria-label="Amount" className={`${input} w-28`} />
          <input name="valueDate" required type="date" aria-label="Value date" className={input} />
          <input name="receivedAt" required type="datetime-local" aria-label="Received at" className={input} />
          <button type="submit" className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md">Record</button>
        </form>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th>Type</th><th>Reference</th><th>Direction</th><th>Amount</th><th>Value date</th><th>Received</th><th>ACK/NACK sent</th><th /></tr></thead>
          <tbody>{(data?.instructions ?? []).map((i) => (
            <tr key={i.id} className="border-t border-border/50">
              <td>{i.messageType} {i.instructionType}</td><td>{i.reference}</td><td>{i.direction}</td><td>{i.amount} {i.asset}</td><td>{i.valueDate}</td>
              <td>{new Date(i.receivedAt).toLocaleString()}</td>
              <td>{i.ackStatus === "none" ? "—" : `${i.ackStatus}${i.ackSentAt ? ` @ ${new Date(i.ackSentAt).toLocaleTimeString()}` : ""}`}{i.correctedByRef ? ` → corrected by ${i.correctedByRef}` : ""}</td>
              <td className="space-x-1">
                {i.ackStatus === "none" && <>
                  <button onClick={() => void send(`/api/fab/instructions/${i.id}`, "PATCH", { ackStatus: "ACK" }, "ACK recorded.")} className="text-emerald-400">ACK sent</button>
                  <button onClick={() => void send(`/api/fab/instructions/${i.id}`, "PATCH", { ackStatus: "NACK" }, "NACK recorded.")} className="text-red-400">NACK sent</button>
                </>}
                {i.ackStatus === "NACK" && !i.correctedByRef && <button onClick={() => { const ref = prompt("Reference of the corrected instruction:"); if (ref) void send(`/api/fab/instructions/${i.id}`, "PATCH", { correctedByRef: ref }, "Correction recorded."); }} className="text-primary">Corrected by…</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold">Settlement log</h2>
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void send("/api/fab/settlements", "POST", {
          reference: f.get("reference"), status: f.get("status"), txHash: String(f.get("txHash") || "") || undefined, kytStatus: f.get("kytStatus"), occurredAt: iso(f.get("occurredAt")),
        }, "Settlement logged."); }}>
          <input name="reference" required placeholder="Instruction reference" aria-label="Instruction reference" className={input} />
          <select name="status" aria-label="Status" className={input}><option>RECEIVED</option><option>INITIATED</option><option>COMPLETED</option><option>FAILED</option></select>
          <input name="txHash" placeholder="Tx hash (masked in views)" aria-label="Transaction hash" className={input} />
          <select name="kytStatus" aria-label="KYT" className={input}><option value="none">KYT: none</option><option value="fail">KYT: fail</option><option value="escalated">KYT: escalated</option></select>
          <input name="occurredAt" required type="datetime-local" aria-label="Occurred at" className={input} />
          <button type="submit" className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md">Log</button>
        </form>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th>Reference</th><th>Status</th><th>Tx</th><th>KYT</th><th>At</th><th /></tr></thead>
          <tbody>{(data?.settlements ?? []).map((l) => (
            <tr key={l.id} className="border-t border-border/50">
              <td>{l.reference}</td><td>{l.status}</td><td>{l.txHash ?? "—"}</td><td>{l.kytStatus}</td><td>{new Date(l.occurredAt).toLocaleString()}</td>
              <td>{(l.kytStatus === "fail" || l.kytStatus === "escalated") && <button onClick={() => void send(`/api/fab/settlements/${l.id}`, "PATCH", { kytStatus: "cleared" }, "Compliance outcome recorded.")} className="text-emerald-400">Compliance cleared</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold">Fee reserve balances</h2>
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void send("/api/fab/fee-balances", "POST", { walletRef: f.get("walletRef"), asset: f.get("asset"), balance: Number(f.get("balance")) }, "Balance recorded."); }}>
          <input name="walletRef" required placeholder="Wallet reference" aria-label="Wallet reference" className={input} />
          <input name="asset" required placeholder="Asset" aria-label="Fee asset" className={`${input} w-20`} />
          <input name="balance" required type="number" step="any" min="0" placeholder="Balance" aria-label="Balance" className={`${input} w-28`} />
          <button type="submit" className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md">Record</button>
        </form>
        <ul className="text-xs space-y-0.5">{(data?.balances ?? []).slice(0, 20).map((b) => <li key={b.id}>{b.walletRef}: {b.balance} {b.asset} <span className="text-muted-foreground">({new Date(b.recordedAt).toLocaleString()})</span></li>)}</ul>
      </section>
    </div>
  );
}

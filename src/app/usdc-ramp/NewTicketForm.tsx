"use client";

interface NewTicketFormProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

export function NewTicketForm({ onSubmit, onCancel }: NewTicketFormProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">New Ramp Instruction</h3>
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <input name="clientName" required placeholder="Client Legal Name" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <input name="clientAccount" placeholder="Service Account" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <select name="direction" required className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
          <option value="onramp">Onramp (USD → USDC)</option>
          <option value="offramp">Offramp (USDC → USD)</option>
        </select>
        <input name="amount" required type="number" step="0.01" placeholder="USDC Amount" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <select name="fiatCurrency" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
          <option value="CHF">CHF</option>
        </select>
        <input name="fiatAmount" type="number" step="0.01" placeholder="Fiat Amount (optional)" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <input name="bankReference" placeholder="SWIFT / Payment Reference" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <input name="instructionRef" placeholder="Client Instruction Ref" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <input name="custodyWalletId" placeholder="Segregated USDC Wallet ID" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <input name="ssiDetails" placeholder="SSI / Bank Details" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <select name="priority" className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
        <textarea name="notes" placeholder="Notes" rows={2} className="sm:col-span-2 lg:col-span-2 px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground" />
        <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent/50 text-muted-foreground">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Create Ticket</button>
        </div>
      </form>
    </div>
  );
}

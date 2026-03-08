"use client";

import { X } from "lucide-react";

interface NewTokenFormProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export function NewTokenForm({ onSubmit, onClose }: NewTokenFormProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Propose New Token</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Symbol *</label>
              <input name="symbol" required placeholder="e.g. SOL" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Name *</label>
              <input name="name" required placeholder="e.g. Solana" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Network</label>
              <input name="network" placeholder="e.g. Solana, Ethereum" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Token Type</label>
              <select name="tokenType" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                <option value="native">Native</option>
                <option value="erc20">ERC-20</option>
                <option value="spl">SPL</option>
                <option value="substrate">Substrate</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Risk Level</label>
              <select name="riskLevel" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Market Cap Tier</label>
              <select name="marketCapTier" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                <option value="mega">Mega Cap</option>
                <option value="large">Large Cap</option>
                <option value="mid">Mid Cap</option>
                <option value="small">Small Cap</option>
                <option value="micro">Micro Cap</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Notes</label>
            <textarea name="notes" rows={2} placeholder="Why should we support this token?" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Propose Token</button>
          </div>
        </form>
      </div>
    </div>
  );
}

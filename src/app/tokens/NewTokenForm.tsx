"use client";

import { useState } from "react";
import { X, FileText, Globe, Link, Users, Calendar, Cpu, Eye, ChevronDown, ChevronRight } from "lucide-react";

interface NewTokenFormProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

export function NewTokenForm({ onSubmit, onClose }: NewTokenFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Propose New Token</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={20} /></button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {/* Core Token Info */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Token Identity</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Token Ticker *</label>
                <input name="symbol" required placeholder="e.g. SOL" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Name *</label>
                <input name="name" required placeholder="e.g. Solana" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Contract Address</label>
                <input name="contractAddress" placeholder="0x..." className="w-full p-2 text-sm bg-background border border-border rounded-lg font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Network</label>
                <input name="network" placeholder="e.g. Ethereum, Solana" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
              </div>
            </div>
          </div>

          {/* Classification */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Classification</h4>
            <div className="grid grid-cols-3 gap-3">
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
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1"><Cpu size={10} /> Consensus Mechanism</label>
                <select name="consensusMechanism" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                  <option value="">Select...</option>
                  <option value="proof_of_work">Proof of Work</option>
                  <option value="proof_of_stake">Proof of Stake</option>
                  <option value="proof_of_authority">Proof of Authority</option>
                  <option value="proof_of_history">Proof of History</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1"><Eye size={10} /> Privacy Token?</label>
                <select name="privacyToken" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Blockchain Analytics</label>
                <select name="blockchainAnalytics" className="w-full p-2 text-sm bg-background border border-border rounded-lg">
                  <option value="unknown">Unknown</option>
                  <option value="pre_growth">Pre-Growth</option>
                  <option value="emerging">Emerging</option>
                  <option value="mature">Mature</option>
                </select>
              </div>
            </div>
          </div>

          {/* Platform & Vendor Support */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Platforms & Feeds</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" name="fireblocksCheck" value="true" className="rounded border-border" />
                Fireblocks
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" name="ledgerCheck" value="true" className="rounded border-border" />
                Ledger
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" name="travelRuleNotabene" value="true" className="rounded border-border" />
                Travel Rule (Notabene)
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" name="priceFeedCoingecko" value="true" className="rounded border-border" />
                Price Feed (CoinGecko)
              </label>
            </div>
          </div>

          {/* Tracking & References */}
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <FileText size={12} /> Tracking & References
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Jira Ticket</label>
                <input name="jiraTicket" placeholder="e.g. TOK-123" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Compliance Doc</label>
                <input name="complianceDoc" placeholder="Link to compliance document" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
              </div>
            </div>
          </div>

          {/* Advanced / Optional Fields */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {showAdvanced ? "Hide" : "Show"} project details
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar size={10} /> Launch Date</label>
                  <input name="launchDate" type="date" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><Users size={10} /> Founder(s)</label>
                  <input name="founders" placeholder="e.g. Anatoly Yakovenko" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><Globe size={10} /> Website</label>
                  <input name="website" placeholder="https://..." className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><Link size={10} /> Block Explorer</label>
                  <input name="explorer" placeholder="https://etherscan.io/token/..." className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground flex items-center gap-1"><FileText size={10} /> Whitepaper</label>
                  <input name="whitepaper" placeholder="URL to whitepaper" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Supported Networks</label>
                  <input name="supportedNetworks" placeholder="e.g. Ethereum, BSC, Polygon" className="w-full p-2 text-sm bg-background border border-border rounded-lg" />
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
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

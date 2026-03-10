"use client";

import { Plus, ArrowRight, TrendingUp, Shield, ExternalLink, Sparkles, RefreshCw, Clock, Globe, CheckCircle2, XCircle, AlertCircle, HelpCircle, FileText, Users, Link, Cpu, Eye, BarChart3 } from "lucide-react";
import type { TokenEntry, JurisdictionGuidance } from "./types";
import {
  STATUS_FLOW, SIGNAL_TYPE_LABELS, MARKET_CAP_LABELS,
  VENDOR_STATUS_COLORS, VENDOR_STATUS_LABELS, JURISDICTION_LABELS,
  BLOCKCHAIN_ANALYTICS_LABELS, BLOCKCHAIN_ANALYTICS_COLORS,
  CONSENSUS_LABELS, JURISDICTION_STATUS_COLORS, JURISDICTION_STATUS_LABELS,
  DEFAULT_JURISDICTION_GUIDANCE,
} from "./types";

/** Render a value that may be a string or an object as readable text */
function renderField(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        const label = k.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").trim();
        const val = typeof v === "object" && v !== null ? JSON.stringify(v, null, 2) : String(v ?? "");
        return `${label}: ${val}`;
      })
      .join("\n");
  }
  return String(value);
}

interface TokenDetailPanelProps {
  token: TokenEntry;
  showSignalForm: string | null;
  researchResults: Record<string, Record<string, unknown>>;
  researchLoading: string | null;
  aiEnabled: boolean | null;
  showRegulatory: string | null;
  onStatusChange: (tokenId: string, newStatus: string) => void;
  onToggleCheck: (tokenId: string, field: "sanctionsCheck" | "amlRiskAssessed", currentValue: boolean) => void;
  onUpdateVendor: (tokenId: string, vendor: string, status: string) => void;
  onAddSignal: (e: React.FormEvent<HTMLFormElement>, tokenId: string) => void;
  onSetShowSignalForm: (id: string | null) => void;
  onResearch: (token: TokenEntry) => void;
  onApplyResearch: (tokenId: string) => void;
  onSetShowRegulatory: (id: string | null) => void;
}

function renderVendorBadge(status: string) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${VENDOR_STATUS_COLORS[status] || VENDOR_STATUS_COLORS.unknown}`}>
      {VENDOR_STATUS_LABELS[status] || status}
    </span>
  );
}

function renderRegulatoryBreakdown(regulatoryConsiderations: unknown) {
  if (!regulatoryConsiderations || typeof regulatoryConsiderations !== "object") {
    return <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(regulatoryConsiderations)}</p>;
  }
  const rc = regulatoryConsiderations as Record<string, unknown>;
  const jurisdictions = rc.jurisdictions as Record<string, string> | undefined;

  return (
    <div className="space-y-2">
      {!!rc.overall && <p className="text-xs text-foreground font-medium">{String(rc.overall)}</p>}
      {jurisdictions && (
        <div className="grid grid-cols-1 gap-1.5">
          {Object.entries(jurisdictions).map(([key, analysis]) => (
            <div key={key} className="flex gap-2 text-xs p-1.5 bg-background/50 rounded">
              <span className="text-primary font-medium shrink-0 w-28 flex items-center gap-1">
                <Globe size={10} />
                {JURISDICTION_LABELS[key] || key}
              </span>
              <span className="text-muted-foreground">{String(analysis)}</span>
            </div>
          ))}
        </div>
      )}
      {!!rc.sanctionsExposure && (
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Sanctions:</span> {String(rc.sanctionsExposure)}</p>
      )}
      {Array.isArray(rc.keyRisks) && rc.keyRisks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rc.keyRisks.map((r: string, i: number) => (
            <span key={i} className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-400 rounded">{r}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Render the per-jurisdiction compliance guidance panel */
function renderJurisdictionGuidance(token: TokenEntry) {
  const hasCustomStatus = token.jurisdictionStatus && Object.keys(token.jurisdictionStatus).length > 0;
  const allJurisdictions = Object.keys(DEFAULT_JURISDICTION_GUIDANCE);

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <Globe size={12} /> Per-Jurisdiction Compliance Guidance
        {token.privacyToken && (
          <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-400 rounded font-normal">
            Privacy Token - Heightened Scrutiny
          </span>
        )}
      </h4>
      <div className="grid grid-cols-1 gap-2">
        {allJurisdictions.map((jKey) => {
          const defaults = DEFAULT_JURISDICTION_GUIDANCE[jKey];
          const custom = hasCustomStatus ? (token.jurisdictionStatus[jKey] as JurisdictionGuidance | undefined) : undefined;
          const status = custom?.status || "unknown";

          return (
            <div key={jKey} className={`p-3 rounded-lg border ${JURISDICTION_STATUS_COLORS[status] || JURISDICTION_STATUS_COLORS.unknown}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">{JURISDICTION_LABELS[jKey] || jKey}</span>
                  <span className="text-[10px] text-muted-foreground">{defaults.regulator}</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${JURISDICTION_STATUS_COLORS[status] || JURISDICTION_STATUS_COLORS.unknown}`}>
                  {JURISDICTION_STATUS_LABELS[status] || status}
                </span>
              </div>
              {custom?.classification && (
                <p className="text-xs text-foreground mb-1">
                  <span className="text-muted-foreground">Classification:</span> {custom.classification}
                </p>
              )}
              {!custom?.classification && (
                <p className="text-xs text-muted-foreground mb-1">
                  <span className="text-foreground">Default classification:</span> {defaults.defaultClassification}
                </p>
              )}
              <div className="space-y-0.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Key Requirements:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {(custom?.requirements && custom.requirements.length > 0 ? custom.requirements : defaults.keyRequirements).map((req, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-primary mt-0.5 shrink-0">&#8226;</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {custom?.notes && (
                <p className="text-xs text-muted-foreground mt-1.5 p-1.5 bg-background/30 rounded">
                  <span className="font-medium text-foreground">Notes:</span> {custom.notes}
                </p>
              )}
              {token.privacyToken && jKey === "Japan" && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={10} /> Privacy tokens have been delisted from Japanese registered exchanges.
                </p>
              )}
              {token.privacyToken && jKey === "EU" && (
                <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={10} /> MiCA traceability requirements may conflict with privacy features.
                </p>
              )}
              {token.privacyToken && jKey === "US" && (
                <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={10} /> Privacy tokens face heightened FinCEN/OFAC scrutiny. Several exchanges have delisted.
                </p>
              )}
              {token.privacyToken && jKey === "UK" && (
                <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                  <AlertCircle size={10} /> FCA has signalled concerns about unhosted wallet transfers for privacy tokens.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TokenDetailPanel({
  token,
  showSignalForm,
  researchResults,
  researchLoading,
  aiEnabled,
  showRegulatory,
  onStatusChange,
  onToggleCheck,
  onUpdateVendor,
  onAddSignal,
  onSetShowSignalForm,
  onResearch,
  onApplyResearch,
  onSetShowRegulatory,
}: TokenDetailPanelProps) {
  return (
    <div className="border-t border-border p-4 space-y-4">
      {/* Token Listing Checklist */}
      <div className="p-3 bg-muted/10 rounded-lg border border-border/50 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <FileText size={12} /> Token Listing Checklist
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Token Ticker:</span>{" "}
            <span className="text-foreground font-medium">{token.symbol}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Jira Ticket:</span>{" "}
            <span className="text-foreground">{token.jiraTicket || <span className="text-muted-foreground/50 italic">Not set</span>}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Compliance Doc:</span>{" "}
            {token.complianceDoc ? (
              <a href={token.complianceDoc} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                View <ExternalLink size={8} />
              </a>
            ) : <span className="text-muted-foreground/50 italic">Not set</span>}
          </div>
          <div>
            <span className="text-muted-foreground">Contract Address:</span>{" "}
            <span className="text-foreground font-mono text-[10px]">{token.contractAddress ? `${token.contractAddress.substring(0, 12)}...` : "N/A"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Launch Date:</span>{" "}
            <span className="text-foreground">{token.launchDate || <span className="text-muted-foreground/50 italic">Unknown</span>}</span>
          </div>
          <div className="flex items-center gap-1">
            <Users size={10} className="text-muted-foreground" />
            <span className="text-muted-foreground">Founder(s):</span>{" "}
            <span className="text-foreground truncate">{token.founders || <span className="text-muted-foreground/50 italic">Unknown</span>}</span>
          </div>
          <div>
            <Globe size={10} className="inline text-muted-foreground mr-0.5" />
            <span className="text-muted-foreground">Website:</span>{" "}
            {token.website ? (
              <a href={token.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                Visit <ExternalLink size={8} />
              </a>
            ) : <span className="text-muted-foreground/50 italic">Not set</span>}
          </div>
          <div>
            <span className="text-muted-foreground">Networks:</span>{" "}
            <span className="text-foreground">{token.supportedNetworks && token.supportedNetworks.length > 0 ? token.supportedNetworks.join(", ") : token.network || "N/A"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Whitepaper:</span>{" "}
            {token.whitepaper ? (
              <a href={token.whitepaper} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                View <ExternalLink size={8} />
              </a>
            ) : <span className="text-muted-foreground/50 italic">Not set</span>}
          </div>
          <div>
            <Link size={10} className="inline text-muted-foreground mr-0.5" />
            <span className="text-muted-foreground">Explorer:</span>{" "}
            {token.explorer ? (
              <a href={token.explorer} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                View <ExternalLink size={8} />
              </a>
            ) : <span className="text-muted-foreground/50 italic">Not set</span>}
          </div>
        </div>

        {/* Platform & Analytics Checklist */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs pt-2 border-t border-border/30">
          <div>
            <span className="text-muted-foreground">Platforms:</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${token.fireblocksSupport === "supported" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
                {token.fireblocksSupport === "supported" ? <CheckCircle2 size={8} /> : <XCircle size={8} />} Fireblocks
              </span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${token.ledgerSupport === "supported" ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
                {token.ledgerSupport === "supported" ? <CheckCircle2 size={8} /> : <XCircle size={8} />} Ledger
              </span>
            </div>
          </div>
          <div>
            <span className="text-muted-foreground flex items-center gap-1"><BarChart3 size={10} /> Blockchain Analytics:</span>
            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${BLOCKCHAIN_ANALYTICS_COLORS[token.blockchainAnalytics] || BLOCKCHAIN_ANALYTICS_COLORS.unknown}`}>
              {BLOCKCHAIN_ANALYTICS_LABELS[token.blockchainAnalytics] || token.blockchainAnalytics}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Travel Rule:</span>
            <span className={`block mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${token.travelRuleNotabene ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
              {token.travelRuleNotabene ? <CheckCircle2 size={8} /> : <XCircle size={8} />} Notabene
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Price Feed:</span>
            <span className={`block mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${token.priceFeedCoingecko ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
              {token.priceFeedCoingecko ? <CheckCircle2 size={8} /> : <XCircle size={8} />} CoinGecko
            </span>
          </div>
        </div>

        {/* Consensus & Privacy */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs pt-2 border-t border-border/30">
          <div>
            <Cpu size={10} className="inline text-muted-foreground mr-0.5" />
            <span className="text-muted-foreground">Consensus:</span>{" "}
            <span className="text-foreground">{CONSENSUS_LABELS[token.consensusMechanism] || token.consensusMechanism || "N/A"}</span>
          </div>
          <div>
            <Eye size={10} className="inline text-muted-foreground mr-0.5" />
            <span className="text-muted-foreground">Privacy Token:</span>{" "}
            <span className={token.privacyToken ? "text-red-400 font-medium" : "text-emerald-400"}>
              {token.privacyToken ? "Yes" : "No"}
            </span>
            {token.privacyToken && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-400 rounded">
                High compliance risk
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Details & Compliance */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Token Details</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{token.tokenType}</span></div>
            <div><span className="text-muted-foreground">Market Cap:</span> <span className="text-foreground">{MARKET_CAP_LABELS[token.marketCapTier]}</span></div>
            <div><span className="text-muted-foreground">Staking:</span> <span className={token.stakingAvailable ? "text-emerald-400" : "text-muted-foreground"}>{token.stakingAvailable ? "Available" : "N/A"}</span></div>
            <div><span className="text-muted-foreground">Custodians:</span> <span className="text-foreground">{token.custodianSupport.length > 0 ? token.custodianSupport.join(", ") : "None"}</span></div>
          </div>

          {/* Third-Party Vendor Support */}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <ExternalLink size={12} /> Third-Party Support
          </h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([
              { key: "fireblocksSupport" as const, label: "Fireblocks" },
              { key: "ledgerSupport" as const, label: "Ledger" },
              { key: "chainalysisSupport" as const, label: "Chainalysis" },
              { key: "notabeneSupport" as const, label: "Notabene" },
            ]).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between p-1.5 bg-muted/20 rounded">
                <span className="text-muted-foreground">{label}</span>
                <select
                  value={token[key]}
                  onChange={(e) => onUpdateVendor(token.id, key, e.target.value)}
                  className="text-[10px] bg-transparent border-none outline-none cursor-pointer"
                >
                  <option value="supported">Supported</option>
                  <option value="partial">Partial</option>
                  <option value="not_supported">Not Supported</option>
                  <option value="unknown">Unknown</option>
                </select>
                {renderVendorBadge(token[key])}
              </div>
            ))}
          </div>
          {token.vendorNotes && Object.keys(token.vendorNotes).length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {Object.entries(token.vendorNotes).map(([vendor, note]) => (
                <p key={vendor}><span className="font-medium text-foreground">{vendor}:</span> {note}</p>
              ))}
            </div>
          )}

          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Shield size={12} /> Compliance</h4>
          <div className="flex items-center gap-4 text-xs">
            <button
              onClick={() => onToggleCheck(token.id, "sanctionsCheck", token.sanctionsCheck)}
              className={`flex items-center gap-1 px-2 py-1 rounded ${token.sanctionsCheck ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}
            >
              {token.sanctionsCheck ? "Sanctions OK" : "Sanctions Pending"}
            </button>
            <button
              onClick={() => onToggleCheck(token.id, "amlRiskAssessed", token.amlRiskAssessed)}
              className={`flex items-center gap-1 px-2 py-1 rounded ${token.amlRiskAssessed ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}
            >
              {token.amlRiskAssessed ? "AML Assessed" : "AML Pending"}
            </button>
          </div>
          {token.riskNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Risk notes:</span> {token.riskNotes}</p>}
          {token.regulatoryNotes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Regulatory:</span> {token.regulatoryNotes}</p>}
          {token.notes && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Notes:</span> {token.notes}</p>}
          {token.rejectionReason && <p className="text-xs text-red-400"><span className="font-medium">Rejected:</span> {token.rejectionReason}</p>}
        </div>

        {/* Right: Pipeline + Demand */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pipeline Progress</h4>
          <div className="flex items-center gap-1">
            {STATUS_FLOW.map((s, i) => {
              const idx = STATUS_FLOW.indexOf(token.status);
              const reached = token.status === "rejected" ? false : i <= idx;
              return (
                <div key={s} className="flex items-center gap-1 flex-1">
                  <div className={`h-1.5 flex-1 rounded-full ${reached ? "bg-primary" : "bg-muted"}`} />
                  {i < STATUS_FLOW.length - 1 && <ArrowRight size={10} className="text-muted-foreground shrink-0" />}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {STATUS_FLOW.map((s) => (
              <span key={s} className="flex-1 text-center">{s.replace(/_/g, " ")}</span>
            ))}
          </div>

          {token.status !== "live" && token.status !== "rejected" && (
            <div className="flex flex-wrap gap-2">
              {token.status === "proposed" && (
                <button onClick={() => onStatusChange(token.id, "under_review")} className="px-3 py-1 text-xs bg-indigo-500/10 text-indigo-400 rounded hover:bg-indigo-500/20">Start Review</button>
              )}
              {token.status === "under_review" && (
                <button onClick={() => onStatusChange(token.id, "compliance_review")} className="px-3 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Send to Compliance</button>
              )}
              {token.status === "compliance_review" && (
                <button onClick={() => onStatusChange(token.id, "approved")} className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">Approve</button>
              )}
              {token.status === "approved" && (
                <button onClick={() => onStatusChange(token.id, "live")} className="px-3 py-1 text-xs bg-purple-500/10 text-purple-400 rounded hover:bg-purple-500/20">Mark Live</button>
              )}
              <button onClick={() => onStatusChange(token.id, "rejected")} className="px-3 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20">Reject</button>
            </div>
          )}

          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <TrendingUp size={12} /> Demand Signals ({token.demandSignals.length})
          </h4>
          {token.demandSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No demand signals recorded.</p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {token.demandSignals.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted/30 rounded">
                  <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">{SIGNAL_TYPE_LABELS[s.signalType] || s.signalType}</span>
                  <span className="flex-1 text-foreground truncate">{s.source}{s.description ? `: ${s.description}` : ""}</span>
                  <span className="text-muted-foreground">w:{s.weight}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => onSetShowSignalForm(showSignalForm === token.id ? null : token.id)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Plus size={12} /> Add Signal
          </button>

          {showSignalForm === token.id && (
            <form onSubmit={(e) => onAddSignal(e, token.id)} className="space-y-2 p-2 bg-muted/30 rounded">
              <select name="signalType" required className="w-full p-1.5 text-xs bg-background border border-border rounded">
                <option value="client_request">Client Request</option>
                <option value="market_trend">Market Trend</option>
                <option value="competitor_listed">Competitor Listed</option>
                <option value="internal_proposal">Internal Proposal</option>
              </select>
              <input name="source" placeholder="Source (e.g. client name)" className="w-full p-1.5 text-xs bg-background border border-border rounded" />
              <input name="description" placeholder="Description" className="w-full p-1.5 text-xs bg-background border border-border rounded" />
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Weight (1-5):</label>
                <input name="weight" type="number" min="1" max="5" defaultValue="1" className="w-16 p-1.5 text-xs bg-background border border-border rounded" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded">Add</button>
                <button type="button" onClick={() => onSetShowSignalForm(null)} className="px-3 py-1 text-xs text-muted-foreground">Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Per-Jurisdiction Compliance Guidance */}
      <div className="border-t border-border pt-4">
        <button
          onClick={() => onSetShowRegulatory(showRegulatory === `${token.id}_juris` ? null : `${token.id}_juris`)}
          className="flex items-center gap-2 text-xs text-primary hover:underline mb-2"
        >
          <Globe size={12} />
          {showRegulatory === `${token.id}_juris` ? "Hide" : "Show"} Per-Jurisdiction Compliance Guidance
          {token.privacyToken && <span className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-400 rounded">Privacy token warnings</span>}
        </button>
        {showRegulatory === `${token.id}_juris` && renderJurisdictionGuidance(token)}
      </div>

      {/* AI Research Panel */}
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Sparkles size={12} className="text-primary" /> AI Due Diligence
            {token.aiResearchedAt && (
              <span className="text-[10px] text-muted-foreground font-normal flex items-center gap-1 ml-2">
                <Clock size={10} /> Last run: {new Date(token.aiResearchedAt).toLocaleDateString()}
              </span>
            )}
          </h4>
          {aiEnabled && (
            <button
              onClick={() => onResearch(token)}
              disabled={researchLoading === token.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 disabled:opacity-50"
            >
              {researchLoading === token.id ? (
                <><RefreshCw size={12} className="animate-spin" /> Researching...</>
              ) : researchResults[token.id] ? (
                <><RefreshCw size={12} /> Re-run Research</>
              ) : (
                <><Sparkles size={12} /> Run AI Research</>
              )}
            </button>
          )}
          {aiEnabled === false && (
            <span className="text-xs text-muted-foreground">AI not configured</span>
          )}
        </div>

        {researchResults[token.id] != null && (() => {
          const r = researchResults[token.id] as Record<string, string | Record<string, unknown> | null>;
          const recMap: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
            approve: { icon: CheckCircle2, color: "text-emerald-400", label: "Approve" },
            approve_with_conditions: { icon: AlertCircle, color: "text-amber-400", label: "Approve with Conditions" },
            further_review: { icon: HelpCircle, color: "text-blue-400", label: "Further Review Needed" },
            reject: { icon: XCircle, color: "text-red-400", label: "Reject" },
          };
          const recKey = typeof r.recommendation === "string" ? r.recommendation.toLowerCase().replace(/\s+/g, "_") : "";
          const recInfo = recMap[recKey] || recMap["further_review"];
          const RecIcon = recInfo?.icon || HelpCircle;

          return (
            <div className="space-y-3">
              {!!r.recommendation && (
                <div className={`flex items-center gap-2 p-3 rounded-lg border ${
                  recKey === "approve" ? "bg-emerald-500/5 border-emerald-500/20" :
                  recKey === "reject" ? "bg-red-500/5 border-red-500/20" :
                  recKey === "approve_with_conditions" ? "bg-amber-500/5 border-amber-500/20" :
                  "bg-blue-500/5 border-blue-500/20"
                }`}>
                  <RecIcon size={16} className={recInfo?.color || "text-muted-foreground"} />
                  <div className="flex-1">
                    <p className={`text-sm font-semibold ${recInfo?.color || "text-foreground"}`}>
                      AI Recommendation: {recInfo?.label || String(r.recommendation)}
                    </p>
                    {typeof r.recommendation === "object" && !!(r.recommendation as Record<string, unknown>)?.rationale && (
                      <p className="text-xs text-muted-foreground mt-0.5">{String((r.recommendation as Record<string, unknown>).rationale)}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => onApplyResearch(token.id)}
                      className="px-3 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20"
                    >
                      Apply Findings
                    </button>
                  </div>
                </div>
              )}

              {/* Research sections */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {!!r.summary && (
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-1">Summary</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.summary)}</p>
                  </div>
                )}
                {!!r.riskAssessment && (
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-1">Risk Assessment</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {renderField(r.riskAssessment)}
                    </p>
                  </div>
                )}
                {/* Regulatory -- with per-jurisdiction breakdown */}
                {!!r.regulatoryConsiderations && (
                  <div className="p-3 bg-muted/20 rounded-lg md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <Globe size={12} /> Regulatory Considerations
                      </p>
                      {typeof r.regulatoryConsiderations === "object" && !!(r.regulatoryConsiderations as Record<string, unknown>)?.jurisdictions && (
                        <button
                          onClick={() => onSetShowRegulatory(showRegulatory === token.id ? null : token.id)}
                          className="text-[10px] text-primary hover:underline"
                        >
                          {showRegulatory === token.id ? "Collapse" : "Show per-jurisdiction"}
                        </button>
                      )}
                    </div>
                    {showRegulatory === token.id ? (
                      renderRegulatoryBreakdown(r.regulatoryConsiderations)
                    ) : (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {typeof r.regulatoryConsiderations === "object" && (r.regulatoryConsiderations as Record<string, unknown>)?.overall
                          ? String((r.regulatoryConsiderations as Record<string, unknown>).overall)
                          : typeof r.regulatoryConsiderations === "string"
                            ? r.regulatoryConsiderations
                            : JSON.stringify(r.regulatoryConsiderations, null, 2)}
                      </p>
                    )}
                  </div>
                )}
                {!!r.custodyFeasibility && (
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-1">Custody Feasibility</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{renderField(r.custodyFeasibility)}</p>
                  </div>
                )}
                {!!r.institutionalDemand && (
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-1">Institutional Demand</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{renderField(r.institutionalDemand)}</p>
                  </div>
                )}
                {!!r.stakingInfo && r.stakingInfo !== "Not applicable" && (
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-1">Staking Info</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{renderField(r.stakingInfo)}</p>
                  </div>
                )}
                {!!r.chainAnalysis && (
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <p className="text-xs font-semibold text-foreground mb-1">Chain Analysis</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{renderField(r.chainAnalysis)}</p>
                  </div>
                )}
              </div>

              {/* Security History -- full width */}
              {!!r.securityHistory && typeof r.securityHistory === "object" && (() => {
                const sh = r.securityHistory as Record<string, unknown>;
                const incidents = Array.isArray(sh.incidents) ? sh.incidents as Array<Record<string, string>> : [];
                const ratingColors: Record<string, string> = {
                  strong: "text-emerald-400 bg-emerald-500/10",
                  adequate: "text-blue-400 bg-blue-500/10",
                  concerning: "text-amber-400 bg-amber-500/10",
                  poor: "text-red-400 bg-red-500/10",
                };
                const rating = typeof sh.overallSecurityRating === "string" ? sh.overallSecurityRating : "unknown";

                return (
                  <div className="p-3 bg-muted/20 rounded-lg border border-border/50">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                        <Shield size={12} /> Security History & Hack Analysis
                      </p>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${ratingColors[rating] || "text-muted-foreground bg-muted/30"}`}>
                        {rating.charAt(0).toUpperCase() + rating.slice(1)}
                      </span>
                    </div>

                    {incidents.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider">Known Incidents ({incidents.length})</p>
                        {incidents.map((inc, idx) => (
                          <div key={idx} className="p-2 bg-red-500/5 border border-red-500/10 rounded text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-red-400 font-medium">{inc.date || "Unknown date"}</span>
                              <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-[10px]">{(inc.type || "incident").replace(/_/g, " ")}</span>
                              {inc.fundsLost && inc.fundsLost !== "N/A" && (
                                <span className="text-red-400 font-medium">{inc.fundsLost} lost</span>
                              )}
                              {inc.recovered && (
                                <span className={`text-[10px] ${inc.recovered.toLowerCase().includes("not") ? "text-red-400" : "text-emerald-400"}`}>
                                  {inc.recovered}
                                </span>
                              )}
                            </div>
                            <p className="text-muted-foreground">{inc.description}</p>
                            {inc.rootCause && <p className="text-muted-foreground"><span className="text-foreground font-medium">Root cause:</span> {inc.rootCause}</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-400 mb-2">No known security incidents.</p>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {!!sh.auditHistory && (
                        <div>
                          <p className="text-foreground font-medium mb-0.5">Audit History</p>
                          <p className="text-muted-foreground">{String(sh.auditHistory)}</p>
                        </div>
                      )}
                      {!!sh.bugBountyProgram && (
                        <div>
                          <p className="text-foreground font-medium mb-0.5">Bug Bounty</p>
                          <p className="text-muted-foreground">{String(sh.bugBountyProgram)}</p>
                        </div>
                      )}
                    </div>
                    {!!sh.operationalRisks && (
                      <p className="text-xs text-muted-foreground mt-2"><span className="font-medium text-foreground">Operational Risks:</span> {String(sh.operationalRisks)}</p>
                    )}
                  </div>
                );
              })()}

              {/* Operator action buttons */}
              {token.status !== "live" && token.status !== "rejected" && (
                <div className="flex items-center gap-2 pt-2">
                  <span className="text-xs text-muted-foreground">Based on AI research:</span>
                  {(recKey === "approve" || recKey === "approve_with_conditions") && token.status === "proposed" && (
                    <button onClick={() => onStatusChange(token.id, "under_review")} className="px-3 py-1 text-xs bg-indigo-500/10 text-indigo-400 rounded hover:bg-indigo-500/20">Start Review</button>
                  )}
                  {(recKey === "approve" || recKey === "approve_with_conditions") && token.status === "under_review" && (
                    <button onClick={() => onStatusChange(token.id, "compliance_review")} className="px-3 py-1 text-xs bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20">Send to Compliance</button>
                  )}
                  {recKey === "approve" && token.status === "compliance_review" && (
                    <button onClick={() => onStatusChange(token.id, "approved")} className="px-3 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded hover:bg-emerald-500/20">Approve</button>
                  )}
                  {recKey === "reject" && (
                    <button onClick={() => onStatusChange(token.id, "rejected")} className="px-3 py-1 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20">Reject</button>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {!researchResults[token.id] && aiEnabled && !researchLoading && (
          <p className="text-xs text-muted-foreground">
            Click &quot;Run AI Research&quot; to get an automated due diligence report covering risk, regulatory (per-jurisdiction), custody feasibility, and institutional demand analysis.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

interface TransactionDetailsProps {
  transactionId: string;
  txHash: string;
  direction: string;
  amount: number;
  asset: string;
  senderAddress: string;
  receiverAddress: string;
  notabeneTransferId: string | null;
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 20) return addr || "\u2014";
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

export default function TransactionDetails(props: TransactionDetailsProps) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Transaction Details
      </h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-xs text-muted-foreground block">Transaction ID</span>
          <span className="font-mono text-foreground">{props.transactionId}</span>
        </div>
        {props.txHash && (
          <div>
            <span className="text-xs text-muted-foreground block">Tx Hash</span>
            <span className="font-mono text-foreground" title={props.txHash}>
              {truncateAddress(props.txHash)}
            </span>
          </div>
        )}
        <div>
          <span className="text-xs text-muted-foreground block">Direction</span>
          <span className="text-foreground">{props.direction === "IN" ? "Inbound" : props.direction === "OUT" ? "Outbound" : props.direction}</span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground block">Asset / Amount</span>
          <span className="font-mono text-foreground">
            {props.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {props.asset}
          </span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground block">Originator Address</span>
          <span className="font-mono text-foreground" title={props.senderAddress}>
            {props.senderAddress || <span className="text-red-400">Missing</span>}
          </span>
        </div>
        <div>
          <span className="text-xs text-muted-foreground block">Beneficiary Address</span>
          <span className="font-mono text-foreground" title={props.receiverAddress}>
            {props.receiverAddress || <span className="text-red-400">Missing</span>}
          </span>
        </div>
        {props.notabeneTransferId && (
          <div className="col-span-2">
            <span className="text-xs text-muted-foreground block">Notabene Transfer</span>
            <span className="font-mono text-foreground">{props.notabeneTransferId}</span>
          </div>
        )}
      </div>
    </div>
  );
}

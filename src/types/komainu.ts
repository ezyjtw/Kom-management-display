// ─── Komainu API Types ───

export type KomainuTransactionStatus = "PENDING" | "BROADCASTED" | "CONFIRMED" | "FAILED";
export type KomainuTransactionDirection = "IN" | "OUT" | "FLAT";
export type KomainuRequestStatus = "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
export type KomainuRequestType = "CREATE_TRANSACTION" | "COLLATERAL_OPERATION_OFFCHAIN" | "COLLATERAL_OPERATION_ONCHAIN";

export interface KomainuPendingTransaction {
  id: string;
  wallet_id: string;
  direction: KomainuTransactionDirection;
  asset: string;
  amount: number;
  fees: number;
  created_at: string;
  transaction_type: string;
  status: KomainuTransactionStatus;
  tx_hash: string;
  sender_address: string;
  receiver_address: string;
  note: string;
  created_by: string;
  workspace: string;
  organization: string;
  account: string;
}

export interface KomainuPendingRequest {
  id: string;
  type: KomainuRequestType;
  status: KomainuRequestStatus;
  entity: string;
  entity_id?: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  updated_at: string;
  workspace: string;
  organization: string;
  account: string;
}

export interface KomainuPendingOverview {
  pendingTransactions: KomainuPendingTransaction[];
  pendingRequests: KomainuPendingRequest[];
  transactionCount: number;
  requestCount: number;
  configured: boolean;
}

// ─── Custody API Types ───

export type CustodyTransactionStatus = "PENDING" | "BROADCASTED" | "CONFIRMED" | "FAILED";
export type CustodyTransactionDirection = "IN" | "OUT" | "FLAT";
export type CustodyRequestStatus = "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
export type CustodyRequestType = "CREATE_TRANSACTION" | "COLLATERAL_OPERATION_OFFCHAIN" | "COLLATERAL_OPERATION_ONCHAIN";

export interface CustodyPendingTransaction {
  id: string;
  wallet_id: string;
  direction: CustodyTransactionDirection;
  asset: string;
  amount: number;
  fees: number;
  created_at: string;
  transaction_type: string;
  status: CustodyTransactionStatus;
  tx_hash: string;
  sender_address: string;
  receiver_address: string;
  note: string;
  created_by: string;
  workspace: string;
  organization: string;
  account: string;
}

export interface CustodyPendingRequest {
  id: string;
  type: CustodyRequestType;
  status: CustodyRequestStatus;
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

export interface CustodyPendingOverview {
  pendingTransactions: CustodyPendingTransaction[];
  pendingRequests: CustodyPendingRequest[];
  transactionCount: number;
  requestCount: number;
  configured: boolean;
}

export interface CustodyPagedResponse<T> {
  page: number;
  count: number;
  has_next: boolean;
  data: T[];
}

export interface CustodyTransaction {
  id: string;
  wallet_id: string;
  direction: "IN" | "OUT" | "FLAT";
  asset: string;
  amount: number;
  fees: number;
  created_at: string;
  transaction_type: string;
  status: "PENDING" | "BROADCASTED" | "CONFIRMED" | "FAILED";
  tx_hash: string;
  sender_address: string;
  receiver_address: string;
  note: string;
  created_by: string;
  workspace: string;
  external_reference: string;
  organization: string;
  account: string;
}

export interface CustodyRequest {
  id: string;
  type: "CREATE_TRANSACTION" | "COLLATERAL_OPERATION_OFFCHAIN" | "COLLATERAL_OPERATION_ONCHAIN";
  status: "CREATED" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED" | "BLOCKED";
  entity: "TRANSACTION" | "COLLATERAL" | "TOKENISATION";
  entity_id?: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  updated_at: string;
  workspace: string;
  organization: string;
  account: string;
}

// ─── Travel Rule / Notabene Types ───

import type { CustodyTransactionDirection, CustodyTransactionStatus } from "./custody";

export type NotabeneTransferStatus =
  | "NEW"
  | "SENT"
  | "ACK"
  | "ACCEPTED"
  | "REJECTED"
  | "CANCELLED"
  | "INCOMPLETE";

export interface NotabeneTransfer {
  id: string;
  status: NotabeneTransferStatus;
  transactionAsset: string;
  transactionAmount: string;
  transactionHash: string | null;
  originatorVASPdid: string;
  beneficiaryVASPdid: string;
  originator: NotabeneParty | null;
  beneficiary: NotabeneParty | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotabeneParty {
  originatorPersons?: NotabenePerson[];
  beneficiaryPersons?: NotabenePerson[];
  accountNumber?: string[];
}

export interface NotabenePerson {
  naturalPerson?: {
    name: Array<{ nameIdentifier: Array<{ primaryIdentifier: string; secondaryIdentifier?: string }> }>;
    geographicAddress?: Array<{ addressLine?: string[]; country?: string }>;
    dateAndPlaceOfBirth?: { dateOfBirth?: string; placeOfBirth?: string };
  };
  legalPerson?: {
    name: Array<{ nameIdentifier: Array<{ legalPersonName: string }> }>;
  };
}

export type TravelRuleMatchStatus =
  | "matched"           // Custody tx matched to Notabene transfer
  | "unmatched"         // Custody tx with no Notabene transfer
  | "missing_originator" // Transfer exists but originator info missing
  | "missing_beneficiary"; // Transfer exists but beneficiary info missing

export interface TravelRuleReconciliationRow {
  transactionId: string;
  txHash: string;
  direction: CustodyTransactionDirection;
  asset: string;
  amount: number;
  senderAddress: string;
  receiverAddress: string;
  createdAt: string;
  status: CustodyTransactionStatus;
  matchStatus: TravelRuleMatchStatus;
  notabeneTransferId: string | null;
  notabeneStatus: NotabeneTransferStatus | null;
  hasOriginator: boolean;
  hasBeneficiary: boolean;
  originatorName: string | null;
  beneficiaryName: string | null;
  alerts: string[]; // alert IDs generated for this row
}

export interface TravelRuleOverview {
  rows: TravelRuleReconciliationRow[];
  summary: {
    total: number;
    matched: number;
    unmatched: number;
    missingOriginator: number;
    missingBeneficiary: number;
  };
  configured: { custody: boolean; notabene: boolean };
}

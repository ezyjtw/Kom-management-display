// ─── Staking Operations Types ───

export type StakingRewardModel = "auto" | "daily" | "weekly" | "monthly" | "manual_claim" | "rebate";
export type StakingStatus = "active" | "unstaking" | "inactive";
export type RewardHealthStatus = "on_time" | "approaching" | "overdue" | "no_data";

export interface StakingWalletEntry {
  id: string;
  walletAddress: string;
  asset: string;
  validator: string;
  stakedAmount: number;
  rewardModel: StakingRewardModel;
  clientName: string;
  isColdStaking: boolean;
  isTestWallet: boolean;
  stakeDate: string | null;
  expectedFirstRewardDate: string | null;
  actualFirstRewardDate: string | null;
  lastRewardAt: string | null;
  expectedNextRewardAt: string | null;
  onChainBalance: number | null;
  platformBalance: number | null;
  varianceThreshold: number;
  tags: string[];
  notes: string;
  status: StakingStatus;
  rewardHealth: RewardHealthStatus;
  varianceFlag: boolean;
  createdAt: string;
}

export interface StakingOverview {
  wallets: StakingWalletEntry[];
  summary: {
    total: number;
    active: number;
    overdue: number;
    approaching: number;
    coldStaking: number;
    reconciliationFlags: number;
  };
}

// ─── Staking Operations Types ───

export type StakingRewardModel = "auto" | "daily" | "weekly" | "monthly" | "manual_claim" | "rebate";
export type StakingStatus = "active" | "unstaking" | "inactive";
export type RewardHealthStatus = "on_time" | "approaching" | "overdue" | "no_data";

export interface StakingWalletEntry {
  id: string;
  walletAddress: string;
  asset: string;
  validator: string;
  stakedAmount: string;
  rewardModel: StakingRewardModel;
  clientName: string;
  isColdStaking: boolean;
  isTestWallet: boolean;
  stakeDate: string | null;
  expectedFirstRewardDate: string | null;
  actualFirstRewardDate: string | null;
  lastRewardAt: string | null;
  expectedNextRewardAt: string | null;
  onChainBalance: string | null;
  platformBalance: string | null;
  varianceThreshold: string;
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

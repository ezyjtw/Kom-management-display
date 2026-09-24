-- Exact amounts (review remediation): token quantities DECIMAL(38,18), USD and fiat DECIMAL(20,2).
-- Existing DOUBLE PRECISION values are converted with their shortest exact decimal form; USD values round to cents.

ALTER TABLE "TravelRuleCase" ALTER COLUMN "amount" TYPE DECIMAL(38,18) USING round("amount"::numeric, 18);
ALTER TABLE "Alert" ALTER COLUMN "exposureUsd" TYPE DECIMAL(20,2) USING round("exposureUsd"::numeric, 2);
ALTER TABLE "OesSettlement" ALTER COLUMN "amount" TYPE DECIMAL(38,18) USING round("amount"::numeric, 18);
ALTER TABLE "OesSettlement" ALTER COLUMN "delegatedAmount" DROP DEFAULT;
ALTER TABLE "OesSettlement" ALTER COLUMN "delegatedAmount" TYPE DECIMAL(38,18) USING round("delegatedAmount"::numeric, 18);
ALTER TABLE "OesSettlement" ALTER COLUMN "delegatedAmount" SET DEFAULT 0;
ALTER TABLE "UsdcRampRequest" ALTER COLUMN "amount" TYPE DECIMAL(38,18) USING round("amount"::numeric, 18);
ALTER TABLE "UsdcRampRequest" ALTER COLUMN "fiatAmount" TYPE DECIMAL(20,2) USING round("fiatAmount"::numeric, 2);
ALTER TABLE "StakingWallet" ALTER COLUMN "stakedAmount" DROP DEFAULT;
ALTER TABLE "StakingWallet" ALTER COLUMN "stakedAmount" TYPE DECIMAL(38,18) USING round("stakedAmount"::numeric, 18);
ALTER TABLE "StakingWallet" ALTER COLUMN "stakedAmount" SET DEFAULT 0;
ALTER TABLE "StakingWallet" ALTER COLUMN "onChainBalance" TYPE DECIMAL(38,18) USING round("onChainBalance"::numeric, 18);
ALTER TABLE "StakingWallet" ALTER COLUMN "platformBalance" TYPE DECIMAL(38,18) USING round("platformBalance"::numeric, 18);
ALTER TABLE "StakingWallet" ALTER COLUMN "varianceThreshold" DROP DEFAULT;
ALTER TABLE "StakingWallet" ALTER COLUMN "varianceThreshold" TYPE DECIMAL(38,18) USING round("varianceThreshold"::numeric, 18);
ALTER TABLE "StakingWallet" ALTER COLUMN "varianceThreshold" SET DEFAULT 0.01;
ALTER TABLE "ScreeningEntry" ALTER COLUMN "amount" DROP DEFAULT;
ALTER TABLE "ScreeningEntry" ALTER COLUMN "amount" TYPE DECIMAL(38,18) USING round("amount"::numeric, 18);
ALTER TABLE "ScreeningEntry" ALTER COLUMN "amount" SET DEFAULT 0;
ALTER TABLE "TransactionConfirmation" ALTER COLUMN "amount" TYPE DECIMAL(38,18) USING round("amount"::numeric, 18);
ALTER TABLE "Client" ALTER COLUMN "inboundThresholdUsd" TYPE DECIMAL(20,2) USING round("inboundThresholdUsd"::numeric, 2);
ALTER TABLE "WorkItem" ALTER COLUMN "exposureUsd" TYPE DECIMAL(20,2) USING round("exposureUsd"::numeric, 2);
ALTER TABLE "FabInstruction" ALTER COLUMN "amount" TYPE DECIMAL(38,18) USING round("amount"::numeric, 18);
ALTER TABLE "FabFeeBalance" ALTER COLUMN "balance" TYPE DECIMAL(38,18) USING round("balance"::numeric, 18);

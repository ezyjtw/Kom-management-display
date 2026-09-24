<!-- Generated from the database by `npm run coverage:matrix` (spec §12 STOP 7). -->

# Daily work coverage (29 definitions)

| Code | Name | Team | Kind | Frequency | Due (UK) | Evidence (required fields) | Ticket project | Data pull | Confluence | Flag / access |
|---|---|---|---|---|---|---|---|---|---|---|
| TASK-BILL | Billing and fee approvals (visibility only) | All | task | event | event | recordCount, dataAsOf, source | FOA | manual | CONFIRM (title: Billing Reports – Client Trading Position and Fees Approvals) | - |
| TASK-CLIENTQ | Client questions | All | task | continuous | continuous | recordCount, dataAsOf, source | JSM | manual | CONFIRM (title: Transaction Operations Task Distribution) | - |
| TASK-MORNING | Morning call and handover | All | task | daily | 09:05 | recordCount, dataAsOf, source | TOPS | manual | CONFIRM (title: Transaction Operations Task Distribution) | - |
| TASK-RISKVIEW | Risk-flagged transactions awaiting a human (read-only) | All | task | continuous | continuous | recordCount, dataAsOf, source | TOPS | manual | CONFIRM (title: Transaction Operations Task Distribution) | - |
| TASK-VENDOR | Vendor tickets | All | task | continuous | continuous | recordCount, dataAsOf, source | VSR | manual | CONFIRM (title: Transaction Operations Task Distribution) | - |
| CHK-01 | Stuck Transactions | Team 1 | check | daily | 09:05 | recordCount, dataAsOf, source, stuckCount | TOPS | automated | CONFIRM (title: Stuck Transactions) | - |
| CHK-08 | Weekly Validator Checks | Team 1 | check | weekly | 09:05 | recordCount, dataAsOf, source | TOPS | manual | CONFIRM (title: Weekly Validator Checks) | - |
| CHK-09K | KPS, K4 realisation and K3 return of assets | Team 1 | check | daily | 09:05 | recordCount, dataAsOf, source | KPR | automated | CONFIRM (title: KPS K4 Realisation and K3 Return of Assets) | kps:view |
| CHK-10 | OES and OKX collateral settlement monitoring | Team 1 | check | per_cycle | per_window | recordCount, dataAsOf, source, portfoliosExpected, settlementsSeen, completed, failed, inProgress | TOPS | automated | CONFIRM (title: FB OES Collateral Settlement Monitoring) | - |
| CHK-11 | Production Issues | Team 1 | check | daily | 09:05 | recordCount, dataAsOf, source | GXS | automated | CONFIRM (title: Production Issues) | - |
| CHK-12 | Outstanding RCA Requests | Team 1 | check | daily | 09:05 | recordCount, dataAsOf, source, overdueCount | VSR | automated | CONFIRM (title: Outstanding RCA Requests) | - |
| CHK-17 | Cold Staking Ops (T-1) Flagged Correctly | Team 1 | check | daily | 09:05 | recordCount, dataAsOf, source, flaggedCorrectlyCount | TOPS | manual | CONFIRM (title: Cold Staking Ops (T-1) Flagged Correctly) | - |
| TASK-FAB | FAB ICS repo (MVP0): instruction register and settlement log | Team 1 | task | event | event | recordCount, dataAsOf, source | FAB | manual | CONFIRM (title: FAB MVP0 Settlement Process) | module.fab |
| TASK-FAB-REPORT | Daily report to FAB sent | Team 1 | task | daily | 17:00 | recordCount, dataAsOf, source, reportSentAt | FAB | manual | CONFIRM (title: FAB MVP0 Settlement Process) | module.fab |
| CHK-02 | Daily MTD Variances (client assets) | Team 2 | check | daily | 09:05 | recordCount, dataAsOf, source, reportDataDate | OTC | manual | CONFIRM (title: Daily MTD Variances) | - |
| CHK-03 | Outstanding Requests in GX | Team 2 | check | daily | 09:05 | recordCount, dataAsOf, source, byType, byAgeBand | TOPS | automated | CONFIRM (title: Outstanding Requests in GX) | - |
| CHK-06 | Scam and Dust | Team 2 | check | daily | 09:05 | recordCount, dataAsOf, source, scamCount, dustCount, legitimateCount | TOPS | automated | CONFIRM (title: Scam and Dust) | - |
| CHK-07 | NFTs Pending Approval (review only) | Team 2 | check | daily | 09:05 | recordCount, dataAsOf, source | TOPS | manual | CONFIRM (title: NFTs Pending Approval) | - |
| CHK-13 | Outstanding Coin Reviews | Team 2 | check | daily | 09:05 | recordCount, dataAsOf, source, overdueCount | TOKENS | automated | CONFIRM (title: Outstanding Coin Reviews) | - |
| TASK-OTC | OTC Ticket Check | Team 2 | task | daily | 09:05 | recordCount, dataAsOf, source, unassignedCount, overdueCount | OTC | automated | CONFIRM (title: OTC Ticket Check) | - |
| CHK-02-DEV | Weekly MTD Variances (dev assets) | Team 3 | check | weekly | 09:05 | recordCount, dataAsOf, source, reportDataDate | OTC | manual | CONFIRM (title: Daily MTD Variances) | - |
| CHK-04 | Transaction Screening (Chainalysis) | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source, alertsCount, unscreenableCount, stakingExcludedCount | TOPS | automated | CONFIRM (title: Transaction Screening) | - |
| CHK-05 | Inbound Transaction Reporting | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source | TOPS | manual | CONFIRM (title: Inbound Transaction Reporting) | - |
| CHK-09 | Travel Rule Check | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source, matchedCount, unmatchedCount | TOPS | automated | CONFIRM (title: Travel Rule Check) | - |
| CHK-15 | Tatum Check | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source, exceptionCount | TOPS | manual | CONFIRM (title: Tatum Check) | - |
| CHK-16 | Staking Rec and Partner Confirmations | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source, variancesCount, positionViolations, confirmationsReceived, confirmationsExpected | TOPS | automated | CONFIRM (title: Staking Rec and Partner Confirmations) | - |
| CHK-21 | Staking Rewards Paid as Expected | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source, rewardsSeen, overdueCount | TOPS | automated | CONFIRM (title: Staking Rewards Paid as Expected) | - |
| CHK-22 | Newly Staked Accounts | Team 3 | check | daily | 09:05 | recordCount, dataAsOf, source | TOPS | automated | CONFIRM (title: Newly Staked Accounts) | - |
| TASK-AVIVA | Aviva daily balance report and Ripple Custody intents | Team 3 | task | daily | 09:05 | recordCount, dataAsOf, source, reportSentAt, recipientListRef | TOPS | manual | CONFIRM (title: Ripple Custody Transaction Operations SOP) | - |

Due-time alert ALR-CHK-01 enabled: no (ships disabled).
Numbering gap: CHK-14 and CHK-18..20 not found in TOP (CONFIRM-CHECK-GAPS).

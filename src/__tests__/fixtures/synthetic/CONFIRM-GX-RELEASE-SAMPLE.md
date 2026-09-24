> SYNTHETIC fixture built from the headings of "[GX-Orchestrate] Sprint X.XX Release Notes – Template" (spec §16.9).
> Not real release notes. TODO(CONFIRM-GX-RELEASE-SAMPLE): replace with a redacted real page once available.

# [GX-Orchestrate] Sprint 9.99 Release Notes

## 1. Release Summary

### 1.1 Function Released (but disabled or recently enabled in PROD)

| Function | Ops Testing Status | Ops PIC | Comments |
|---|---|---|---|
| Bulk withdrawal limits | Not started | Ann Operator | Disabled in PROD until Ops sign-off (GXD-1201) |
|  |  |  |  |

### New screens / actions

| UAT/PROD | Ops UI or Client UI | Screen | Action | Roles | Description |
|---|---|---|---|---|---|
| UAT | Ops UI | Transfer review | Filter by asset | Ops Admin | New asset filter on transfer review (GXS-3301) |
| UAT and PROD | Client UI | Client portal dashboard | Download statement | Client | New statement download |
|  |  |  |  |  |  |

### New API

| API | Method | Description | Release Engineer |
|---|---|---|---|
| /v1/collateral/positions | GET | New collateral positions endpoint, see https://github.com/example/repo/pull/12 | Engineer Person |

### Changes in Permission

| Role | Permission | Change |
|---|---|---|
| Ops Admin | Approve whitelist | Split into maker and checker permissions |

### Stake / Unstake Operation Changes

| Asset | Change | Comments |
|---|---|---|
| ETH | Unstake queue now batched hourly | Affects partner confirmation timing |

### Risk Engine Calc. / Auto Approval Changes

| Rule | Change | Comments |
|---|---|---|
| Auto-approval threshold | Threshold now per asset | AMTK-88 |

### Important version changes

| Component | Version | Impacted Functions |
|---|---|---|
| Node runtime | 22.1 | Internal tooling only |
| Settlement service | 3.4.0 | Collateral settlement and withdrawal processing |

### Core file changes

| File | Impacted Functions |
|---|---|
|  |  |

### 1.4 JIRA Versions & Artifacts

| Version | Type | Date |
|---|---|---|
| 9.99.0-alpha.1 | alpha | 2026-10-01 |
| 9.99.0-rc.1 | rc | 2026-10-08 |
| Release in PROD | prod | 2026-10-20 |

### 1.5 Major Highlights

| Workstream | Deliverable | Remarks for Ops | Remarks for Client |
|---|---|---|---|
| Staking | Batched unstake queue | Check partner confirmations after the change | |
| Wallet Tech | New wallet technology pilot | Scoped only | |
| Client UI | Portal refresh | | New look |
| Marketing | Website copy | | |

## 2. Deployment

### 2.2.1 This release specific instruction

- Columns renamed in the analytics.Account and analytics.[reports.WalletSummary] views.
- Restart the notification service after deployment.

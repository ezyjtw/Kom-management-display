# ADR-004: Scoring Model and Configuration Governance

**Status:** Accepted
**Date:** 2026-03-08
**Decision Makers:** Platform Team

## Context

The platform computes employee performance scores across five categories
(daily_tasks, projects, asset_actions, quality, knowledge). Scoring criteria
must evolve over time while maintaining audit trails and preventing unauthorized
changes. Different stakeholders need visibility into how scores are computed,
weighted, and compared across periods.

## Decision

### Score Computation

- 1–5 continuous scale per category, derived from `rawIndex` via `rawIndexToScore()`
- Configurable category weights in `ScoringConfig.config` JSON field
- Weighted average for overall score: `Σ(category_score × weight) / Σ(weights)`
- Clamped to 1.0–5.0 after rounding to one decimal place
- PTO adjustment: days worked / total work days, applied to throughput categories

### Configuration Lifecycle

```
draft → review → approved → active → archived
```

State machine enforced at the API level (`PUT /api/scores/config`) with
valid transitions defined in code. Each transition is logged as an audit event.

### Segregation of Duties

- **Creator** cannot be the **reviewer** (submit_review → review)
- **Reviewer** cannot be the **approver** (review → approved)
- **Approver** cannot be the **activator** (approved → active)
- Enforced in `PUT /api/scores/config` with `createdById`, `reviewedById`,
  `approvedById` checks

### Simulation and Backtesting

Before activation, new configs can be simulated against historical data:
- `scoringService.simulateConfig()` computes scores with draft config
- `scoringService.compareConfigs()` shows per-employee deltas
- Backtest results are returned to the reviewer for informed decisions

### One Active Config Invariant

Only one `ScoringConfig` can have `active = true` at any time.
Enforced at the application level during activation (deactivate all others first).
A database-level partial unique index provides defense in depth.

### Versioning

Each config has a unique `version` string. Creating a new config never
overwrites an existing one — it creates a new draft. Archived configs
remain queryable for historical comparison.

## Alternatives Considered

1. **Hard-coded weights:** Simpler but prevents operational tuning without
   code changes. JSON config with governance gives flexibility with control.
2. **Automatic score normalization:** Would obscure the scoring model from
   operators. The 1–5 scale is intentionally human-interpretable.
3. **Per-category separate governance:** Would complicate the workflow
   without proportional benefit. All weights are reviewed together.

## Consequences

- Score comparisons across config versions must note which weights applied.
- Simulation adds safety but requires maintaining backtest capability.
- The segregation requirement means at least 3 different users must be
  involved in any config change reaching production.

## Related

- `src/modules/scoring/services/scoring-service.ts` — Score computation
- `src/modules/scoring/repositories/score-repository.ts` — Score persistence
- `src/app/api/scores/config/route.ts` — Config workflow API
- `src/app/api/scoring-config/route.ts` — Config CRUD
- ADR-003 — Authorization matrix (scoring_config resource permissions)

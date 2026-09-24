# Alerting engine: enabling rules (Phase 6)

All rules in `src/modules/alerting/catalogue.ts` are synced into `AlertRule`
**disabled**. Enable them one by one in Admin → Alert Rules once thresholds are
confirmed. Alerts are informational only: approvals stay in Platform (H1).

## Before enabling a rule

1. Any parameter shown as `null` is a CONFIRM placeholder. The admin API refuses
   to enable the rule (422) until it is set.
2. The rule's ticket project (route `ticketProject`, else the
   `alerts.defaultTicketProject` setting) must be enabled in Admin → Jira
   Projects with a default issue type, or alerts cannot be acknowledged.
3. The owning team needs a lead (Employee role Lead) and an on-call rota
   (`OnCallSchedule`, shift `primary` and `backup`) for out-of-hours routing.

## Behaviour

- Evaluated every minute by the worker (`evaluate_alerts`); some rules declare a
  slower cadence.
- A condition missing for two consecutive runs auto-resolves the alert and adds
  "condition cleared at <time>" to the ticket. The ticket is never closed.
- The same alert never re-notifies within `alerting.quietMins` (15).
- Business hours (`alerting.businessHours`, Europe/London, excluding Global/EMEA
  public holidays): `alerts_out` channel, mentioning the team lead for high and
  critical. Out of hours: Slack DM and email to the on-call primary; critical
  alerts not acknowledged within `alerting.oohAckMins` (15) also go to the
  secondary and the lead.
- Escalation ladder: `params.escalation = [{afterMins, notifyRole}]` with roles
  `lead`, `admin`, `oncall_primary`, `oncall_secondary`.
- Medium-severity config rules (`ALR-CFG-02`, `ALR-RSK-05`) go to the 08:00
  digest instead of notifying immediately.

## Slack app scopes needed

`chat:write` (channel posts and DMs), `im:write`, `users:read.email`
(to find people by email for DMs and lead mentions).

## Open items

- partner bank rules have no evaluator yet: they need the partner bank register and mailbox parser
  (TASK-partner bank, Phase 7; CONFIRM-BANK-TEMPLATES).
- Risk rules read Platform signals. The Slack parser ships only after at least 10
  redacted real samples are in `src/__tests__/fixtures/platform-risk/`; until then
  every Platform post raises an "unparsed risk notification" (ALR-CFG-02).
- Settlement, portfolio and audit-log field names follow the stored API payloads
  and are marked TODO(CONFIRM-CUSTODY-OPENAPI).

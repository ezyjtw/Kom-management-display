# Client intake cut-over plan (spec §9)

Client questions from Slack, email and Teams become JSM requests. This plan
turns intake on without losing or duplicating questions.

## Before cut-over

1. **Choose the Slack route** (`intake.slack.route`): `kommand` or `jsm_native`.
   Never both. `jsm_native` needs the completed
   [verification record](./jsm-slack-verification.md).
2. **Configure** (Admin → Client Intake):
   - JSM service desk id and request type id for client questions;
   - the JSM "Organizations" field id, if requests should carry the organisation;
   - Komainu's Slack workspace id (`kommand` route);
   - the transition used for "not a question" closes;
   - review the P1 keyword list (spec §9.4) and the burst-merge window (default 120 s).
3. **Map clients** (Admin → Clients & Channels): JSM organisation id, Slack
   client channels, email domains, Teams channels, and any client Slack users
   who post from Komainu's workspace.
4. **Register Slack channels** with purpose `client` and the linked client.
5. For email: set Komainu's internal email domains, then enable email intake.
   For Teams: set Komainu's tenant id, then enable Teams intake.

## Cut-over

1. Enable the chosen route at a quiet time; watch the first few requests.
2. **Switch off the `:inbox_tray:` Slack-to-VSR skill** (the emoji-triggered
   workaround, spec §9.5) at the same time. Leaving it on creates duplicate
   tickets. Record who switched it off and when:
   - Switched off by: ____ on ____ (UTC).
3. Tell the team: every client question now has a JSM request; reply in the
   Slack thread as usual (the first reply is recorded as first response); use
   "Not a question" for thanks/emoji messages, with a reason.

## Rollback

Set `intake.slack.route = off` (and disable email/Teams intake). Existing
requests stay. Re-enable the `:inbox_tray:` skill only if intake stays off.

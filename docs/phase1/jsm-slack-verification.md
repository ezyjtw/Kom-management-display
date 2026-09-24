# JSM native Slack intake — verification record

**Purpose.** `intake.slack.route = jsm_native` lets JSM's own Slack integration
create client requests (spec §9.1). It may only be enabled after a person has
checked each item below against a **non-production** client channel and
recorded the evidence here. KOMmand Centre refuses to switch to `jsm_native`
until the verification record (who, when, link to this completed file) is
saved in Admin → Client Intake.

> Template only. To be completed by a human; not filled in by code.

| Field | Value |
|---|---|
| Completed by | |
| Date (UTC) | |
| JSM service desk / project | |
| Test Slack channel(s) | |
| Test client workspace (Slack Connect) | |

## Checklist

For each item: result (pass / fail), what was done, and evidence (screenshot
or ticket link). Do not paste client data.

1. **Slack Connect.** Works in Slack Connect channels shared with external client workspaces.
   - Result:
   - Evidence:
2. **Client details auto-populate.** The requester is mapped to the correct JSM organisation.
   - Result:
   - Evidence:
3. **Visibility.** Clients see only public responses, never internal comments.
   - Result:
   - Evidence:
4. **Thread replies.** Replies in the Slack thread update the same request.
   - Result:
   - Evidence:
5. **First response.** The first Komainu reply is recorded as the first response.
   - Result:
   - Evidence:
6. **Edge cases.** Several questions in one message; the client edits a message; the client deletes a message.
   - Result:
   - Evidence:

## Decision

- [ ] All six items pass: `jsm_native` may be enabled.
- [ ] One or more items fail: stay on `off` or `kommand`. Notes:

Sign-off (name, role, date):

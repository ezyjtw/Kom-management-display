# Slack app scopes

Spec §17.3: the Slack app requests only the scopes it uses. This list is derived from the Slack Web API methods the code calls. The test `slack-scopes-documented` fails if the code starts calling a method that is not listed here.

TODO(CONFIRM-SLACK-SCOPES): check this list against the installed app's manifest and Slack's method documentation at install time, then record the date and who checked it.

## Bot token scopes

| Scope | Why | Methods | Where in the code |
|---|---|---|---|
| `chat:write` | Post alerts, the morning handover, assignment notifications and client-incident notices. Posting to a user id delivers a direct message from the app. | `chat.postMessage`, `chat.postEphemeral` | `src/modules/alerting/routing.ts`, `src/modules/integrations/slack/alerts-out.ts`, `src/modules/morning/handover.ts`, `src/modules/notifications/on-assign.ts`, `src/modules/client-incidents/service.ts`, `src/lib/comms-dispatcher.ts`, `src/app/api/webhooks/slack/interactivity/route.ts` |
| `channels:history` | Poll the public channels the bot has been added to, every 5 minutes, 24/7 | `conversations.history`, `conversations.replies` | `src/modules/slack/services/slack-poller.ts`, `src/modules/slack/services/slack-ingestion-service.ts`, `src/lib/integrations/slack.ts` |
| `groups:history` | The same, for private channels the bot has been invited to | `conversations.history`, `conversations.replies` | as above |
| `channels:read`, `groups:read` | Channel name and metadata when a channel is registered | `conversations.info` | `src/lib/integrations/slack.ts` |
| `users:read`, `users:read.email` | Map a KOMmand user to their Slack id by work email, for mentions and direct messages | `users.lookupByEmail` | `src/modules/alerting/routing.ts`, `src/modules/morning/handover.ts`, `src/modules/notifications/on-assign.ts` |
| `commands` | The message shortcut "Raise incident or risk", which opens the KOMmand form | interactivity payloads | `src/app/api/webhooks/slack/interactivity/route.ts` |

`chat.getPermalink` (used for links back to the source message in `src/modules/client-incidents/resolve.ts` and `src/modules/intake/slack-intake-service.ts`) needs no scope beyond the channel access above (CONFIRM with the manifest check).

## Not requested

The app must not be granted any of the following:

- `chat:write.public`: the bot posts only in channels it has been added to.
- `im:history`, `mpim:history`, `im:read`, `mpim:read`: direct messages are not read.
- `channels:join`: the bot never adds itself to a channel; a person invites it.
- `files:read`, `files:write`, `reactions:*`, `pins:*`, `users:write` and any `admin.*` scope.

## Events API

The Events API push path is behind the feature flag `slack.events_push`, which is **off**. Polling is the primary path (spec §8.4). If the flag is enabled, subscribe to `message.channels` and `message.groups` only; they use the history scopes above. Inbound requests are verified with `SLACK_SIGNING_SECRET` (see `credentials.md`).

## Tokens

- The bot token (`SLACK_BOT_TOKEN`) and the signing secret (`SLACK_SIGNING_SECRET`) are mounted secrets.
- There is no user token.
- There is no workspace-level installation beyond the bot.

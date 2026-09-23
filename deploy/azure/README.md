# Azure runtime — for IT review

This describes the runtime KOMmand Centre expects in production. It is a
description for review, not infrastructure code.

## Components

| Component | What it runs | Notes |
|---|---|---|
| **web** container | The Docker image, default command (`sh start.sh`) | Next.js on port 3000. Runs database migrations on start. Never seeds. |
| **worker** container | The same image, command `npm run worker:prod` | Always-on job worker. Single replica is enough; more replicas are safe (jobs are claimed atomically). Needs a stop grace period of at least 30 s. |
| **PostgreSQL** | Azure Database for PostgreSQL (Flexible Server) | Shared by web and worker. Private access only. Daily backups, 30-day retention. |
| **Key Vault** | All secrets | Exposed to both containers as environment variables (e.g. Key Vault references). No secrets in the image or repo (H7). |

## Secrets held in Key Vault

`DATABASE_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_SECRET`, `AZURE_AD_CLIENT_SECRET`,
`KOMAINU_API_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, Atlassian API
token, SMTP/IMAP passwords.

Non-secret configuration (`AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_ID`,
`ROLE_GROUP_MAP`, `KOMAINU_API_BASE_URL`, `ATLASSIAN_BASE_URL`, …) can be plain
app settings. See `docs/deployment.md` for the full list.

## Identity

- Entra ID app registration with a client secret, redirect URI
  `https://<web-host>/api/auth/callback/azure-ad`, and the **groups** claim
  (security group object IDs) in the ID token.
- Security groups mapped to roles via `ROLE_GROUP_MAP`. Users outside mapped
  groups, or without an `Employee` record, are refused and audit-logged.
- Local username/password login cannot be enabled in production.

## Networking

- Web and worker containers in a private VNet; PostgreSQL and Key Vault reached
  through private endpoints.
- Web exposed only through the corporate ingress (e.g. Application Gateway / Front Door with WAF).
- **Egress allowlist** at the network layer (e.g. Azure Firewall), matching the
  application-level allowlist in `src/lib/http/allowed-hosts.ts`:
  - the Komainu API host (`KOMAINU_API_BASE_URL`);
  - `komainu.atlassian.net` and `api.atlassian.com`;
  - `slack.com` (and the Slack API endpoints under it);
  - `graph.microsoft.com`, `login.microsoftonline.com`;
  - SMTP/IMAP relay hosts, if email integration is used.
  Nothing else. Optional modules (AI, market ticker, Notabene) are off by
  default and would each need an explicit change request to open their hosts.

## Health and monitoring

- Liveness: `GET /api/health/liveness`. Readiness: `GET /api/health/readiness`.
- `GET /api/health` returns `"worker_alive": false` when no worker heartbeat has
  been seen for 2 minutes. Alert on that from outside the app.
- Logs are structured JSON on stdout for both containers.

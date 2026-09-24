# Credentials register

This register covers spec §17.3. Each credential has a named owner and a rotation cadence. For each one it records what it is, where it lives, how to rotate it, and the blast radius if it leaks.

**Owners:** TODO(CONFIRM-CREDENTIAL-OWNERS). Every row needs a named owner before a production credential is issued. The review route in `threat-model.md` §9 ends with that sign-off.

## Where credentials live

- **Production.** Third-party and signing secrets sit in Azure Key Vault. They are mounted as **files on an in-memory tmpfs volume**, one file per key, in `SECRETS_DIR` (default `/mnt/secrets`). They are read once at startup into the validated config (`src/lib/secrets.ts`, `src/lib/env.ts`) and never copied into `process.env`. Do not create Kubernetes `Secret` objects, and do not inject secrets as environment variables. If a secret-bearing environment variable is present, the app refuses to start (it returns 500 on every request and logs the key name, never the value). Test: `no-secrets-in-env-in-production`.
- **Azure services** (database, Key Vault, storage) use a **user-assigned managed identity per workload** (web and worker separately), not secrets. `DATABASE_URL` holds no password in production (TODO(CONFIRM-DB-IDENTITY)), so it stays an ordinary environment variable, which Prisma and the migration step need.
- **Demo tier** (`KOM_ENVIRONMENT=demo`, e.g. Railway): secrets may be environment variables, because a hosted demo cannot mount Key Vault files. A demo holds only demo credentials, never live ones (`go-live.md`).
- **Development.** Leave `SECRETS_DIR` unset and use `.env`, which is in `.gitignore`. `.env.example` holds placeholders only, never a real endpoint (H9).
- **Detection.** `detect-secrets` runs in CI against a reviewed `.secrets.baseline`, and a new finding fails the build.

## Register

"Default rotation" means at least annually, and immediately on suspected leak.

| Key | What it is | Owner | Rotation | How to rotate | Blast radius if leaked |
|---|---|---|---|---|---|
| `NEXTAUTH_SECRET` | Signs and encrypts session JWTs and the NextAuth CSRF token | TODO | Annually, and on leak | Write the new value to Key Vault and restart web and worker. All sessions end, and users sign in again. | Session forgery for any user and role until rotated. **Critical.** |
| `CRON_SECRET` | Bearer token for the external cron trigger `/api/alerts/generate` | TODO | Annually | Update Key Vault and the scheduler together | Can trigger alert evaluation, which is idempotent. No data access. Low. |
| `ENCRYPTION_SECRET` | Key for field encryption at rest (AES-256-GCM, `src/lib/encryption.ts`) | TODO | Annually, with re-encryption | Needs a re-encryption job: decrypt with the old key, encrypt with the new. Plan before rotating. | Decrypts the encrypted fields if the database is also obtained. High. |
| `AZURE_AD_CLIENT_SECRET` | Entra app registration secret for SSO | TODO | Per the Entra policy (at most 12 months); prefer a certificate or federated credential | Add the new secret in Entra, update Key Vault, restart, then delete the old one | Impersonates the app to Entra in the OAuth flow; cannot sign users in without their credentials. Medium. |
| `ATLASSIAN_API_TOKEN` (with `ATLASSIAN_EMAIL`) | Jira and JSM service account, **project-scoped, no admin** (§8.3 projects only) | TODO | Annually | Create a new token for the service account, update Key Vault, restart, revoke the old token in id.atlassian.com | Read and write on the scoped Jira/JSM projects, **including client-visible JSM content**. High. ALR-SEC-05 fires on repeated 401/403. |
| `CONFLUENCE_API_TOKEN` (with `CONFLUENCE_EMAIL`) | Confluence read access for Platform release notes | TODO | Annually | As for Atlassian | Read access to the permitted spaces. Medium. |
| `SLACK_BOT_TOKEN` | Slack app bot token (`xoxb-`), with scopes in `slack-scopes.md` | TODO | Annually, and on leak | Reinstall or rotate in the Slack app admin, update Key Vault, restart | Reads the channels the bot is in; posts as the bot. High (channel history). |
| `SLACK_SIGNING_SECRET` | Verifies inbound Slack requests (events, interactivity) | TODO | Annually | Regenerate in the Slack app, update Key Vault, restart | Forged inbound Slack events; parsed as data only. Medium. |
| `JIRA_WEBHOOK_SECRET` | Verifies inbound Jira webhooks | TODO | Annually | Update the Jira webhook and Key Vault together | Forged ticket events; the effects are recorded and reconciled against Jira. Medium. |
| `GRAPH_CLIENT_SECRET` (with `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`) | Microsoft Graph app for the shared mailboxes and Teams. **Restricted to the named mailboxes by an Exchange application access policy.** | TODO | Per the Entra policy; prefer a certificate | As for the Entra secret | Reads and sends as the permitted mailboxes. High. |
| `SMTP_PASSWORD` | Outbound SMTP for notifications | TODO | Annually | Update the mail relay and Key Vault | Sends mail as the relay account. Medium. |
| `CUSTODY_API_SECRET`, `CUSTODY_API_SECRET_<SUFFIX>` | custody API user secret(s), **read-only** on the custody-provider side (H2). One per workspace user (`CUSTODY_API_CREDENTIALS[].secretRef`, CONFIRM-API-SCOPE) | TODO | Annually, and on leak | Rotate in the custody provider, update Key Vault, restart the worker | Reads custody data for the workspace. **Cannot move funds.** Every use is audited (`integration_credential_used`, with label and workload). High (confidentiality). |
| `FIREBLOCKS_API_KEY`, `FIREBLOCKS_API_SECRET` | Not used in Phase 1 | n/a | n/a | Do not issue | n/a |
| `NOTABENE_API_TOKEN` | Notabene. Disabled (H11); do not issue | n/a | n/a | Do not issue | n/a |
| `GROQ_API_KEY`, `ANTHROPIC_API_KEY` | AI providers. AI is off (H3); do not issue | n/a | n/a | Do not issue | n/a |
| `SEED_ADMIN_PASSWORD`, `SEED_USER_PASSWORD`, `SEED_LEAD_PASSWORD` | Development seed only. Never set in production (no local login there) | n/a | n/a | Do not issue in production | n/a |

## Secret leak procedure: revoke first

This follows the platform's Secret Leak Actions:

1. **Revoke** the credential at the provider **first** (Atlassian, Slack, Entra, the custody provider or the mail relay). Do not wait for the redeploy.
2. **Replace** it: issue a new credential, write it to Key Vault, and restart the affected workloads.
3. **Remove** every copy: rewrite git history if it was committed, and purge logs and tickets.
4. **Remediate and review:**
   - Check `AuditLog` for `integration_credential_used` and `integration_auth_failure`, and check ALR-SEC-05, for the exposure window.
   - Check the provider's own audit log.
   - Record the incident.

## Privileged access

- The KOMmand `admin` role comes from a PIM-eligible Entra group with approval and time-bound activation (TODO(CONFIRM-PIM-GROUP)). There is no standing admin.
- Break-glass follows the existing IT and Security application-admin pattern. There is no local password. Any production sign-in not through Entra raises ALR-SEC-04. See `threat-model.md` §5.
- Database roles are in `db-roles.sql`: the application role cannot update or delete audit evidence (TODO(CONFIRM-DB-ROLES)).

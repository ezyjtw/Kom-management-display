# Demo now, live later

KOMmand Centre runs in one of three **deployment tiers** (`KOM_ENVIRONMENT`, `src/lib/deployment-tier.ts`). The tier is separate from `NODE_ENV`, because the production build runs in both the demo and the live service.

| | `demo` | `production` |
|---|---|---|
| Purpose | Show the product on synthetic data (e.g. Railway) | The live service (Azure, or Railway since 2026-09-25) |
| Secrets | Environment variables allowed | Azure: files in `SECRETS_DIR` only (Key Vault on tmpfs); an environment-variable secret stops startup. Railway: Railway variables |
| Sign-in | Local username/password if `ALLOW_LOCAL_LOGIN=true`; Entra if configured | Entra ID only; any other sign-in raises ALR-SEC-04 |
| Data | Seeded with synthetic data if `ALLOW_SEED=true`; the database is marked as demo | Never seeded; **refuses to start on a database marked as demo** |
| Banner | "DEMO environment: synthetic data only" on every page | None |
| APIs | Mocks or `custody-demo.example.com` only; never live systems (H9) | The live, read-only integrations |

A production build is the production tier unless `KOM_ENVIRONMENT=demo` is set. The tier can only be relaxed by naming the demo tier, never by leaving something out.

## Running the demo (Railway)

The existing Railway service is the demo. The app detects Railway from the variables Railway injects (`RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_SERVICE_ID`), and with `KOM_ENVIRONMENT` unset it runs as the **demo tier** (Phase 12o). So the demo needs no tier variable.

Set these service variables:

```
NEXTAUTH_URL=https://<railway-host>
NEXTAUTH_SECRET=<random, 32+ characters>
DATABASE_URL=<the Railway Postgres URL>
ALLOW_SEED=true
SEED_ADMIN_PASSWORD=<strong, demo only>
SEED_USER_PASSWORD=<strong, demo only>
SEED_LEAD_PASSWORD=<strong, demo only>
```

- **Local login:** on by default on the Railway demo (there is no SSO there). Set `ALLOW_LOCAL_LOGIN=false` to turn it off.
- **Overrides:** `KOM_ENVIRONMENT=demo` also works. `KOM_ENVIRONMENT=production` makes the service strict (and it will refuse to start with environment-variable secrets, as intended).
- **Health check path:** `/api/health` (public; `/api/health/liveness` also works).
- **Service name:** rename the Railway service from `production` to `demo`, so nobody mistakes it for the live system.
- **Integration variables:** leave them unset, or point them at mocks or `custody-demo.example.com`. Never set live credentials on the demo.
- **What you'll see:** on start, the logs show `Deployment tier: demo (Railway detected, KOM_ENVIRONMENT unset)` and the seed runs. Sign in with the seeded accounts.

**Upgrading a demo database from before the Phase 12l baseline.** The migration history was consolidated into `0001_baseline`, so a demo database built with the old history cannot take it. On the demo tier, `start.sh` runs `prisma/demo-legacy-reset.cjs` first: if the database has the old history and carries the demo-data marker, it drops and recreates the schema, then migrates and reseeds the same synthetic data. A demo database seeded before the marker existed is refused with a message; set `KOM_DEMO_RESET_LEGACY=true` once, deploy, then remove it. On Railway this opt-in is implied (set `KOM_DEMO_RESET_LEGACY=false` to refuse instead). The script never acts outside the demo tier.

There is no Railway configuration in the repository; the settings above live in the Railway dashboard. Railway may also host production (see below).

## Production on Railway

The owner removed hard constraint H10 on 2026-09-25: Railway may host the production tier. Differences from the Azure path:

- **Tier:** set `KOM_ENVIRONMENT=production` on the service. It always wins over the Railway demo default.
- **Secrets:** Railway variables (Railway cannot mount Key Vault files). Mark each secret as a sealed variable in the dashboard so it cannot be read back. Setting `SECRETS_DIR` still switches to files.
- **Database:** a **new** Railway Postgres, not the demo one. Production refuses a database carrying the demo marker. `DATABASE_URL` carries a password (no managed identity on Railway, CONFIRM-DB-IDENTITY), and `db-roles.sql` can still be applied.
- **Worker:** a second Railway service from the same repository, with start command `node worker.js` and `KOM_WORKLOAD=worker`. Without it nothing polls and ALR-HB-WORKER fires.
- **Sign-in:** Entra SSO only (`AZURE_AD_*`, `ROLE_GROUP_MAP`). Local login stays off in production, on Railway too.
- **Network:** Railway has no private endpoints or Azure egress controls. The app-level egress allowlist (`src/lib/http/allowed-hosts.ts`) still applies. Record the accepted difference in the threat model's exceptions.
- **Go-live check:** run it inside the service (`railway run npm run go-live:check`) so the Railway variables are present. It accepts Railway variables as the secret source there and checks everything else as for Azure.

## Going live

Going live means **a fresh database**, not cleaning the demo one. The demo database holds synthetic users, employees and work, and its audit log is append-only by design (triggers and database role). Deleting the fake data would need exactly the privileges the audit controls exist to deny. So the demo database is retired, not promoted, and startup enforces this: a production-tier start refuses a database carrying the demo marker.

1. **Provision** the production runtime (`deploy/azure/README.md`, or Railway as above):
   - web and worker containers;
   - a **new** Azure Database for PostgreSQL;
   - Key Vault secrets mounted as files;
   - managed identities;
   - private networking and the egress allowlist.
2. **Apply the database roles** (`db-roles.sql`) after the first migration.
3. **Connect every integration** with its live, read-only credential (`credentials.md`):
   - custody API;
   - Jira and JSM;
   - Confluence;
   - Slack;
   - Microsoft Graph;
   - the Jira webhook.
4. **Resolve the CONFIRM items** that gate the features you are switching on (`confirm-register.md`).
5. **Run the go-live check** against the new environment and database:

   ```
   KOM_ENVIRONMENT=production NODE_ENV=production SECRETS_DIR=/mnt/secrets \
     DATABASE_URL=<production> ... npm run go-live:check
   ```

   It exits 1 if any of these is not met:
   - the tier is production;
   - secrets are read from files, with none in the environment;
   - Entra and `ROLE_GROUP_MAP` are set;
   - there is no local login and no seeding;
   - `NEXTAUTH_URL` is https;
   - every integration is connected, and the custody provider is not the demo host;
   - AI is off;
   - all migrations are applied;
   - the database has no demo marker and no seeded identities;
   - the safety flags are off and the other flags are at their reviewed defaults.

6. **Security review route** (`threat-model.md` §9). Sign-off comes before any production credential is issued.
7. **Switch traffic** to the production tier. The startup log shows `Deployment tier: production`.
8. **Retire the demo:** remove the Railway demo service and its database, or keep it clearly labelled as a demo, disconnected from live systems. If production is also on Railway, keep them in separate Railway environments or projects.

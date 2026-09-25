# Legacy deployment notes

An early demo used Railway. Its `railway.toml` was removed in Phase 12 and is in the git history if ever needed. Railway settings live in the Railway dashboard.

Railway hosts the **demo tier** (synthetic data, a DEMO banner, no live systems). Since 2026-09-25 the owner also permits Railway as the **production** host (hard constraint H10 removed): set `KOM_ENVIRONMENT=production` on a separate service with its own database. See `docs/phase1/go-live.md`.

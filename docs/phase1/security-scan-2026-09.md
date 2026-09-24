# Security scan, Phase 12 (2026-09-24)

This was a local scan of branch `claude/phase-12-security-hardening-zurOJ`. The CI scanners added in Phase 12c had not run yet, because the workflow runs on pull requests to `main`. This scan stands in for them until the branch has a pull request.

**CodeQL could not be run here.** Its first results will come from the `CodeQL` workflow.

## Tools

| Tool | Version | Scope |
|---|---|---|
| Semgrep (open-source rules, `semgrep/semgrep-rules` at HEAD) | 1.178.0 | `javascript`, `typescript`, `dockerfile`, `yaml/github-actions` and `generic/secrets` rules over `src` (excluding tests), `scripts`, `.github`, both Dockerfiles and `next.config.js`: 475 rules, 495 files |
| Trivy | 0.74.0 | `fs` scan of vulnerabilities, secrets and misconfigurations (high and critical) |
| npm audit | npm 10.9.7 | production dependencies |
| detect-secrets | 1.5.0 | the whole repository against `.secrets.baseline` |

## Findings and disposition

| # | Tool / rule | Where | Assessment | Action |
|---|---|---|---|---|
| 1 | Semgrep `html-in-template-string` | `src/lib/pdf-report.ts` (incident, weekly, compliance and digest reports) | **Real (medium).** Incident titles, descriptions and updates, and comms thread subjects, were interpolated into report HTML unescaped. Thread subjects come from external Slack and email, so this was stored HTML injection into reports. Inside the app the nonce CSP stops scripts, but not markup (fake links), and a downloaded report has no CSP at all. | Every value is escaped with a shared `escapeHtml` (`src/lib/html-escape.ts`), including the title and author. Test: `security-scan-fixes`. |
| 2 | Semgrep `detect-non-literal-regexp` | GX impact rules (`gx-sprints/mapping.ts`), ALR-CFG-01 event patterns (`alerting/evaluators/operations.ts`), import filename patterns | **Real (low to medium).** Admin-authored regexes ran against external text (Confluence release notes, Komainu audit events). A catastrophic pattern could stall the worker (ReDoS). | `src/lib/safe-regex.ts`: patterns with nested quantifiers or backreferences are refused when saved and ignored when run, and the text tested is capped at 20k characters. Test: `security-scan-fixes`. |
| 3 | Semgrep `unsafe-dynamic-method` | `/api/metrics/[section]`, daily-check collectors | **Real (low).** The lookup used `in` or plain indexing, so inherited names such as `constructor` passed as a section. That meant unexpected behaviour, not code execution. | Own-key checks (`Object.hasOwn`). A request for `/api/metrics/constructor` now answers 404. Test: `security-scan-fixes`. The job dispatcher already used an own-key check. |
| 4 | Semgrep `gcm-no-tag-length` | `src/lib/encryption.ts` decrypt | **Hardening.** Not exploitable as written: the tag is always a fixed 16-byte slice. | `authTagLength` is pinned in `createDecipheriv`. Tampered tags are rejected (test). |
| 5 | Semgrep `detect-redos` | `src/lib/sanitize.ts` email pattern | **Low.** Standard email pattern; the input length was checked after the regex. | Length is checked first (255 characters). |
| 6 | Trivy CVE-2026-45623, CVE-2026-73646 (and the matching GHSA advisories in `npm audit`) | `postcss` 8.4.31, bundled in `next@15.5.26` | **Real (high).** Previously accepted as exceptions until a Next 16 upgrade. The code only reaches it at build time. | Fixed without a major upgrade: `overrides.next.postcss = $postcss` (8.5.28). `npm audit`: **0 vulnerabilities**. The postcss exceptions were removed from `.audit-exceptions.json`. |
| 7 | Trivy DS-0002 | `Dockerfile.dev` | **Low.** The dev image ran as root; the production image already runs as uid 1001. | The dev image now runs as `node`, using `npm ci`. |
| 8 | Semgrep `missing-image-version` | `Dockerfile` | False positive: the image comes from `ARG NODE_IMAGE=node:22-alpine@sha256:…`, pinned by digest. | None. |
| 9 | Semgrep `path-join-resolve-traversal`, `detect-non-literal-fs-filename` | `src/lib/secrets.ts` | False positive: only file names matching the fixed secret-key allowlist are read, from the configured directory. | None. |
| 10 | Semgrep `html-in-template-string` | `travel-rule-email.ts`, `metrics/export.ts` | Already escaped. One enum fallback (`direction`) was not; it is now escaped too. | Done. |
| 11 | Semgrep `no-stringify-keys`, `javascript-prompt`/`alert`/`confirm`, `react-props-spreading`, `jsx-not-internationalized` and others | UI and AI modules | Code quality or i18n, not security. The AI modules are off (H3). | None. |
| 12 | detect-secrets | whole repository | No new findings beyond the reviewed baseline (all placeholders or test values). | None. |

After the fixes, Semgrep still reports the pattern-level rules (items 1, 3 and 5), because it cannot see the escaping or own-key guards. Each of those sites was reviewed and is covered by `security-scan-fixes`.

## Still to run

- **CodeQL** (`security-extended`): first run on the pull request.
- **The container image scan:** Trivy in CI now, Wiz once connected (TODO(CONFIRM-WIZ-CI)). The image can't be built in this environment, because the Alpine package mirror is blocked.
- **The application penetration test** (`threat-model.md` §9).

# Jira inventory (Phase 1, spec §15)

**Not generated yet.** This file is written by `scripts/jira-inventory.ts`, a read-only script that needs a Jira account with read access to the projects in spec §8.3. It has not been run against the custody provider's Jira from this environment.

To generate it:

```bash
ATLASSIAN_BASE_URL=https://<site>.atlassian.net ATLASSIAN_EMAIL=<read-only service account> ATLASSIAN_API_TOKEN=<token> \
DATABASE_URL=<KOMmand Centre database, optional> \
npm run jira:inventory -- [--projects OTC,OPS] [--users a@example.com,b@example.com]
```

- **Projects:** the §8.3 list plus any `JiraProjectConfig` keys. Override with `--projects`.
- **Team users (for "filters owned by Transaction Operations users"):** active Transaction Operations employees from the database. Override with `--users`.
- **Consolidation proposals:** read from `docs/phase1/jira-consolidation.json`. That file is empty until the list is agreed (TODO(CONFIRM-JIRA-CONSOLIDATION)). Re-run the script once it's filled in, to list the saved filters and dashboards that would break.
- **Automation rules:** not read. The Automation API is separate and its format isn't confirmed (TODO(CONFIRM-JIRA-AUTOMATION-API)).

The script only makes GET requests, plus the read-only JQL search. It cannot change Jira configuration: its client has its own allowlist, and `src/__tests__/jira-inventory.test.ts` checks that. It refuses to run without credentials, and it won't overwrite this file when no project could be read. Review the output for client names in filter or board names before committing it.

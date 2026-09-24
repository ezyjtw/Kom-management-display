/**
 * Jira inventory collection (spec §15). Read-only: every call goes through
 * the inventory client's GET allowlist. Anything that cannot be read (no
 * permission, not found) is recorded as "not readable" rather than failing
 * the whole run.
 */

import { inventoryRequest, paged } from "@/modules/jira-inventory/client";
import { issueTypesInJql, projectsInJql } from "@/modules/jira-inventory/jql";

export interface Readable<T> {
  ok: boolean;
  value: T;
  note?: string;
}

export interface ProjectInventory {
  key: string;
  name: string | null;
  found: boolean;
  boards: Readable<Array<{ id: number; name: string; type: string }>>;
  issueTypes: Readable<Array<{ id: string; name: string; subtask: boolean }>>;
  workflows: Readable<Array<{ scheme: string; defaultWorkflow: string | null; byIssueType: Record<string, string> }>>;
  openCounts: Readable<{ byTypeAndStatus: Record<string, Record<string, number>>; total: number; truncated: boolean }>;
  lastCreated: Readable<string | null>;
  automation: Readable<null>;
}

export interface FilterInfo {
  id: string;
  name: string;
  owner: string | null;
  jql: string;
  projects: string[];
  issueTypes: string[];
}

export interface DashboardInfo {
  id: string;
  name: string;
  filterIds: string[];
}

export interface Inventory {
  generatedAt: string;
  projects: ProjectInventory[];
  filters: Readable<FilterInfo[]>;
  dashboards: Readable<DashboardInfo[]>;
  teamUsers: { requested: number; resolved: number; unresolved: number };
}

export interface CollectOptions {
  projects: string[];
  /** Transaction Operations team emails; their filters are listed. */
  teamEmails: string[];
  /** Max JQL pages (100 issues each) per project for open counts. */
  maxIssuePages?: number;
  now?: Date;
}

const why = (error: unknown) => {
  const status = (error as { status?: number }).status;
  return status === 401 || status === 403 ? "not readable with the configured account (permission)" : status === 404 ? "not found" : `not readable (${error instanceof Error ? error.message : String(error)})`;
};

async function readable<T>(fallback: T, fn: () => Promise<T>): Promise<Readable<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, value: fallback, note: why(error) };
  }
}

interface JiraProject {
  id: string;
  key: string;
  name: string;
  issueTypes?: Array<{ id: string; name: string; subtask?: boolean }>;
}

async function collectProject(key: string, maxIssuePages: number): Promise<ProjectInventory> {
  let project: JiraProject | null = null;
  let projectNote: string | undefined;
  try {
    project = await inventoryRequest<JiraProject>("GET", `/rest/api/3/project/${key}`);
  } catch (error) {
    projectNote = why(error);
  }
  const missing = <T>(v: T): Readable<T> => ({ ok: false, value: v, note: projectNote });
  if (!project) {
    return {
      key, name: null, found: false,
      boards: missing([]), issueTypes: missing([]), workflows: missing([]),
      openCounts: missing({ byTypeAndStatus: {}, total: 0, truncated: false }), lastCreated: missing(null),
      automation: { ok: false, value: null, note: "not read: TODO(CONFIRM-JIRA-AUTOMATION-API)" },
    };
  }
  const typeName = new Map((project.issueTypes ?? []).map((t) => [t.id, t.name]));

  const boards = await readable([] as Array<{ id: number; name: string; type: string }>, async () =>
    (await paged<{ id: number; name: string; type: string }>("/rest/agile/1.0/board", { projectKeyOrId: key })).map((b) => ({ id: b.id, name: b.name, type: b.type })));

  const workflows = await readable([] as ProjectInventory["workflows"]["value"], async () => {
    const res = await inventoryRequest<{ values?: Array<{ workflowScheme?: { name?: string; defaultWorkflow?: string; issueTypeMappings?: Record<string, string> } }> }>(
      "GET", "/rest/api/3/workflowscheme/project", { query: { projectId: project!.id } },
    );
    return (res.values ?? []).map((v) => ({
      scheme: v.workflowScheme?.name ?? "(unnamed scheme)",
      defaultWorkflow: v.workflowScheme?.defaultWorkflow ?? null,
      byIssueType: Object.fromEntries(Object.entries(v.workflowScheme?.issueTypeMappings ?? {}).map(([typeId, wf]) => [typeName.get(typeId) ?? typeId, wf])),
    }));
  });

  const openCounts = await readable({ byTypeAndStatus: {}, total: 0, truncated: false } as ProjectInventory["openCounts"]["value"], async () => {
    const byTypeAndStatus: Record<string, Record<string, number>> = {};
    let total = 0;
    let token: string | undefined;
    let truncated = false;
    for (let page = 0; ; page++) {
      if (page >= maxIssuePages) {
        truncated = true;
        break;
      }
      const res = await inventoryRequest<{ issues?: Array<{ fields: { issuetype?: { name: string }; status?: { name: string } } }>; nextPageToken?: string; isLast?: boolean }>(
        "POST", "/rest/api/3/search/jql",
        { body: { jql: `project = "${key}" AND statusCategory != Done`, fields: ["issuetype", "status"], maxResults: 100, ...(token ? { nextPageToken: token } : {}) } },
      );
      for (const i of res.issues ?? []) {
        const t = i.fields.issuetype?.name ?? "(none)";
        const s = i.fields.status?.name ?? "(none)";
        byTypeAndStatus[t] ??= {};
        byTypeAndStatus[t][s] = (byTypeAndStatus[t][s] ?? 0) + 1;
        total++;
      }
      if (res.isLast !== false || !res.nextPageToken) break;
      token = res.nextPageToken;
    }
    return { byTypeAndStatus, total, truncated };
  });

  const lastCreated = await readable(null as string | null, async () => {
    const res = await inventoryRequest<{ issues?: Array<{ fields: { created?: string } }> }>(
      "POST", "/rest/api/3/search/jql", { body: { jql: `project = "${key}" ORDER BY created DESC`, fields: ["created"], maxResults: 1 } },
    );
    return res.issues?.[0]?.fields.created ?? null;
  });

  return {
    key,
    name: project.name,
    found: true,
    boards,
    issueTypes: { ok: true, value: (project.issueTypes ?? []).map((t) => ({ id: t.id, name: t.name, subtask: !!t.subtask })) },
    workflows,
    openCounts,
    lastCreated,
    // Automation rules live behind a separate Atlassian API; its format is not confirmed, so it is not called.
    automation: { ok: false, value: null, note: "not read: TODO(CONFIRM-JIRA-AUTOMATION-API)" },
  };
}

async function accountIdFor(email: string): Promise<string | null> {
  const users = await inventoryRequest<Array<{ accountId: string; emailAddress?: string }>>("GET", "/rest/api/3/user/search", { query: { query: email } });
  const exact = (users ?? []).filter((u) => u.emailAddress?.toLowerCase() === email.toLowerCase());
  return exact.length === 1 ? exact[0].accountId : null;
}

/** Filter ids referenced by a gadget's configuration (e.g. "filterId": "filter-10001"). */
export function filterIdsIn(value: unknown): string[] {
  const text = JSON.stringify(value ?? "");
  const ids = new Set<string>();
  for (const m of text.matchAll(/filter-(\d+)/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\\?"filterId\\?"\s*:\s*\\?"?(\d+)/g)) ids.add(m[1]);
  return [...ids];
}

export async function collectInventory(opts: CollectOptions): Promise<Inventory> {
  const now = opts.now ?? new Date();
  const projects: ProjectInventory[] = [];
  for (const key of opts.projects) projects.push(await collectProject(key, opts.maxIssuePages ?? 50));

  let resolved = 0;
  const filters = await readable([] as FilterInfo[], async () => {
    const byId = new Map<string, FilterInfo>();
    for (const email of opts.teamEmails) {
      const accountId = await accountIdFor(email).catch(() => null);
      if (!accountId) continue;
      resolved++;
      const rows = await paged<{ id: string; name: string; jql?: string; owner?: { displayName?: string } }>("/rest/api/3/filter/search", { accountId, expand: "jql,owner" });
      for (const f of rows) {
        const jql = f.jql ?? "";
        byId.set(String(f.id), { id: String(f.id), name: f.name, owner: f.owner?.displayName ?? null, jql, projects: projectsInJql(jql), issueTypes: issueTypesInJql(jql) });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  const dashboards = await readable([] as DashboardInfo[], async () => {
    const rows = await paged<{ id: string; name: string }>("/rest/api/3/dashboard/search", {});
    const out: DashboardInfo[] = [];
    for (const d of rows) {
      const filterIds = new Set<string>();
      try {
        const { gadgets } = await inventoryRequest<{ gadgets?: Array<{ id: number }> }>("GET", `/rest/api/3/dashboard/${d.id}/gadget`);
        for (const g of gadgets ?? []) {
          const { keys } = await inventoryRequest<{ keys?: Array<{ key: string }> }>("GET", `/rest/api/3/dashboard/${d.id}/items/${g.id}/properties`);
          for (const k of keys ?? []) {
            if (!/^[A-Za-z0-9._-]+$/.test(k.key)) continue;
            const prop = await inventoryRequest<{ value?: unknown }>("GET", `/rest/api/3/dashboard/${d.id}/items/${g.id}/properties/${k.key}`);
            for (const id of filterIdsIn(prop.value)) filterIds.add(id);
          }
        }
      } catch {
        // a dashboard we cannot read in full is still listed, without filter references
      }
      out.push({ id: String(d.id), name: d.name, filterIds: [...filterIds] });
    }
    return out;
  });

  return {
    generatedAt: now.toISOString(),
    projects,
    filters,
    dashboards,
    teamUsers: { requested: opts.teamEmails.length, resolved, unresolved: opts.teamEmails.length - resolved },
  };
}

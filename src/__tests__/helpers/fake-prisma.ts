/**
 * Minimal in-memory Prisma stand-in for engine tests. Supports the query
 * features the alerting code uses: equality, in/notIn, gt/gte/lt/lte, not,
 * startsWith, contains, OR/AND/NOT, to-one relation filters, include (to-one
 * and to-many), orderBy (single field), take, compound uniques, increment.
 * Not a general Prisma emulator.
 */

import { Prisma } from "@prisma/client";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

let seq = 0;
const cuid = () => `id${(++seq).toString(36).padStart(6, "0")}`;

interface Relation {
  model: string;
  /** to-one: local foreign key -> remote pk; to-many: remote foreign key -> local pk */
  kind: "one" | "many";
  localKey: string;
  remoteKey: string;
}

const PK: Record<string, string> = {
  alertRule: "code", appSetting: "key", assetThreshold: "asset", riskRuleTier: "rule", sourceHeartbeat: "source",
  jiraProjectConfig: "key", dailyCheckDefinition: "code", featureFlag: "key", teamConfig: "team", assetStatus: "asset",
  otcBreakType: "code", userNotificationPreference: "userId", incidentCategory: "code", syncCursor: "source",
};

const COMPOUND: Record<string, Record<string, string[]>> = {
  sourceRecord: { source_kind_externalId: ["source", "kind", "externalId"] },
  workItem: { sourceSystem_sourceId: ["sourceSystem", "sourceId"] },
  dailyCheckItem: { definitionCode_periodKey: ["definitionCode", "periodKey"] },
  commsThread: { slackChannelId_slackRootTs: ["slackChannelId", "slackRootTs"] },
  commsMessage: { threadId_slackTs: ["threadId", "slackTs"] },
  jiraIssueEvent: { system_key_updated: ["system", "key", "updated"] },
  ticketLink: { system_key_workItemId: ["system", "key", "workItemId"] },
  approvedValidator: { chain_validator: ["chain", "validator"] },
  leadHandover: { date_team: ["date", "team"] },
};

/** Single-field unique constraints besides the primary key. */
const UNIQUE: Record<string, string[]> = {
  fabInstruction: ["reference"],
  employee: ["email"],
};

const uniqueError = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "fake" });

const RELATIONS: Record<string, Record<string, Relation>> = {
  alert: { workItem: { model: "workItem", kind: "one", localKey: "workItemId", remoteKey: "id" } },
  workItem: {
    slaPolicy: { model: "slaPolicy", kind: "one", localKey: "slaPolicyId", remoteKey: "id" },
    ticketLinks: { model: "ticketLink", kind: "many", localKey: "id", remoteKey: "workItemId" },
    client: { model: "client", kind: "one", localKey: "clientId", remoteKey: "id" },
    owner: { model: "employee", kind: "one", localKey: "ownerEmployeeId", remoteKey: "id" },
    alerts: { model: "alert", kind: "many", localKey: "id", remoteKey: "workItemId" },
  },
  onCallSchedule: { employee: { model: "employee", kind: "one", localKey: "employeeId", remoteKey: "id" } },
  commsMessage: { thread: { model: "commsThread", kind: "one", localKey: "threadId", remoteKey: "id" } },
  commsThread: { slackChannel: { model: "slackChannel", kind: "one", localKey: "slackChannelId", remoteKey: "id" } },
  incident: { updates: { model: "incidentUpdate", kind: "many", localKey: "id", remoteKey: "incidentId" } },
  tokenReview: { demandSignals: { model: "tokenDemandSignal", kind: "many", localKey: "id", remoteKey: "tokenReviewId" } },
  dailyCheckItem: { definition: { model: "dailyCheckDefinition", kind: "one", localKey: "definitionCode", remoteKey: "code" } },
};

const DEFAULTS: Record<string, () => Row> = {
  alert: () => ({
    status: "active", severity: "medium", priority: "P2", detail: "", fireCount: 1, cleanRuns: 0, escalationStep: 0,
    firstFiredAt: new Date(), lastFiredAt: new Date(), acknowledgedAt: null, resolvedAt: null, escalatedAt: null,
    autoResolvedAt: null, lastNotifiedAt: null, digestedAt: null, workItemId: null, exposureUsd: null, destination: "in_app",
  }),
  alertRule: () => ({ enabled: false, version: 1, lastEvaluatedAt: null, params: {}, route: {} }),
  workItem: () => ({
    state: "open", priority: "P2", team: "All", metadata: {}, ticketKey: null, ticketSystem: null, ticketUrl: null, ownedAt: null,
    firstResponseAt: null, resolvedAt: null, slaPolicyId: null, exposureUsd: null, clientId: null, riskScore: null, rootCause: null, resolutionNote: null,
  }),
  sourceRecord: () => ({ credentialLabel: "", status: null, mappedStatus: null, occurredAt: null, sourceUpdatedAt: null, fields: {}, firstSeenAt: new Date(), lastSeenAt: new Date() }),
  dailyCheckItem: () => ({ status: "pending", exceptionWorkItemIds: [], evidence: {}, autoResult: "", notes: "", completedAt: null, skippedReason: null, skipRequestedBy: null, skipApprovedBy: null, recordCount: null, dataAsOf: null }),
  dailyCheckDefinition: () => ({ isActive: true, version: 1, kind: "check", requiredFlag: null, restricted: false }),
  iaiDraft: () => ({ jiraKey: null, completedAt: null }),
  outboundMessageDraft: () => ({ status: "draft", purpose: "client_ticket_link", sentById: null, sentAt: null }),
  clientUpdate: () => ({ kind: "update", status: "pending_approval", approverId: null, postedAt: null, targetStatus: null }),
  incidentCategory: () => ({ isActive: true, sortOrder: 0, complianceSensitive: false }),
  ticketLink: () => ({ role: "primary" }),
  leadHandover: () => ({ absent: true, absenceSource: "manual", coveringEmployeeId: null, note: null, submittedById: null, submittedAt: null, postedAt: null, postResults: [], missingNotifiedAt: null }),
  ptoRecord: () => ({ type: "annual_leave", status: "approved", notes: "" }),
  teamConfig: () => ({ leadEmployeeId: null, deputyEmployeeId: null, memberEmployeeIds: [] }),
};

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
}

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function matchField(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date || typeof cond !== "object" || Array.isArray(cond)) return eq(value, cond);
  const c = cond as Record<string, unknown>;
  for (const [op, arg] of Object.entries(c)) {
    switch (op) {
      case "equals": if (!eq(value, arg)) return false; break;
      case "in": if (!(arg as unknown[]).some((v) => eq(value, v))) return false; break;
      case "notIn": if ((arg as unknown[]).some((v) => eq(value, v))) return false; break;
      case "gt": if (value == null || cmp(value, arg) <= 0) return false; break;
      case "gte": if (value == null || cmp(value, arg) < 0) return false; break;
      case "lt": if (value == null || cmp(value, arg) >= 0) return false; break;
      case "lte": if (value == null || cmp(value, arg) > 0) return false; break;
      case "not": if (arg === null ? value === null || value === undefined : matchField(value, arg)) return false; break;
      case "startsWith": if (typeof value !== "string" || !value.startsWith(arg as string)) return false; break;
      case "contains": if (typeof value !== "string" || !value.includes(arg as string)) return false; break;
      case "mode": break;
      default: throw new Error(`fake-prisma: unsupported operator ${op}`);
    }
  }
  return true;
}

export function createFakePrisma() {
  const tables: Record<string, Row[]> = {};
  const table = (m: string) => (tables[m] ??= []);

  function related(model: string, row: Row, name: string): Row | Row[] | null {
    const rel = RELATIONS[model]?.[name];
    if (!rel) throw new Error(`fake-prisma: unknown relation ${model}.${name}`);
    if (rel.kind === "one") return table(rel.model).find((r) => r[rel.remoteKey] === row[rel.localKey] && row[rel.localKey] != null) ?? null;
    return table(rel.model).filter((r) => r[rel.remoteKey] === row[rel.localKey]);
  }

  function matches(model: string, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === "OR") { if (!(v as Where[]).some((w) => matches(model, row, w))) return false; continue; }
      if (k === "AND") { if (!(v as Where[]).every((w) => matches(model, row, w))) return false; continue; }
      if (k === "NOT") { const arr = Array.isArray(v) ? v : [v]; if ((arr as Where[]).some((w) => matches(model, row, w))) return false; continue; }
      if (COMPOUND[model]?.[k]) { if (!COMPOUND[model][k].every((f) => eq(row[f], (v as Row)[f]))) return false; continue; }
      if (RELATIONS[model]?.[k]) {
        const r = related(model, row, k);
        if (v === null) { if (r !== null) return false; continue; }
        if (Array.isArray(r)) throw new Error("fake-prisma: to-many relation filters unsupported");
        if (!r || !matches(RELATIONS[model][k].model, r, v as Where)) return false;
        continue;
      }
      if (!matchField(row[k], v)) return false;
    }
    return true;
  }

  function shape(model: string, row: Row, args: { include?: Record<string, unknown>; select?: Record<string, unknown> }): Row {
    const out: Row = { ...row };
    const nested = { ...(args.include ?? {}), ...Object.fromEntries(Object.entries(args.select ?? {}).filter(([k, v]) => RELATIONS[model]?.[k] && v)) };
    for (const [name, spec] of Object.entries(nested)) {
      if (!spec) continue;
      const r = related(model, row, name);
      const sub = typeof spec === "object" ? (spec as { include?: Record<string, unknown>; select?: Record<string, unknown>; where?: Where }) : {};
      const relModel = RELATIONS[model][name].model;
      out[name] = Array.isArray(r) ? r.filter((x) => matches(relModel, x, sub.where)).map((x) => shape(relModel, x, sub)) : r ? shape(relModel, r, sub) : null;
    }
    return out;
  }

  function applyData(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && "increment" in (v as Row)) row[k] = ((row[k] as number) ?? 0) + ((v as Row).increment as number);
      else if (v !== undefined) row[k] = v;
    }
    row.updatedAt = new Date();
  }

  function uniqueWhere(model: string, where: Where): Row | undefined {
    return table(model).find((r) => matches(model, r, where));
  }

  function model(name: string) {
    const pk = PK[name] ?? "id";
    const api = {
      findMany: async (args: { where?: Where; include?: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take?: number } = {}) => {
        let rows = table(name).filter((r) => matches(name, r, args.where));
        if (args.orderBy && !Array.isArray(args.orderBy)) {
          const [[f, dir]] = Object.entries(args.orderBy);
          rows = [...rows].sort((a, b) => cmp(a[f], b[f]) * (dir === "desc" ? -1 : 1));
        }
        if (args.take) rows = rows.slice(0, args.take);
        return rows.map((r) => shape(name, r, args));
      },
      findFirst: async (args: { where?: Where; include?: Record<string, unknown>; select?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> } = {}) =>
        (await api.findMany({ ...args, take: 1 }))[0] ?? null,
      findUnique: async (args: { where: Where; include?: Record<string, unknown>; select?: Record<string, unknown> }) => {
        const r = uniqueWhere(name, args.where);
        return r ? shape(name, r, args) : null;
      },
      count: async (args: { where?: Where } = {}) => table(name).filter((r) => matches(name, r, args.where)).length,
      create: async (args: { data: Row }) => {
        const row: Row = { ...(DEFAULTS[name]?.() ?? {}), createdAt: new Date(), updatedAt: new Date(), ...args.data };
        if (row[pk] === undefined) row[pk] = cuid();
        if (table(name).some((r) => r[pk] === row[pk])) throw uniqueError();
        for (const f of UNIQUE[name] ?? []) if (row[f] != null && table(name).some((r) => r[f] === row[f])) throw uniqueError();
        for (const fields of Object.values(COMPOUND[name] ?? {})) {
          if (table(name).some((r) => fields.every((f) => r[f] != null && eq(r[f], row[f])))) throw uniqueError();
        }
        table(name).push(row);
        return { ...row };
      },
      update: async (args: { where: Where; data: Row }) => {
        const r = uniqueWhere(name, args.where);
        if (!r) throw Object.assign(new Error(`${name} not found`), { code: "P2025" });
        applyData(r, args.data);
        return { ...r };
      },
      updateMany: async (args: { where?: Where; data: Row }) => {
        const rows = table(name).filter((r) => matches(name, r, args.where));
        rows.forEach((r) => applyData(r, args.data));
        return { count: rows.length };
      },
      upsert: async (args: { where: Where; create: Row; update: Row }) => {
        const r = uniqueWhere(name, args.where);
        if (r) { applyData(r, args.update); return { ...r }; }
        return api.create({ data: args.create });
      },
      deleteMany: async (args: { where?: Where } = {}) => {
        const keep = table(name).filter((r) => !matches(name, r, args.where));
        const count = table(name).length - keep.length;
        tables[name] = keep;
        return { count };
      },
    };
    return api;
  }

  const models = new Map<string, ReturnType<typeof model>>();
  const client = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === "$transaction") return async (ops: unknown) => (typeof ops === "function" ? (ops as (c: unknown) => unknown)(client) : Promise.all(ops as Promise<unknown>[]));
      if (prop === "__tables") return tables;
      if (prop === "__reset") return () => { for (const k of Object.keys(tables)) delete tables[k]; };
      if (prop === "then") return undefined;
      if (!models.has(prop)) models.set(prop, model(prop));
      return models.get(prop);
    },
  });
  return client as Record<string, ReturnType<typeof model>> & { __tables: Record<string, Row[]>; __reset: () => void };
}

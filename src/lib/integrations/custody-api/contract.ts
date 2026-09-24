/**
 * custody API contract (spec §8.1, §16.4): the endpoints and response fields
 * KOMmand Centre depends on, and a comparison of two OpenAPI documents that
 * reports added/removed/changed paths and fields and, above all, any newly
 * added write endpoint, so the GET-only allowlist stays deliberate (H2).
 */

import { AUTH_TOKEN_PATH, CUSTODY_ENDPOINTS } from "@/lib/integrations/custody-api/endpoints";

/** Response fields the app reads, by list endpoint (items of `data`). TODO(CONFIRM-CUSTODY-OPENAPI): confirm against the spec. */
export const DEPENDED_FIELDS: Record<string, string[]> = {
  "/v1/custody/transactions": ["id", "direction", "asset", "amount", "status", "created_at", "tx_hash", "transaction_type", "organization", "account"],
  "/v1/requests": ["id", "type", "status", "requested_at", "expires_at", "updated_at", "organization", "account"],
};

type Json = Record<string, unknown>;
export interface OpenApiDoc {
  paths?: Record<string, Record<string, Json>>;
  components?: { schemas?: Record<string, Json> };
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

/** Concrete sample of a templated path, for matching against the allowlist patterns. */
const sample = (path: string) => path.replace(/\{[^}]+\}/g, "x1");

function resolve(doc: OpenApiDoc, schema: unknown, depth = 0): Json {
  if (!schema || typeof schema !== "object" || depth > 10) return {};
  const s = schema as Json;
  if (typeof s.$ref === "string") {
    const name = s.$ref.split("/").pop()!;
    return resolve(doc, doc.components?.schemas?.[name], depth + 1);
  }
  if (Array.isArray(s.allOf)) {
    const merged: Json = { properties: {} };
    for (const part of s.allOf) Object.assign(merged.properties as Json, resolve(doc, part, depth + 1).properties ?? {});
    return merged;
  }
  return s;
}

/** Field names of the items a list endpoint returns (`data: [item]`, or a bare array). */
export function responseItemFields(doc: OpenApiDoc, path: string, method = "get"): string[] | null {
  const op = doc.paths?.[path]?.[method] as Json | undefined;
  const responses = (op?.responses ?? {}) as Record<string, Json>;
  const ok = responses["200"] ?? responses["201"];
  const content = (ok?.content ?? {}) as Record<string, Json>;
  const schema = resolve(doc, content["application/json"]?.schema);
  let item: Json = schema;
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  if (props.data) {
    const data = resolve(doc, props.data);
    item = data.type === "array" ? resolve(doc, data.items) : data;
  } else if (schema.type === "array") item = resolve(doc, schema.items);
  const fields = Object.keys((item.properties ?? {}) as Json);
  return fields.length ? fields : null;
}

export interface ContractIssue {
  kind: "missing_endpoint" | "missing_field" | "unreadable_schema";
  path: string;
  detail: string;
}

/** Check a spec against what the app depends on. */
export function checkContract(doc: OpenApiDoc): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const specOps = Object.entries(doc.paths ?? {}).flatMap(([path, ops]) => HTTP_METHODS.filter((m) => ops?.[m]).map((m) => ({ path, method: m.toUpperCase() })));
  for (const ep of CUSTODY_ENDPOINTS) {
    const found = specOps.some((o) => o.method === ep.method && ep.pattern.test(sample(o.path)));
    if (!found) issues.push({ kind: "missing_endpoint", path: ep.pattern.source, detail: `${ep.method} is not in the spec` });
  }
  for (const [path, fields] of Object.entries(DEPENDED_FIELDS)) {
    const got = responseItemFields(doc, path);
    if (!got) {
      issues.push({ kind: "unreadable_schema", path, detail: "could not find the item schema for GET" });
      continue;
    }
    for (const f of fields) if (!got.includes(f)) issues.push({ kind: "missing_field", path, detail: `field "${f}" is not in the response items` });
  }
  return issues;
}

export interface SpecDiff {
  addedPaths: string[];
  removedPaths: string[];
  addedOperations: string[];
  removedOperations: string[];
  newWriteEndpoints: string[];
  fieldChanges: Array<{ schema: string; added: string[]; removed: string[]; typeChanged: string[] }>;
}

/** Compare a newly supplied spec with the committed one. */
export function diffSpecs(oldDoc: OpenApiDoc, newDoc: OpenApiDoc): SpecDiff {
  const ops = (doc: OpenApiDoc) => new Set(Object.entries(doc.paths ?? {}).flatMap(([p, o]) => HTTP_METHODS.filter((m) => o?.[m]).map((m) => `${m.toUpperCase()} ${p}`)));
  const oldPaths = new Set(Object.keys(oldDoc.paths ?? {}));
  const newPaths = new Set(Object.keys(newDoc.paths ?? {}));
  const oldOps = ops(oldDoc);
  const newOps = ops(newDoc);
  const addedOperations = [...newOps].filter((o) => !oldOps.has(o)).sort();
  const fieldChanges: SpecDiff["fieldChanges"] = [];
  const names = new Set([...Object.keys(oldDoc.components?.schemas ?? {}), ...Object.keys(newDoc.components?.schemas ?? {})]);
  for (const name of [...names].sort()) {
    const a = (resolve(oldDoc, oldDoc.components?.schemas?.[name]).properties ?? {}) as Record<string, Json>;
    const b = (resolve(newDoc, newDoc.components?.schemas?.[name]).properties ?? {}) as Record<string, Json>;
    const added = Object.keys(b).filter((k) => !(k in a));
    const removed = Object.keys(a).filter((k) => !(k in b));
    const typeChanged = Object.keys(a).filter((k) => k in b && JSON.stringify(a[k]?.type ?? a[k]?.$ref) !== JSON.stringify(b[k]?.type ?? b[k]?.$ref));
    if (added.length || removed.length || typeChanged.length) fieldChanges.push({ schema: name, added, removed, typeChanged });
  }
  return {
    addedPaths: [...newPaths].filter((p) => !oldPaths.has(p)).sort(),
    removedPaths: [...oldPaths].filter((p) => !newPaths.has(p)).sort(),
    addedOperations,
    removedOperations: [...oldOps].filter((o) => !newOps.has(o)).sort(),
    newWriteEndpoints: addedOperations.filter((o) => WRITE_METHODS.has(o.split(" ")[0].toLowerCase()) && o.split(" ")[1] !== AUTH_TOKEN_PATH),
    fieldChanges,
  };
}

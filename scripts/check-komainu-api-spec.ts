/**
 * Spec §16.4: compare a newly supplied Komainu OpenAPI spec with the committed
 * one. Reports added, removed or changed paths and fields, and any newly added
 * write endpoint (the client stays GET-only: H2), then checks the new spec
 * against the fields KOMmand Centre depends on.
 *
 *   npx tsx scripts/check-komainu-api-spec.ts <new-spec.json> [--committed docs/phase1/komainu-openapi-1.6.0.json]
 *
 * Exits 1 when a write endpoint was added or a depended-on endpoint/field is missing.
 */
import { existsSync, readFileSync } from "node:fs";
import { checkContract, diffSpecs, type OpenApiDoc } from "@/lib/integrations/komainu-api/contract";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const newPath = process.argv[2];
if (!newPath || newPath.startsWith("--")) {
  console.error("Usage: npx tsx scripts/check-komainu-api-spec.ts <new-spec.json> [--committed <path>]");
  process.exit(2);
}
// TODO(CONFIRM-KOMAINU-OPENAPI): the committed spec file.
const committedPath = arg("committed") ?? "docs/phase1/komainu-openapi-1.6.0.json";
const load = (p: string) => JSON.parse(readFileSync(p, "utf8")) as OpenApiDoc;
const next = load(newPath);
const list = (xs: string[]) => (xs.length ? xs.map((x) => `  - ${x}`).join("\n") : "  (none)");

let failed = false;
if (existsSync(committedPath)) {
  const diff = diffSpecs(load(committedPath), next);
  console.log(`Compared with ${committedPath}\n`);
  console.log(`Added paths:\n${list(diff.addedPaths)}\nRemoved paths:\n${list(diff.removedPaths)}`);
  console.log(`Added operations:\n${list(diff.addedOperations)}\nRemoved operations:\n${list(diff.removedOperations)}`);
  console.log(`Schema field changes:\n${list(diff.fieldChanges.map((f) => `${f.schema}: +[${f.added.join(", ")}] -[${f.removed.join(", ")}] type[${f.typeChanged.join(", ")}]`))}`);
  if (diff.newWriteEndpoints.length) {
    failed = true;
    console.log(`\nNEW WRITE ENDPOINTS (not added to the allowlist; the client stays GET-only, H2):\n${list(diff.newWriteEndpoints)}`);
  }
} else {
  console.log(`No committed spec at ${committedPath} (CONFIRM-KOMAINU-OPENAPI); checking the contract only.\n`);
}
const issues = checkContract(next);
console.log(`\nContract check (endpoints and fields KOMmand Centre uses):\n${list(issues.map((i) => `${i.kind}: ${i.path} — ${i.detail}`))}`);
if (issues.length) failed = true;
process.exit(failed ? 1 : 0);

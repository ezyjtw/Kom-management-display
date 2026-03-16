/**
 * Validates that .env.example and src/lib/env.ts stay aligned.
 * Run in CI to catch env var drift.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const ENV_TS = path.join(ROOT, "src/lib/env.ts");

function extractEnvExampleKeys(): string[] {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    console.warn("WARNING: .env.example not found, skipping alignment check");
    return [];
  }
  const content = fs.readFileSync(ENV_EXAMPLE, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter(Boolean);
}

function extractEnvSchemaKeys(): string[] {
  if (!fs.existsSync(ENV_TS)) {
    console.error("ERROR: src/lib/env.ts not found");
    process.exit(1);
  }
  const content = fs.readFileSync(ENV_TS, "utf-8");
  // Match keys in the Zod schema object (lines like "  KEY_NAME: z.")
  const matches = content.match(/^\s+([A-Z][A-Z0-9_]+):\s*z\./gm) || [];
  return matches.map((m) => m.trim().split(":")[0].trim());
}

const exampleKeys = extractEnvExampleKeys();
const schemaKeys = extractEnvSchemaKeys();

if (exampleKeys.length === 0) {
  console.log("No .env.example to validate against. Skipping.");
  process.exit(0);
}

const exampleSet = new Set(exampleKeys);
const schemaSet = new Set(schemaKeys);

// Keys in .env.example but not in env.ts schema
const missingInSchema = exampleKeys.filter((k) => !schemaSet.has(k));
// Keys in env.ts schema but not in .env.example
const missingInExample = schemaKeys.filter((k) => !exampleSet.has(k));

let hasErrors = false;

if (missingInSchema.length > 0) {
  console.warn("Keys in .env.example but missing from env.ts schema:");
  missingInSchema.forEach((k) => console.warn(`  - ${k}`));
}

if (missingInExample.length > 0) {
  console.warn("Keys in env.ts schema but missing from .env.example:");
  missingInExample.forEach((k) => console.warn(`  - ${k}`));
}

// Only fail on keys that are in .env.example but completely absent from env.ts
// (the reverse is OK — env.ts may have optional keys not in .env.example)
if (missingInSchema.length > 0) {
  console.error(
    "\nERROR: .env.example has keys not covered by env.ts validation schema."
  );
  console.error("Add them to src/lib/env.ts envSchema or remove from .env.example.\n");
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("Environment schema validation passed.");
}

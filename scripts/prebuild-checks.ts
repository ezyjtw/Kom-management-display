/**
 * Pre-build validation.
 * Ensures the app never attempts a production build with known-invalid config.
 * Runs before `next build` via the prebuild npm script.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const errors: string[] = [];
const warnings: string[] = [];

// 1. Verify Prisma schema exists
const schemaPath = path.join(ROOT, "prisma/schema.prisma");
if (!fs.existsSync(schemaPath)) {
  errors.push("prisma/schema.prisma not found");
}

// 2. Verify Prisma client is generated
const prismaClientPath = path.join(ROOT, "node_modules/.prisma/client/index.js");
if (!fs.existsSync(prismaClientPath)) {
  errors.push(
    "Prisma client not generated. Run `npx prisma generate` before building."
  );
}

// 3. Verify required source files exist
const requiredFiles = [
  "src/lib/env.ts",
  "src/lib/auth-options.ts",
  "src/lib/auth-user.ts",
  "src/middleware.ts",
  "src/app/layout.tsx",
];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    errors.push(`Required source file missing: ${file}`);
  }
}

// 4. Verify tsconfig.json has strict mode
const tsconfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf-8")
);
if (!tsconfig.compilerOptions?.strict) {
  warnings.push("tsconfig.json does not have strict: true");
}

// 5. Verify package-lock.json exists
if (!fs.existsSync(path.join(ROOT, "package-lock.json"))) {
  errors.push("package-lock.json not found. Run npm install to generate it.");
}

// Report
if (warnings.length > 0) {
  console.warn("\nPre-build warnings:");
  warnings.forEach((w) => console.warn(`  - ${w}`));
}

if (errors.length > 0) {
  console.error("\nPre-build checks failed:");
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log("Pre-build checks passed.");
}

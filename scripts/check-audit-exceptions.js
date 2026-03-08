#!/usr/bin/env node
/**
 * Validates npm audit results against reviewed exceptions.
 * Exits 0 if all high/critical vulns are documented in .audit-exceptions.json.
 * Exits 1 if unreviewed vulnerabilities are found.
 *
 * Usage: npm audit --omit=dev --json | node scripts/check-audit-exceptions.js
 */

const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const exceptionsPath = path.join(__dirname, "..", ".audit-exceptions.json");
  if (!fs.existsSync(exceptionsPath)) {
    console.error("ERROR: .audit-exceptions.json not found");
    process.exit(1);
  }

  const exceptions = JSON.parse(fs.readFileSync(exceptionsPath, "utf8"));
  const acceptedAdvisories = new Set(
    (exceptions.accepted || []).map((e) => e.advisory)
  );

  let audit;
  try {
    audit = JSON.parse(input);
  } catch {
    console.error("ERROR: Could not parse npm audit JSON output");
    process.exit(1);
  }

  const vulns = Object.values(audit.vulnerabilities || {});
  const highVulns = vulns.filter(
    (v) => v.severity === "high" || v.severity === "critical"
  );

  const unreviewed = highVulns.filter((v) => {
    const viaRefs = v.via || [];
    return !viaRefs.every(
      (ref) =>
        typeof ref === "string" || acceptedAdvisories.has(String(ref.url))
    );
  });

  if (unreviewed.length > 0) {
    console.error("Unreviewed high/critical vulnerabilities:");
    for (const v of unreviewed) {
      console.error(`  - ${v.name} (${v.severity})`);
    }
    console.error(
      "\nAdd these to .audit-exceptions.json with mitigation notes, or fix the dependency."
    );
    process.exit(1);
  }

  if (highVulns.length > 0) {
    console.log(
      `All ${highVulns.length} high/critical vulnerabilities are reviewed and accepted.`
    );
  } else {
    console.log("No high/critical vulnerabilities found.");
  }
});

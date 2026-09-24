/**
 * Neutral-IP check (Phase 12l). The repository must not contain the names,
 * codes, places, partners or controls of any particular employer. The
 * denylist is stored as SHA-256 hashes of lower-case terms, so this file does
 * not itself contain them; the plain list is kept privately by the owner.
 *
 * Matching is by token: text is split on non-alphanumerics and on camelCase
 * boundaries, and each token and each adjacent pair ("word word") is hashed.
 *
 *   npx tsx scripts/check-neutral-ip.ts        list offending files and counts
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

export const DENYLIST_SHA256 = new Set<string>([
  "016b3271212be0d4779b6c8b93ee10521dca09f902b77944948562f72b3b305d",
  "09dd84c065137d37da14c9cc7c846899aba237f7a728915b04f9f32d925c83d9",
  "14ef9f410d4dadd623e7818384d3503fe60e737787f69543ae0a2747105f3d58",
  "1fd4ebc4dbd97d26043d6c8aa74dc4c5fcff86a4fd7f3543a1f4586794596e35",
  "21bd3229a131a2cc251bf2dde8a900bd318d92c7aad7d33e72e54f581c306e86",
  "342af3f7c1d403ffbf20fbe531da09eb2f2f6a89d5d9a19d635bbc97742ab37a",
  "3eb7b4d308d81f86a4349ac0203ad88d28e835f07e42ce1c273cfa9b24022454",
  "4365fe053173425062d87af4507147a438421150d5f6705a60332c7f7f8dc465",
  "4940287f02b183a01c4871fa0588b747fae04535b17a19162aabeef72caf9220",
  "5184a1cdb19a3bc3d64573002c3672095bc434254c2e53ccfba0a4801bb3a882",
  "579f222d9728fef3d3fb41780bac843cb0a805f960212c98e0b148a1f25fae7d",
  "59bba357145ca539dcd1ac957abc1ec5833319ddcae7f5e8b5da0c36624784b2",
  "889852d7f8dcd24edf15251391943b152d66d620dd4dfc647860311c78b0eeae",
  "8dca9a9539aaf87081e0e5ed804b3593645f37768eaf362170081a8d2850f453",
  "a64ae2afeb9e57c191955000c89ce41689a3183d8a703b7dafccf2f8fde43ef4",
  "b38f606d1568ce85ab652902498d4de41030ad3675e8e67ed4b77b88fcd3c5bf",
  "b9a082e25e51c584d132ebf6da78c18fb9eeee650fd0bea5dca7960bbd709f33",
  "c1cbb8108bc8f123dd633dfa518481cb84dc00d12807b6be4915a80aab091636",
  "c2242e2c12190babaf9f9488fb7bb1bb37182a94cda68699af53ed35160d3933",
  "cafa1dca579972f3d02469fa27f7e8b96b3786d250996e04aa67d3e333db88ba",
  "d076a895423224d3a23467318d622be140d26165307d5e4539c386cc68c1c554",
  "d55ad64eb89349bf422d2ace3b3afad892e57ac17dd6f280eef89ce537d537f4",
  "dedec25ee831d2bb060ea9e228783789f4d4657eb18c29ac9a53c364426288c0",
  "e341649cb35956a8daea92ca965b58fa6c488b89e1ed50976accb6824003e140",
  "eabdce698b982aa300bd5636d033a7e687272fd0184846c953000d6a87839395",
  "ecd81417359fb32af5f5f9188868aceb495fb3a599b77f5d9280d06571c74c83",
  "f80f21938e5248ec70b870ac1103d0dd01b7811550a7a5c971e1c3e85ea62492",
  "fa4d14706e0107b9bd68a9c3767c2fbe2714ed032196018a4296fa4dbfe164dc"
]);

const SKIP = /(^|\/)(package-lock\.json)$|\.(png|jpe?g|gif|ico|webp|woff2?)$/i;
/** Documents this check cannot read are not allowed in the repository at all. */
const OPAQUE = /\.(pdf|docx?|pptx?|xlsx?|zip|gz)$/i;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function tokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Number of denylisted tokens (and token pairs) in a text. */
export function countDenied(text: string): number {
  const t = tokens(text);
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    if (DENYLIST_SHA256.has(sha(t[i]))) n++;
    if (i + 1 < t.length && DENYLIST_SHA256.has(sha(`${t[i]} ${t[i + 1]}`))) n++;
  }
  return n;
}

export function offendingFiles(files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)): Array<{ file: string; count: number }> {
  const out: Array<{ file: string; count: number }> = [];
  for (const f of files) {
    if (SKIP.test(f) || !fs.existsSync(f)) continue;
    if (OPAQUE.test(f)) { out.push({ file: f, count: 1 }); continue; }
    const n = countDenied(f) + countDenied(fs.readFileSync(f, "utf8"));
    if (n) out.push({ file: f, count: n });
  }
  return out.sort((a, b) => b.count - a.count);
}

if (process.argv[1]?.endsWith("check-neutral-ip.ts")) {
  const off = offendingFiles();
  for (const o of off) console.log(`${String(o.count).padStart(5)}  ${o.file}`);
  console.log(`${off.reduce((s, o) => s + o.count, 0)} occurrence(s) in ${off.length} file(s).`);
  process.exit(off.length ? 1 : 0);
}

// scripts/validate-fortunes.ts
//
// Read candidate fortune lines from a file path (first CLI arg) and
// emit only those that:
//   (a) pass `isSafeFortune` (the same validator runtime uses)
//   (b) are 5 to 12 words inclusive — the editorial target from the
//       old SYSTEM_PROMPT, which is tighter than parseFortunes's 4–14
//       tolerant parser. The seed pool is curated to the tight gate;
//       parseFortunes is being deleted as part of this refactor anyway.
//   (c) are unique across the entire input (case-insensitive)
//
// Output: validated lines to stdout, one per line. Stats + rejections
// to stderr. Exit 0 on success.
//
// Usage:
//   pnpm tsx scripts/validate-fortunes.ts scripts/.tmp/fortunes-candidates.txt > /tmp/validated.txt

import { readFileSync } from "node:fs";
import path from "node:path";
import Module from "node:module";

// fortune.ts uses `import "server-only"` to guard against client-bundle
// inclusion. Running it from a standalone tsx script hits server-only's
// throw at module load. Map the specifier to an empty stub so the
// import resolves cleanly, then load fortune.ts via require().
const M = Module as unknown as {
  _resolveFilename: (req: string, parent: unknown, ...rest: unknown[]) => string;
};
const origResolve = M._resolveFilename;
M._resolveFilename = function (req, parent, ...rest) {
  if (req === "server-only") {
    return path.resolve(__dirname, "./_empty-cjs-stub.cjs");
  }
  return origResolve.call(this, req, parent, ...rest);
};

const { __test__ } =
  require("../src/lib/cup-label/fortune") as typeof import("../src/lib/cup-label/fortune");

const MIN_WORDS = 5;
const MAX_WORDS = 12;

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: validate-fortunes.ts <candidates.txt>");
  process.exit(1);
}

const raw = readFileSync(filePath, "utf8");
const lines = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

const seen = new Set<string>();
let kept = 0;
let dropped = 0;
const rejections: Array<{ line: string; reason: string }> = [];

for (const line of lines) {
  const key = line.toLowerCase();
  if (seen.has(key)) {
    rejections.push({ line, reason: "duplicate" });
    dropped++;
    continue;
  }
  const words = line.split(/\s+/).length;
  if (words < MIN_WORDS) {
    rejections.push({ line, reason: `too short (${words} words)` });
    dropped++;
    continue;
  }
  if (words > MAX_WORDS) {
    rejections.push({ line, reason: `too long (${words} words)` });
    dropped++;
    continue;
  }
  if (!__test__.isSafeFortune(line)) {
    rejections.push({ line, reason: "isSafeFortune rejected" });
    dropped++;
    continue;
  }
  seen.add(key);
  console.log(line);
  kept++;
}

console.error(`[validate-fortunes] kept=${kept} dropped=${dropped} total=${lines.length}`);
if (rejections.length > 0) {
  console.error("[validate-fortunes] rejections:");
  for (const r of rejections.slice(0, 50)) {
    console.error(`  - ${r.reason}: ${r.line}`);
  }
  if (rejections.length > 50) {
    console.error(`  ... and ${rejections.length - 50} more`);
  }
}

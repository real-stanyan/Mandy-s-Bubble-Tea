# Cup-label fortune precompute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-store (Square POS) DeepSeek runtime call with a precomputed pool of 500 hand-curated fortune sentences stored in Supabase, selected randomly via Postgres RPC at print time.

**Architecture:** New table `cup_label_fortunes (id, text, created_at)` + SECURITY DEFINER-free SQL function `cup_label_random_fortunes(n)` ordered by `random() LIMIT n`. `src/lib/cup-label/fortune.ts` is rewritten to call the RPC via service-role Supabase client; the existing 30-line `FALLBACK_POOL` stays as the last-ditch fallback for DB outages. The DeepSeek HTTP path is deleted.

**Tech Stack:** Supabase Postgres (project `fsvtwivogyebugqhmjjy`), `@supabase/supabase-js` v2 via existing `getSupabaseAdmin()` helper, vitest 4 for tests, `mcp__supabase__apply_migration` for prod schema apply, branch `feat/cup-label-zebra-zd410` in `~/Github/mandys_bubble_tea` worktree.

**Spec:** `docs/superpowers/specs/2026-05-21-cup-label-fortune-precompute.md`

---

## File Structure

**Create:**
- `scripts/validate-fortunes.ts` — Reusable validator. Reads candidate lines from a file arg, runs each through `__test__.isSafeFortune` + word-count gate + case-insensitive dedupe, prints `OK <count>` plus rejected lines with reasons. Useful for the seed step and for any future re-seed.
- `scripts/.tmp/fortunes-candidates.txt` — Intermediate gitignored file holding raw candidate lines during seed-generation iteration. NOT committed.
- `supabase/migrations/2026-05-21-cup-label-fortunes.sql` — Single migration containing `CREATE TABLE cup_label_fortunes`, `CREATE OR REPLACE FUNCTION cup_label_random_fortunes(n int)`, and 500 `INSERT ... ON CONFLICT (text) DO NOTHING` statements.

**Modify:**
- `src/lib/cup-label/fortune.ts` — Strip DeepSeek HTTP, `parseFortunes`, `SYSTEM_PROMPT`, and related constants. Rewrite `generateFortunes(count)` to call `cup_label_random_fortunes` RPC via `getSupabaseAdmin()`. Keep `FALLBACK_POOL`, `isSafeFortune`, `pickFromPool`, and the `__test__` export surface (refocused on remaining helpers).
- `src/lib/cup-label/fortune.test.ts` — Drop the three `parseFortunes` cases and the DeepSeek-fetch mock case. Add cases for: RPC returns ≥N rows (happy path), RPC returns short result (fallback to pool), RPC errors (fallback to pool). Keep `isSafeFortune` and `pickFromPool` direct unit cases.
- `.gitignore` — Add `scripts/.tmp/` so the intermediate candidate file does not get tracked.

**Unchanged (verify, do not touch):**
- `src/lib/cup-label/enqueue.ts` — Calls `generateFortunes(count)`. Interface preserved.
- `src/lib/cup-label/render-zebra-cup.ts` — Same.
- `scripts/print-pos-fortune.ts` — Same.
- `src/app/api/webhooks/square/route.ts` — Same.

---

### Task 1: Validator helper script

**Files:**
- Create: `scripts/validate-fortunes.ts`

- [ ] **Step 1: Write the script**

```ts
// scripts/validate-fortunes.ts
//
// Read candidate fortune lines from a file path (first CLI arg) and
// emit only those that:
//   (a) pass `isSafeFortune` (the same validator runtime uses)
//   (b) are between 5 and 12 words inclusive
//   (c) are unique across the entire input (case-insensitive)
//
// Output: validated lines to stdout, one per line. Stats + rejections
// to stderr. Exit 0 on success.
//
// Usage:
//   pnpm tsx scripts/validate-fortunes.ts scripts/.tmp/fortunes-candidates.txt > /tmp/validated.txt

import { readFileSync } from "node:fs";
import { __test__ } from "../src/lib/cup-label/fortune";

const MIN_WORDS = 5;
const MAX_WORDS = 12;

const path = process.argv[2];
if (!path) {
  console.error("Usage: validate-fortunes.ts <candidates.txt>");
  process.exit(1);
}

const raw = readFileSync(path, "utf8");
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
```

- [ ] **Step 2: Smoke-test against the existing FALLBACK_POOL**

Create `scripts/.tmp/fortunes-fallback-pool.txt` containing the existing 30 fallback lines from `fortune.ts` (use `grep -E '^  "[A-Z]' src/lib/cup-label/fortune.ts | head -30 | sed 's/^  "//; s/",\?$//'` or similar to extract), then run:

```bash
mkdir -p scripts/.tmp
# (extract the 30 fallback lines to scripts/.tmp/fortunes-fallback-pool.txt first)
pnpm tsx scripts/validate-fortunes.ts scripts/.tmp/fortunes-fallback-pool.txt | wc -l
```

Expected: `30` (all 30 fallback lines should pass since they were already vetted at runtime).

If the validator drops any of the 30 fallback lines, the validator has a bug — fix it before moving on.

- [ ] **Step 3: Add `scripts/.tmp/` to .gitignore**

```bash
echo "scripts/.tmp/" >> .gitignore
```

Verify:
```bash
grep "scripts/.tmp" .gitignore
```
Expected: `scripts/.tmp/` printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-fortunes.ts .gitignore
git commit -m "feat(cup-label): add fortune candidate validator script

Reusable validator that filters fortune candidates through the same
isSafeFortune rules + word-count gate the runtime uses. Required for
the 500-line seed and for any future re-seed.
"
```

---

### Task 2: Generate 500 candidate fortunes

**Files:**
- Create: `scripts/.tmp/fortunes-candidates.txt` (gitignored intermediate)

The implementing agent generates the 500 lines directly — no automated provider call. Each line must satisfy:

1. **Word count**: 5 to 12 words inclusive.
2. **Topic allowlist**: present-moment warmth, gratitude, kindness, small daily joys, tea / sweetness / bubbles / pearls / cups, gentle optimism, playful curiosity, calm patience, weather and seasons (rain, sun, autumn leaves), small textures (paper, light, footsteps), the act of pausing.
3. **Topic blocklist** (`FORBIDDEN_WORDS` from `fortune.ts:isSafeFortune`): love, romance, dating, marriage, missing someone, family relationships, illness, death, grief, accidents, money, debt, wealth, religion, gods, spirits, fate, karma, politics, work performance, weight, looks, age, mental health, addiction, "you will", "beware", "danger", "warning", "loss", "fail", "ending".
4. **Style**: one sentence, plain warm English, no emoji, no quotes, no numbering, no preamble, no end punctuation, no second-person commands ("Do X"), no specific outcome promises ("You will get a promotion"), no references to other people ("Someone misses you").
5. **Imperative blocklist** (from `IMPERATIVE_STARTS` regex): no lines starting with "Do ", "Avoid ", "Beware", "Don't", "Never", "Always ".
6. **Question blocklist**: no `?`, no opening with wh-word (why/how/what/when/where/who/which/whose), no "is/are/can/will/should/would/could/do/does/did you" opening.

- [ ] **Step 1: Generate 600 raw candidates inline** (over-generate to allow for ~15% drop rate after dedupe + safety filter)

The implementing agent writes 600 lines, one per line, into `scripts/.tmp/fortunes-candidates.txt`. **No automated provider call.** Write them inline. Examples of OK styles (from existing FALLBACK_POOL):

```
The next sip will taste better than the last
Today is a fine day to begin something quiet
Three pearls floated to the top just for you
Slow sips make for long memories
Bubbles rise because they refuse to stay still
Notice the warmth in your hands right now
A gentle pace wins more days than a fast one
```

Aim for variety in subject: ~30% tea/cup/bubble imagery, ~30% present-moment / pause / breath, ~20% small daily joys (light, paper, footsteps, music), ~15% kindness / warmth, ~5% weather / seasons.

- [ ] **Step 2: Run validator**

```bash
pnpm tsx scripts/validate-fortunes.ts scripts/.tmp/fortunes-candidates.txt > scripts/.tmp/fortunes-validated.txt 2> scripts/.tmp/fortunes-rejections.txt
wc -l scripts/.tmp/fortunes-validated.txt
```

Expected: ≥ 500. If fewer, read `scripts/.tmp/fortunes-rejections.txt`, generate additional candidates avoiding the rejection patterns, append to `fortunes-candidates.txt`, and re-run.

- [ ] **Step 3: Trim to exactly 500**

```bash
head -n 500 scripts/.tmp/fortunes-validated.txt > scripts/.tmp/fortunes-final.txt
wc -l scripts/.tmp/fortunes-final.txt
```

Expected: `500`.

- [ ] **Step 4: No commit yet**

These files are gitignored. Continue to Task 3.

---

### Task 3: Write the migration file

**Files:**
- Create: `supabase/migrations/2026-05-21-cup-label-fortunes.sql`

- [ ] **Step 1: Write the schema + RPC head of the file**

```sql
-- supabase/migrations/2026-05-21-cup-label-fortunes.sql
--
-- Precomputed fortune pool for in-store (Square POS) cup labels.
-- Replaces the synchronous DeepSeek call in src/lib/cup-label/fortune.ts.

CREATE TABLE IF NOT EXISTS public.cup_label_fortunes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.cup_label_random_fortunes(n int)
RETURNS TABLE(text text)
LANGUAGE sql
STABLE
AS $$
  SELECT text FROM public.cup_label_fortunes ORDER BY random() LIMIT n;
$$;

GRANT EXECUTE ON FUNCTION public.cup_label_random_fortunes(int) TO service_role;

-- 500 seed rows below. ON CONFLICT (text) DO NOTHING keeps the
-- migration replayable on a database that already has some lines.
```

- [ ] **Step 2: Append 500 INSERT statements from the validated set**

For each of the 500 lines in `scripts/.tmp/fortunes-final.txt`, append:

```sql
INSERT INTO public.cup_label_fortunes (text) VALUES ('<line with single quotes escaped>') ON CONFLICT (text) DO NOTHING;
```

Single quotes in fortune text must be SQL-escaped (`'` → `''`). Use a small inline command, e.g.:

```bash
awk '{gsub(/'\''/, "'\'''\''"); print "INSERT INTO public.cup_label_fortunes (text) VALUES ('\''" $0 "'\'') ON CONFLICT (text) DO NOTHING;"}' scripts/.tmp/fortunes-final.txt >> supabase/migrations/2026-05-21-cup-label-fortunes.sql
```

- [ ] **Step 3: Sanity-check the migration file**

```bash
wc -l supabase/migrations/2026-05-21-cup-label-fortunes.sql
grep -c "^INSERT INTO public.cup_label_fortunes" supabase/migrations/2026-05-21-cup-label-fortunes.sql
```

Expected: total line count ≈ 520 (schema + 500 inserts + comments); INSERT count = exactly `500`.

- [ ] **Step 4: Local syntax dry-run (optional but cheap)**

If `psql` is available locally pointed at a throwaway DB, run:
```bash
psql "$LOCAL_TEST_DB" -f supabase/migrations/2026-05-21-cup-label-fortunes.sql -v ON_ERROR_STOP=1
```
Expected: 500 rows inserted, function created. If `psql` is not available, skip — the next task applies it via MCP which will fail loudly on syntax errors anyway.

- [ ] **Step 5: No commit yet**

Hold until apply succeeds (Task 4). If the apply reveals a syntax issue, we want to fix the file before the first commit on the branch points at it.

---

### Task 4: Apply migration to Mandy prod Supabase

**Files:**
- No new files. Possible filename rename to align with MCP-applied timestamp.

- [ ] **Step 1: Apply via MCP**

Use the `mcp__supabase__apply_migration` tool with:
- `project_id`: `fsvtwivogyebugqhmjjy`
- `name`: `2026-05-21-cup-label-fortunes`
- `query`: the full contents of `supabase/migrations/2026-05-21-cup-label-fortunes.sql`

- [ ] **Step 2: Verify table populated**

Use `mcp__supabase__execute_sql` with:
- `project_id`: `fsvtwivogyebugqhmjjy`
- `query`: `SELECT count(*) FROM public.cup_label_fortunes;`

Expected: 500.

Also verify the RPC works:
- `query`: `SELECT text FROM public.cup_label_random_fortunes(3);`

Expected: 3 rows, each a `text` value, all distinct from each other most of the time (random sample).

- [ ] **Step 3: Reconcile migration filename with apply-time ledger timestamp**

Per memory `feedback_supabase_mcp_migration_timestamp.md`, the MCP `apply_migration` writes the ledger version using its own apply-time UTC timestamp. List the applied migrations:

```
mcp__supabase__list_migrations { project_id: "fsvtwivogyebugqhmjjy" }
```

Find the version assigned to `cup_label_fortunes` (e.g. `20260521143052`). Rename the local file to match:

```bash
git mv supabase/migrations/2026-05-21-cup-label-fortunes.sql supabase/migrations/<applied-version>-cup-label-fortunes.sql
```

This prevents a future `supabase db push` from re-applying it and erroring with "already exists".

- [ ] **Step 4: Commit migration**

```bash
git add supabase/migrations/<applied-version>-cup-label-fortunes.sql
git commit -m "feat(cup-label): seed 500 precomputed fortunes + random selector RPC

Applied to Mandy prod Supabase fsvtwivogyebugqhmjjy.
Replaces the synchronous DeepSeek call in src/lib/cup-label/fortune.ts
(refactor follows in next commit)."
```

---

### Task 5: Failing tests for new DB-backed fortune.ts

**Files:**
- Modify: `src/lib/cup-label/fortune.test.ts`

- [ ] **Step 1: Replace DeepSeek-fetch tests with RPC-mock tests**

Open `src/lib/cup-label/fortune.test.ts`. Delete the existing `describe("fortune parseFortunes", ...)` block (no longer applicable — `parseFortunes` is being removed). Delete any block that mocks `global.fetch` for DeepSeek.

Keep any blocks that directly unit-test `isSafeFortune` and `pickFromPool` via `__test__` — those exports are preserved.

Add a new block that mocks `getSupabaseAdmin` from `@/lib/supabase-server`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { generateFortunes, __test__ } from "./fortune";

const mockAdmin = vi.mocked(getSupabaseAdmin);

function fakeClient(rpcReturn: { data: Array<{ text: string }> | null; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcReturn),
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

describe("generateFortunes (DB-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns RPC rows when RPC succeeds and supplies enough", async () => {
    const rows = [
      { text: "The next sip will taste better than the last" },
      { text: "Today carries small wonders worth a slow sip" },
      { text: "Slow sips make for long memories" },
    ];
    mockAdmin.mockReturnValue(fakeClient({ data: rows, error: null }));

    const out = await generateFortunes(3);

    expect(out).toEqual(rows.map((r) => r.text));
    const client = mockAdmin.mock.results[0].value;
    expect(client.rpc).toHaveBeenCalledWith("cup_label_random_fortunes", { n: 3 });
  });

  it("falls back to pool when RPC returns fewer rows than requested", async () => {
    const rows = [{ text: "A single short return" }];
    mockAdmin.mockReturnValue(fakeClient({ data: rows, error: null }));

    const out = await generateFortunes(5);

    expect(out).toHaveLength(5);
    // All output should come from FALLBACK_POOL (not the partial RPC result).
    const pool = new Set(__test__.FALLBACK_POOL);
    expect(out.every((l) => pool.has(l))).toBe(true);
  });

  it("falls back to pool when RPC returns an error", async () => {
    mockAdmin.mockReturnValue(fakeClient({ data: null, error: { message: "connection refused" } }));

    const out = await generateFortunes(2);

    expect(out).toHaveLength(2);
    const pool = new Set(__test__.FALLBACK_POOL);
    expect(out.every((l) => pool.has(l))).toBe(true);
  });
});

describe("isSafeFortune", () => {
  it("rejects forbidden topics", () => {
    expect(__test__.isSafeFortune("A loved one will call you tomorrow")).toBe(false);
    expect(__test__.isSafeFortune("God smiles upon your endeavor")).toBe(false);
    expect(__test__.isSafeFortune("You will lose something dear today")).toBe(false);
  });
  it("accepts neutral warm lines", () => {
    expect(__test__.isSafeFortune("A warm smile makes any day sweeter")).toBe(true);
    expect(__test__.isSafeFortune("Every sip is a little moment of calm")).toBe(true);
  });
  it("rejects imperative starts", () => {
    expect(__test__.isSafeFortune("Beware of strangers offering candy")).toBe(false);
    expect(__test__.isSafeFortune("Do not look back today")).toBe(false);
  });
  it("rejects questions", () => {
    expect(__test__.isSafeFortune("Why not try something new today")).toBe(false);
  });
});

describe("pickFromPool", () => {
  it("returns the requested count even when count exceeds pool size", () => {
    const out = __test__.pickFromPool(50);
    expect(out).toHaveLength(50);
  });
  it("excludes already-used lines when caller supplies them", () => {
    const exclude = __test__.FALLBACK_POOL.slice(0, 5);
    const out = __test__.pickFromPool(5, exclude);
    expect(out.every((l) => !exclude.includes(l))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
pnpm vitest run src/lib/cup-label/fortune.test.ts
```

Expected: `generateFortunes (DB-backed)` cases fail because the current implementation still calls DeepSeek via `fetch`, not the supabase RPC. The `isSafeFortune` and `pickFromPool` cases should already pass.

If `parseFortunes` is still being imported in the test file from a previous test block you missed deleting, fix the imports before declaring this step done.

- [ ] **Step 3: No commit yet**

Tests are red. Implementation in Task 6 makes them green.

---

### Task 6: Refactor fortune.ts to use RPC

**Files:**
- Modify: `src/lib/cup-label/fortune.ts`

- [ ] **Step 1: Rewrite the file**

Replace the entire current contents with:

```ts
import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase-server";

// In-store (Square POS) cup labels print a one-line "fortune" in place
// of the doodle. The pool is a 500-line precomputed set seeded by the
// 2026-05-21-cup-label-fortunes migration. We pull N rows at print
// time via the cup_label_random_fortunes(n) SQL function — one
// round-trip and Postgres's random() does the picking.
//
// If the DB read fails (network, table missing, RPC error, short
// result), we fall back to a 30-line hand-curated pool inlined below
// so a cup never prints without a fortune. The fallback is a feature,
// not just a safety net — DB down ≠ no labels.

const FALLBACK_POOL: readonly string[] = [
  "The next sip will taste better than the last",
  "Today is a fine day to begin something quiet",
  "Patience is the slowest brewer of all teas",
  "The road less travelled has more bubble tea",
  "Three pearls floated to the top just for you",
  "A small kindness shared today travels far",
  "Bubbles rise because they refuse to stay still",
  "Slow sips make for long memories",
  "The first bubble is always the bravest",
  "Sweetness finds those who notice the small things",
  "A kind word costs nothing and warms everything",
  "The pearls at the bottom are the patient ones",
  "Today carries small wonders worth a slow sip",
  "Curiosity is the best companion for a Tuesday",
  "A good cup is half drink, half pause",
  "Every bubble holds a tiny bit of joy",
  "Notice the warmth in your hands right now",
  "The simple things often taste the best",
  "A quiet smile makes the room a little brighter",
  "Tea is patience you can drink",
  "The bubbles know exactly when to rise",
  "Small joys count just as much as big ones",
  "A gentle pace wins more days than a fast one",
  "The pearl you chase first is always the sweetest",
  "Today is a fine day for a fresh start",
  "Kindness shared at a cafe travels for miles",
  "Take the moment slowly; it is yours",
  "Every cup is a tiny new beginning",
  "The best surprises are the ones you sip slowly",
  "Joy hides in the smallest bubbles",
];

// Word lists for the safety validator. Kept in this file because the
// 500-line seed went through the exact same predicate at seed time
// and any future re-seed should reuse this rule set.
const FORBIDDEN_WORDS = [
  "love", "romance", "dating", "marriage", "lover", "loved one",
  "miss you", "missing you", "missing someone",
  "family", "mother", "father", "parent", "sibling", "child", "children",
  "ill", "sick", "disease", "death", "die", "dying", "dead", "grief", "mourn",
  "accident", "injury", "hospital",
  "money", "wealth", "rich", "poor", "debt", "loan", "salary",
  "god", "gods", "lord", "spirit", "spirits", "soul", "fate", "karma", "destiny",
  "politics", "election", "government", "president",
  "work performance", "promotion", "fired", "raise",
  "weight", "fat", "thin", "looks", "beautiful", "ugly", "age", "old",
  "mental health", "depression", "anxiety", "addiction",
  "warning", "danger", "beware", "fail", "failure", "loss",
  "you will",
];
const IMPERATIVE_STARTS = [
  /^do\s/i,
  /^don['']?t\s/i,
  /^never\s/i,
  /^always\s/i,
  /^avoid\s/i,
  /^beware\b/i,
];

export function isSafeFortune(line: string): boolean {
  const lower = line.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) return false;
  }
  for (const re of IMPERATIVE_STARTS) {
    if (re.test(line.trim())) return false;
  }
  const trimmed = line.trim();
  if (trimmed.endsWith("?")) return false;
  if (/^(?:why|how|what|when|where|who|which|whose)\b/i.test(trimmed)) return false;
  if (/^(?:is|are|can|will|should|would|could|do|does|did)\s+you\b/i.test(trimmed)) return false;
  return true;
}

function pickFromPool(count: number, exclude: string[] = []): string[] {
  const used = new Set(exclude);
  const pool = FALLBACK_POOL.filter((f) => !used.has(f));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(shuffled[i % shuffled.length]);
  }
  return out;
}

export async function generateFortunes(count: number): Promise<string[]> {
  if (count <= 0) return [];
  try {
    const { data, error } = await getSupabaseAdmin().rpc("cup_label_random_fortunes", { n: count });
    if (error) {
      console.warn(`[fortune] RPC error (${error.message}) — using fallback pool`);
      return pickFromPool(count);
    }
    if (!data || data.length < count) {
      console.warn(`[fortune] RPC returned ${data?.length ?? 0}/${count} — using fallback pool`);
      return pickFromPool(count);
    }
    return data.map((r: { text: string }) => r.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[fortune] RPC threw (${msg}) — using fallback pool`);
    return pickFromPool(count);
  }
}

export const __test__ = { FALLBACK_POOL, isSafeFortune, pickFromPool };
```

- [ ] **Step 2: Run tests, verify they pass**

```bash
pnpm vitest run src/lib/cup-label/fortune.test.ts
```

Expected: all `generateFortunes (DB-backed)`, `isSafeFortune`, `pickFromPool` cases pass.

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no new errors. If `parseFortunes` or DeepSeek constants are still referenced from `fortune.test.ts` or any other file, the typecheck will catch it — fix by removing the dead imports.

- [ ] **Step 4: Confirm callers still build**

```bash
grep -rn "generateFortunes\|callDeepSeek\|parseFortunes" src/ printer-client/ scripts/ | grep -v node_modules
```

Expected: `generateFortunes` appears in `src/lib/cup-label/fortune.ts`, `enqueue.ts`, `render-zebra-cup.ts`, `scripts/print-pos-fortune.ts`, and `fortune.test.ts`. `callDeepSeek` and `parseFortunes` should appear **nowhere**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/fortune.ts src/lib/cup-label/fortune.test.ts
git commit -m "refactor(cup-label): replace DeepSeek runtime call with DB-backed fortune RPC

generateFortunes(count) now pulls N rows from the precomputed
cup_label_fortunes table via cup_label_random_fortunes(n) RPC. The
30-line FALLBACK_POOL stays as the last-ditch fallback for DB outages.

Removes DeepSeek HTTP call, parseFortunes, SYSTEM_PROMPT, MIN/MAX_WORDS,
and the DEEPSEEK_API_KEY env dependency from the cup-label hot path.
The web/app checkout doodle pipeline (Doubao Seedream) is unaffected.
"
```

---

### Task 7: Smoke test against real prod Supabase

**Files:**
- Create: `scripts/.tmp/smoke-fortune.ts` (gitignored intermediate, not committed)

- [ ] **Step 1: Write a tiny smoke script that calls generateFortunes**

```ts
// scripts/.tmp/smoke-fortune.ts
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { generateFortunes } from "../../src/lib/cup-label/fortune";

(async () => {
  const out = await generateFortunes(5);
  console.log("--- generateFortunes(5) returned ---");
  for (const line of out) {
    console.log(line);
  }
  console.log("--- done ---");
})();
```

- [ ] **Step 2: Run it**

```bash
pnpm tsx scripts/.tmp/smoke-fortune.ts
```

Expected: 5 distinct lines from the seeded 500 (not from `FALLBACK_POOL` — unless prod DB is down, in which case the console.warn line will print and you'll see fallback lines instead).

Run it 3 times. The 5 lines should be different on most runs (random sample from 500 makes back-to-back identical 5-tuples vanishingly rare).

- [ ] **Step 3: No commit**

The smoke script lives under `scripts/.tmp/` and stays gitignored.

---

### Task 8: Final verification + handoff

- [ ] **Step 1: Full test sweep on touched files**

```bash
pnpm vitest run src/lib/cup-label/
pnpm tsc --noEmit
```

Expected: tests pass, typecheck clean.

- [ ] **Step 2: Git status sanity**

```bash
git log feat/cup-label-zebra-zd410 --oneline -10
git status
```

Expected: 4 new commits since the spec commit (`f2d1926`):
1. validator script + .gitignore
2. migration with 500 inserts (renamed to match MCP-applied version)
3. fortune.ts refactor + test refactor

Working tree clean except for the gitignored `scripts/.tmp/` files.

- [ ] **Step 3: Update DEV_QUEUE-mandys.md**

Add a "Recently Completed" entry summarizing the change. (The /dev session-end protocol handles this, but if this plan is being executed mid-session it's worth jotting the rough entry now.)

- [ ] **Step 4: Update TESTER_QUEUE-mandys.md "Pending QA from /dev"**

Add an entry:
```
- 2026-05-21 — `<refactor-commit-sha>` cup-label POS fortune source changed from DeepSeek runtime call to precomputed 500-line pool via cup_label_random_fortunes RPC. — TEST: trigger a Square POS sandbox order, watch the cup-label job in `cup_label_jobs` table — fortune text should be one of the 500 seeded lines (or, if DB is unreachable, one of the 30 FALLBACK_POOL lines). DeepSeek API key is no longer read by this path. — STATUS: pending
```

- [ ] **Step 5: No push, no PR**

Per spec: "Nothing is pushed; nothing PR'd. The branch ships as one piece when ZD410 cutover happens." Leave the branch local on top of `f2aee27` + new commits.

---

## Self-review notes

- **Spec coverage**: storage (Task 3+4), selection (Task 6 RPC call), fallback (Task 6 catch + short-result branch), code refactor (Task 6), test changes (Task 5), 500-line generation (Task 2), migration apply path (Task 4 incl. timestamp drift fix), branch policy (Task 8 step 5). All sections of the spec map to at least one task.
- **Placeholders**: none of the "TODO / TBD / add appropriate error handling" patterns. Each step shows exact commands or code.
- **Type consistency**: `cup_label_random_fortunes(n)` RPC name used consistently across SQL (Task 3), test mock (Task 5), and implementation (Task 6). `FALLBACK_POOL` / `isSafeFortune` / `pickFromPool` exports are preserved on `__test__` throughout.
- **Out-of-scope follow-ups** from the spec (admin UI, seasonal sets, anti-repeat tracking, multi-language) are not in any task — correct, they are explicitly non-goals.

# App Lottery Prize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the app-only time-bounded lottery campaign feature defined in `docs/superpowers/specs/2026-05-04-app-lottery-prize-design.md`. Every successful app order during an active campaign rolls a server-side weighted-random prize. Digital prizes auto-apply on the user's next order; physical prizes show a 6-character claim code redeemed in-store via admin.

**Architecture:** New Supabase tables `campaigns` + `prize_rolls`. Web (`mandys_bubble_tea`) extends `/api/orders` with roll + auto-apply, extends `/api/webhooks/square` with refund-void, adds `/api/campaigns/active` and `/api/prizes/me` endpoints. Admin (`mandys_bubble_tea_admin`) adds a read-only winners page with claim-code lookup. App (`mandys_bubble_tea_app`) adds `PrizeRevealModal` confetti reveal on order confirmation, an "Active prizes" section in Account, and a "Used" line on the order detail receipt.

**Tech Stack:** Next.js 16 + Supabase + Square SDK v44 (web/admin); Expo SDK 54 + Expo Router 6 + react-native-reanimated 4 + react-native-qrcode-svg + react-native-svg (app); Supabase MCP `apply_migration` for production schema; vitest + supertest (web); jest + RNTL (app).

**Spec reference:** `~/Github/mandys_bubble_tea_app/docs/superpowers/specs/2026-05-04-app-lottery-prize-design.md`

---

## File Structure

### `mandys_bubble_tea` (web)

```
supabase/migrations/2026-05-04-lottery-campaigns.sql       (Create)
src/lib/lottery/types.ts                                   (Create)
src/lib/lottery/pool.ts                                    (Create)
src/lib/lottery/pool.test.ts                               (Create)
src/lib/lottery/random.ts                                  (Create)
src/lib/lottery/random.test.ts                             (Create)
src/lib/lottery/claim-code.ts                              (Create)
src/lib/lottery/claim-code.test.ts                         (Create)
src/lib/lottery/roll.ts                                    (Create)
src/lib/lottery/roll.test.ts                               (Create)
src/lib/lottery/auto-apply.ts                              (Create)
src/lib/lottery/auto-apply.test.ts                         (Create)
src/lib/lottery/refund.ts                                  (Create)
src/lib/lottery/refund.test.ts                             (Create)
src/app/api/orders/route.ts                                (Modify — call rollPrize + auto-apply)
src/app/api/webhooks/square/route.ts                       (Modify — handle refund.updated)
src/app/api/campaigns/active/route.ts                      (Create)
src/app/api/prizes/me/route.ts                             (Create)
```

### `mandys_bubble_tea_admin` (admin)

```
supabase/migrations/2026-05-04-lottery-prizes-admin.sql    (Create — RLS policies + admin helper view)
src/app/api/admin/prizes/lookup/route.ts                   (Create)
src/app/api/admin/prizes/[id]/mark-claimed/route.ts        (Create)
src/app/api/admin/campaigns/[id]/winners/route.ts          (Create — list + stats)
src/app/campaigns/[id]/winners/page.tsx                    (Create)
src/app/campaigns/[id]/winners/WinnerLookup.tsx            (Create)
src/app/campaigns/[id]/winners/WinnerStats.tsx             (Create)
src/lib/admin-prizes.ts                                    (Create)
```

### `mandys_bubble_tea_app` (app)

```
lib/api.ts                                                 (Modify — add __source body field)
lib/prizes.ts                                              (Create)
components/prize/Confetti.tsx                              (Create)
components/prize/PrizeRevealModal.tsx                      (Create)
components/account/ActivePrizes.tsx                        (Create)
components/account/__tests__/ActivePrizes.test.tsx         (Create)
components/prize/__tests__/PrizeRevealModal.test.tsx       (Create)
app/order-confirmation.tsx                                 (Modify — render PrizeRevealModal)
app/order-detail.tsx                                       (Modify — render "Used:" line)
app/(tabs)/account.tsx                                     (Modify — insert ActivePrizes)
```

---

## Pre-flight: Branch Coordination

The app repo's working tree is currently on `feat/cup-label-app-doodle` (doodle agent's branch). The spec was written without committing because that branch belongs to another agent. Each repo gets its own branch from clean main.

- [ ] **PF1: Verify all three repos' main branches are up to date**

```bash
cd ~/Github/mandys_bubble_tea && git fetch origin && git status
cd ~/Github/mandys_bubble_tea_admin && git fetch origin && git status
cd ~/Github/mandys_bubble_tea_app && git fetch origin && git status
```

Expected: each shows `Your branch is up to date with 'origin/main'` (or note divergence and resolve before proceeding).

The app repo will show `feat/cup-label-app-doodle` checked out — that is doodle agent's working state. Do NOT branch from it. The new branch must come from origin/main.

- [ ] **PF2: Create lottery-prize branch in `mandys_bubble_tea` (web)**

```bash
cd ~/Github/mandys_bubble_tea
git checkout main
git pull origin main
git checkout -b feat/lottery-prize
```

- [ ] **PF3: Create lottery-prize branch in `mandys_bubble_tea_admin`**

```bash
cd ~/Github/mandys_bubble_tea_admin
git checkout main
git pull origin main
git checkout -b feat/lottery-prize-winners
```

- [ ] **PF4: Create lottery-prize branch in `mandys_bubble_tea_app`**

The app repo currently has dirty doodle changes. Stash them under a label so doodle agent can resume.

```bash
cd ~/Github/mandys_bubble_tea_app
git stash push -u -m "doodle-agent-wip-$(date +%Y%m%d-%H%M)" -- \
  components/doodle/DoodleCanvas.tsx \
  ios/mandysbubbleteaapp.xcodeproj/project.pbxproj \
  ios/mandysbubbleteaapp.xcodeproj/xcshareddata/xcschemes/mandysbubbleteaapp.xcscheme \
  lib/square-payment.ts
git checkout main
git pull origin main
git checkout -b feat/lottery-prize
```

After PF4, copy the spec into the new branch (it currently sits on disk but was never committed to the doodle branch):

```bash
git add docs/superpowers/specs/2026-05-04-app-lottery-prize-design.md
git add docs/superpowers/plans/2026-05-04-app-lottery-prize.md
git commit -m "docs: add lottery-prize spec + implementation plan"
```

Per memory `feedback_subagent_branch_pin`: any subagent dispatched to a task must run the appropriate `git checkout feat/lottery-prize` (or `feat/lottery-prize-winners`) as Step 0 before any other action.

---

## Phase 1 — Web (`mandys_bubble_tea`)

### Task 1: Database migration for `campaigns` and `prize_rolls`

**Files:**
- Create: `supabase/migrations/2026-05-04-lottery-campaigns.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 2026-05-04 lottery-campaigns: app-only weighted-random prize rolls

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  prize_pool  jsonb not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint campaigns_window check (ends_at > starts_at)
);

create unique index if not exists campaigns_one_active
  on public.campaigns (is_active) where is_active = true;

create table if not exists public.prize_rolls (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id),
  user_id           uuid not null references auth.users(id),
  square_order_id   text not null,
  tier_id           text not null,
  prize_type        text not null
    check (prize_type in ('thank_you', 'digital', 'physical')),
  prize_payload     jsonb not null default '{}'::jsonb,
  status            text not null default 'won_active'
    check (status in ('won_active', 'redeemed', 'claimed', 'expired', 'voided')),
  expires_at        timestamptz,
  redeemed_order_id text,
  claimed_at        timestamptz,
  voided_at         timestamptz,
  claim_code        text unique,
  rolled_at         timestamptz not null default now(),
  unique (square_order_id)
);

create index if not exists prize_rolls_active_digital
  on public.prize_rolls (user_id, expires_at)
  where prize_type = 'digital' and status = 'won_active';

create index if not exists prize_rolls_user_physical_cap
  on public.prize_rolls (user_id, campaign_id)
  where prize_type = 'physical' and status in ('won_active', 'claimed', 'expired');

create index if not exists prize_rolls_claim_code
  on public.prize_rolls (claim_code) where claim_code is not null;

-- RLS: users can read their own rolls; service role full access.
alter table public.prize_rolls enable row level security;

create policy "users read own prize_rolls"
  on public.prize_rolls
  for select
  using (auth.uid() = user_id);

create policy "service role full access prize_rolls"
  on public.prize_rolls
  for all
  to service_role
  using (true)
  with check (true);

-- campaigns is read-only to clients; only service role writes.
alter table public.campaigns enable row level security;

create policy "anyone reads active campaigns"
  on public.campaigns
  for select
  using (is_active = true);

create policy "service role full access campaigns"
  on public.campaigns
  for all
  to service_role
  using (true)
  with check (true);
```

- [ ] **Step 2: Apply migration to production via Supabase MCP**

The web repo uses Supabase MCP `apply_migration` tool. Apply the file contents:

```
mcp__supabase__apply_migration with name="2026-05-04-lottery-campaigns" and query=<file contents>
```

Verify both tables exist:

```
mcp__supabase__list_tables
```

Expected: `campaigns` and `prize_rolls` appear under the `public` schema.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-05-04-lottery-campaigns.sql
git commit -m "feat(lottery): add campaigns and prize_rolls tables"
```

### Task 2: Lottery types module

**Files:**
- Create: `src/lib/lottery/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/lib/lottery/types.ts

export type PrizeType = "thank_you" | "digital" | "physical";

export type PrizeStatus =
  | "won_active"
  | "redeemed"
  | "claimed"
  | "expired"
  | "voided";

export type DigitalPayload =
  | { kind: "discount"; amount_cents: number }
  | { kind: "free_modifier"; modifier_id: string }
  | { kind: "free_drink"; max_cents: number };

export type PhysicalPayload = { label: string };

export type ThankYouPayload = Record<string, never>;

export type PrizePayload = DigitalPayload | PhysicalPayload | ThankYouPayload;

export interface PrizePoolEntry {
  tier_id: string;
  weight: number;
  type: PrizeType;
  payload: PrizePayload;
}

export type PrizePool = PrizePoolEntry[];

export interface RollResult {
  rollId: string;
  tier_id: string;
  prize_type: PrizeType;
  label: string;
  payload: PrizePayload;
  claim_code?: string;
  expires_at: string | null;
}

export interface AppliedPrize {
  rollId: string;
  tier_id: string;
  label: string;
}

export interface Campaign {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  prize_pool: PrizePool;
  is_active: boolean;
}

export const TIER_LABELS: Record<string, string> = {
  thank_you: "Better luck next sip!",
  free_topping: "Free topping",
  discount_3: "$3 off your next order",
  discount_5: "$5 off your next order",
  free_drink: "Free drink of your choice",
  sticker: "Mandy's brand sticker",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/lottery/types.ts
git commit -m "feat(lottery): add prize/campaign types"
```

### Task 3: Pool parser and weight validator

**Files:**
- Create: `src/lib/lottery/pool.ts`
- Create: `src/lib/lottery/pool.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/lottery/pool.test.ts
import { describe, expect, it } from "vitest";
import { parsePrizePool, totalWeight, validatePrizePool } from "./pool";

const VALID_POOL = [
  { tier_id: "thank_you", weight: 50, type: "thank_you", payload: {} },
  {
    tier_id: "free_topping",
    weight: 20,
    type: "digital",
    payload: { kind: "free_modifier", modifier_id: "mod_abc" },
  },
  {
    tier_id: "discount_3",
    weight: 15,
    type: "digital",
    payload: { kind: "discount", amount_cents: 300 },
  },
  {
    tier_id: "sticker",
    weight: 10,
    type: "physical",
    payload: { label: "Sticker" },
  },
  {
    tier_id: "discount_5",
    weight: 4,
    type: "digital",
    payload: { kind: "discount", amount_cents: 500 },
  },
  {
    tier_id: "free_drink",
    weight: 1,
    type: "digital",
    payload: { kind: "free_drink", max_cents: 1000 },
  },
];

describe("parsePrizePool", () => {
  it("parses a valid pool from JSON", () => {
    const pool = parsePrizePool(JSON.stringify(VALID_POOL));
    expect(pool).toHaveLength(6);
    expect(pool[0].tier_id).toBe("thank_you");
  });

  it("parses a valid pool from a JS object (jsonb returns parsed)", () => {
    const pool = parsePrizePool(VALID_POOL);
    expect(pool).toHaveLength(6);
  });

  it("throws on non-array input", () => {
    expect(() => parsePrizePool("{}")).toThrow(/array/);
  });

  it("throws on missing weight", () => {
    expect(() =>
      parsePrizePool([{ tier_id: "x", type: "thank_you", payload: {} }]),
    ).toThrow(/weight/);
  });

  it("throws on negative weight", () => {
    expect(() =>
      parsePrizePool([
        { tier_id: "x", weight: -1, type: "thank_you", payload: {} },
      ]),
    ).toThrow(/weight/);
  });

  it("throws on duplicate tier_id", () => {
    expect(() =>
      parsePrizePool([
        { tier_id: "x", weight: 50, type: "thank_you", payload: {} },
        { tier_id: "x", weight: 50, type: "thank_you", payload: {} },
      ]),
    ).toThrow(/duplicate/);
  });

  it("throws on invalid prize_type", () => {
    expect(() =>
      parsePrizePool([
        { tier_id: "x", weight: 50, type: "bogus", payload: {} },
      ]),
    ).toThrow(/type/);
  });
});

describe("totalWeight", () => {
  it("sums weights", () => {
    expect(totalWeight(VALID_POOL)).toBe(100);
  });

  it("returns 0 for empty pool", () => {
    expect(totalWeight([])).toBe(0);
  });
});

describe("validatePrizePool", () => {
  it("accepts a valid pool", () => {
    expect(() => validatePrizePool(VALID_POOL)).not.toThrow();
  });

  it("rejects pool with zero total weight", () => {
    expect(() =>
      validatePrizePool([
        { tier_id: "x", weight: 0, type: "thank_you", payload: {} },
      ]),
    ).toThrow(/total weight/);
  });

  it("rejects discount payload missing amount_cents", () => {
    expect(() =>
      validatePrizePool([
        {
          tier_id: "d",
          weight: 1,
          type: "digital",
          payload: { kind: "discount" } as unknown as never,
        },
      ]),
    ).toThrow(/amount_cents/);
  });

  it("rejects free_modifier payload missing modifier_id", () => {
    expect(() =>
      validatePrizePool([
        {
          tier_id: "d",
          weight: 1,
          type: "digital",
          payload: { kind: "free_modifier" } as unknown as never,
        },
      ]),
    ).toThrow(/modifier_id/);
  });

  it("rejects physical payload missing label", () => {
    expect(() =>
      validatePrizePool([
        {
          tier_id: "p",
          weight: 1,
          type: "physical",
          payload: {} as unknown as never,
        },
      ]),
    ).toThrow(/label/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Github/mandys_bubble_tea
npx vitest run src/lib/lottery/pool.test.ts
```

Expected: FAIL with "Cannot find module './pool'".

- [ ] **Step 3: Implement `pool.ts`**

```typescript
// src/lib/lottery/pool.ts
import type { PrizePool, PrizePoolEntry, PrizeType } from "./types";

const VALID_TYPES: ReadonlyArray<PrizeType> = [
  "thank_you",
  "digital",
  "physical",
];

export function parsePrizePool(input: unknown): PrizePool {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(raw)) {
    throw new Error("prize_pool must be an array");
  }
  const seen = new Set<string>();
  const out: PrizePoolEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new Error("prize_pool entry must be an object");
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.tier_id !== "string" || e.tier_id.length === 0) {
      throw new Error("prize_pool entry missing tier_id");
    }
    if (typeof e.weight !== "number" || !Number.isFinite(e.weight)) {
      throw new Error(`prize_pool entry ${e.tier_id} missing numeric weight`);
    }
    if (e.weight < 0) {
      throw new Error(
        `prize_pool entry ${e.tier_id} has negative weight ${e.weight}`,
      );
    }
    if (typeof e.type !== "string" || !VALID_TYPES.includes(e.type as PrizeType)) {
      throw new Error(
        `prize_pool entry ${e.tier_id} has invalid type ${String(e.type)}`,
      );
    }
    if (seen.has(e.tier_id)) {
      throw new Error(`prize_pool has duplicate tier_id ${e.tier_id}`);
    }
    seen.add(e.tier_id);
    out.push(entry as PrizePoolEntry);
  }
  return out;
}

export function totalWeight(pool: PrizePool): number {
  return pool.reduce((sum, e) => sum + e.weight, 0);
}

export function validatePrizePool(pool: PrizePool): void {
  if (totalWeight(pool) <= 0) {
    throw new Error("prize_pool total weight must be > 0");
  }
  for (const entry of pool) {
    if (entry.type === "physical") {
      const payload = entry.payload as { label?: string };
      if (!payload || typeof payload.label !== "string" || payload.label.length === 0) {
        throw new Error(
          `prize_pool entry ${entry.tier_id} (physical) missing payload.label`,
        );
      }
    }
    if (entry.type === "digital") {
      const payload = entry.payload as { kind?: string };
      if (payload?.kind === "discount") {
        const p = payload as { amount_cents?: number };
        if (typeof p.amount_cents !== "number" || p.amount_cents <= 0) {
          throw new Error(
            `prize_pool entry ${entry.tier_id} (discount) missing payload.amount_cents`,
          );
        }
      } else if (payload?.kind === "free_modifier") {
        const p = payload as { modifier_id?: string };
        if (typeof p.modifier_id !== "string" || p.modifier_id.length === 0) {
          throw new Error(
            `prize_pool entry ${entry.tier_id} (free_modifier) missing payload.modifier_id`,
          );
        }
      } else if (payload?.kind === "free_drink") {
        const p = payload as { max_cents?: number };
        if (typeof p.max_cents !== "number" || p.max_cents <= 0) {
          throw new Error(
            `prize_pool entry ${entry.tier_id} (free_drink) missing payload.max_cents`,
          );
        }
      } else {
        throw new Error(
          `prize_pool entry ${entry.tier_id} has unknown digital kind ${String(payload?.kind)}`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/lottery/pool.test.ts
```

Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lottery/pool.ts src/lib/lottery/pool.test.ts
git commit -m "feat(lottery): add prize pool parser and validator"
```

### Task 4: Weighted-random selector

**Files:**
- Create: `src/lib/lottery/random.ts`
- Create: `src/lib/lottery/random.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/lottery/random.test.ts
import { describe, expect, it } from "vitest";
import { rollWeighted, makeSeededRandom } from "./random";
import type { PrizePool } from "./types";

const POOL: PrizePool = [
  { tier_id: "a", weight: 50, type: "thank_you", payload: {} },
  {
    tier_id: "b",
    weight: 25,
    type: "digital",
    payload: { kind: "discount", amount_cents: 300 },
  },
  {
    tier_id: "c",
    weight: 25,
    type: "physical",
    payload: { label: "Sticker" },
  },
];

describe("rollWeighted", () => {
  it("is deterministic given a seeded RNG", () => {
    const rng = makeSeededRandom(42);
    const r1 = rollWeighted(POOL, rng);
    const rng2 = makeSeededRandom(42);
    const r2 = rollWeighted(POOL, rng2);
    expect(r1.tier_id).toBe(r2.tier_id);
  });

  it("respects weights within ±1.5% over 100k samples", () => {
    const rng = makeSeededRandom(123);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 100_000; i++) {
      const result = rollWeighted(POOL, rng);
      counts[result.tier_id]!++;
    }
    expect(counts.a! / 100_000).toBeGreaterThan(0.485);
    expect(counts.a! / 100_000).toBeLessThan(0.515);
    expect(counts.b! / 100_000).toBeGreaterThan(0.235);
    expect(counts.b! / 100_000).toBeLessThan(0.265);
    expect(counts.c! / 100_000).toBeGreaterThan(0.235);
    expect(counts.c! / 100_000).toBeLessThan(0.265);
  });

  it("throws on empty pool", () => {
    expect(() => rollWeighted([], makeSeededRandom(1))).toThrow(/empty/);
  });

  it("throws on zero total weight", () => {
    expect(() =>
      rollWeighted(
        [{ tier_id: "x", weight: 0, type: "thank_you", payload: {} }],
        makeSeededRandom(1),
      ),
    ).toThrow(/total weight/);
  });

  it("returns the only entry when there's just one", () => {
    const single: PrizePool = [
      { tier_id: "only", weight: 100, type: "thank_you", payload: {} },
    ];
    const result = rollWeighted(single, makeSeededRandom(99));
    expect(result.tier_id).toBe("only");
  });

  it("crypto-backed default RNG produces all tiers over 10k samples", () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10_000; i++) {
      const result = rollWeighted(POOL); // default crypto RNG
      counts[result.tier_id]!++;
    }
    expect(counts.a).toBeGreaterThan(0);
    expect(counts.b).toBeGreaterThan(0);
    expect(counts.c).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/lottery/random.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `random.ts`**

```typescript
// src/lib/lottery/random.ts
import { randomInt } from "node:crypto";
import type { PrizePool, PrizePoolEntry } from "./types";

export type RandomFn = () => number;

export function makeSeededRandom(seed: number): RandomFn {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function defaultRandom(): number {
  return randomInt(0, 1_000_000) / 1_000_000;
}

export function rollWeighted(
  pool: PrizePool,
  rng: RandomFn = defaultRandom,
): PrizePoolEntry {
  if (pool.length === 0) {
    throw new Error("rollWeighted: pool is empty");
  }
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) {
    throw new Error("rollWeighted: total weight is 0");
  }
  const target = rng() * total;
  let cumulative = 0;
  for (const entry of pool) {
    cumulative += entry.weight;
    if (target < cumulative) {
      return entry;
    }
  }
  return pool[pool.length - 1]!;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/lottery/random.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lottery/random.ts src/lib/lottery/random.test.ts
git commit -m "feat(lottery): add weighted-random selector with seedable RNG"
```

### Task 5: Claim code generator

**Files:**
- Create: `src/lib/lottery/claim-code.ts`
- Create: `src/lib/lottery/claim-code.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/lottery/claim-code.test.ts
import { describe, expect, it, vi } from "vitest";
import { generateClaimCode, generateUniqueClaimCode } from "./claim-code";

describe("generateClaimCode", () => {
  it("returns a 6-character string", () => {
    const code = generateClaimCode();
    expect(code).toHaveLength(6);
  });

  it("excludes ambiguous characters I, L, O, U", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateClaimCode();
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it("uses Crockford base32 alphabet", () => {
    const allowed = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;
    for (let i = 0; i < 100; i++) {
      const code = generateClaimCode();
      expect(code).toMatch(allowed);
    }
  });
});

describe("generateUniqueClaimCode", () => {
  it("returns the first generated code if no collision", async () => {
    const checkExists = vi.fn().mockResolvedValue(false);
    const code = await generateUniqueClaimCode(checkExists);
    expect(code).toHaveLength(6);
    expect(checkExists).toHaveBeenCalledTimes(1);
  });

  it("retries on collision until unique", async () => {
    const checkExists = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const code = await generateUniqueClaimCode(checkExists);
    expect(code).toHaveLength(6);
    expect(checkExists).toHaveBeenCalledTimes(3);
  });

  it("throws after 5 collisions", async () => {
    const checkExists = vi.fn().mockResolvedValue(true);
    await expect(generateUniqueClaimCode(checkExists)).rejects.toThrow(
      /failed after 5 attempts/,
    );
    expect(checkExists).toHaveBeenCalledTimes(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/lottery/claim-code.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `claim-code.ts`**

```typescript
// src/lib/lottery/claim-code.ts
import { randomInt } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateClaimCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += CROCKFORD_ALPHABET[randomInt(0, CROCKFORD_ALPHABET.length)];
  }
  return out;
}

export async function generateUniqueClaimCode(
  checkExists: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateClaimCode();
    const exists = await checkExists(code);
    if (!exists) return code;
  }
  throw new Error("generateUniqueClaimCode: failed after 5 attempts");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/lottery/claim-code.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lottery/claim-code.ts src/lib/lottery/claim-code.test.ts
git commit -m "feat(lottery): add Crockford base32 claim code generator"
```

### Task 6: Roll core function

**Files:**
- Create: `src/lib/lottery/roll.ts`
- Create: `src/lib/lottery/roll.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/lottery/roll.test.ts
import { describe, expect, it, vi } from "vitest";
import { rollPrize } from "./roll";
import { makeSeededRandom } from "./random";
import type { PrizePool } from "./types";

const POOL: PrizePool = [
  { tier_id: "thank_you", weight: 50, type: "thank_you", payload: {} },
  {
    tier_id: "free_topping",
    weight: 20,
    type: "digital",
    payload: { kind: "free_modifier", modifier_id: "mod_topping_default" },
  },
  {
    tier_id: "discount_3",
    weight: 15,
    type: "digital",
    payload: { kind: "discount", amount_cents: 300 },
  },
  {
    tier_id: "sticker",
    weight: 10,
    type: "physical",
    payload: { label: "Mandy's Sticker" },
  },
  {
    tier_id: "discount_5",
    weight: 4,
    type: "digital",
    payload: { kind: "discount", amount_cents: 500 },
  },
  {
    tier_id: "free_drink",
    weight: 1,
    type: "digital",
    payload: { kind: "free_drink", max_cents: 1000 },
  },
];

const ACTIVE_CAMPAIGN = {
  id: "camp-1",
  name: "Test",
  starts_at: "2026-01-01T00:00:00Z",
  ends_at: "2027-01-01T00:00:00Z",
  prize_pool: POOL,
  is_active: true,
};

interface MockDb {
  campaigns: typeof ACTIVE_CAMPAIGN | null;
  hasPhysicalLock: boolean;
  rolls: Array<unknown>;
  claimCodeExists: boolean;
}

function makeMockDeps(db: MockDb) {
  return {
    getActiveCampaign: vi.fn().mockResolvedValue(db.campaigns),
    userHasPhysicalLock: vi.fn().mockResolvedValue(db.hasPhysicalLock),
    insertRoll: vi.fn().mockImplementation(async (row) => {
      db.rolls.push(row);
      return { ...(row as Record<string, unknown>), id: "roll-uuid-1" };
    }),
    claimCodeExists: vi.fn().mockResolvedValue(db.claimCodeExists),
    rng: makeSeededRandom(42),
  };
}

describe("rollPrize", () => {
  it("returns null for non-app source", async () => {
    const db = { campaigns: ACTIVE_CAMPAIGN, hasPhysicalLock: false, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "web" },
      deps,
    );
    expect(result).toBeNull();
    expect(deps.getActiveCampaign).not.toHaveBeenCalled();
  });

  it("returns null when no active campaign", async () => {
    const db = { campaigns: null, hasPhysicalLock: false, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(result).toBeNull();
    expect(deps.insertRoll).not.toHaveBeenCalled();
  });

  it("returns a non-physical tier when user has physical lock", async () => {
    const db = { campaigns: ACTIVE_CAMPAIGN, hasPhysicalLock: true, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    for (let i = 0; i < 50; i++) {
      const result = await rollPrize(
        { userId: "u1", squareOrderId: `sq-${i}`, source: "app" },
        { ...deps, rng: makeSeededRandom(i + 1) },
      );
      expect(result?.prize_type).not.toBe("physical");
    }
  });

  it("inserts a roll row with status=won_active and correct expires_at", async () => {
    const db = { campaigns: ACTIVE_CAMPAIGN, hasPhysicalLock: false, rolls: [], claimCodeExists: false };
    const deps = makeMockDeps(db);
    await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(deps.insertRoll).toHaveBeenCalledTimes(1);
    const inserted = (deps.insertRoll.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(inserted.status).toBe("won_active");
    expect(inserted.user_id).toBe("u1");
    expect(inserted.square_order_id).toBe("sq1");
    expect(inserted.campaign_id).toBe("camp-1");
  });

  it("generates claim_code only for physical prizes", async () => {
    const physicalOnlyPool: PrizePool = [
      { tier_id: "sticker", weight: 100, type: "physical", payload: { label: "Sticker" } },
    ];
    const db = {
      campaigns: { ...ACTIVE_CAMPAIGN, prize_pool: physicalOnlyPool },
      hasPhysicalLock: false,
      rolls: [],
      claimCodeExists: false,
    };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(result?.prize_type).toBe("physical");
    expect(result?.claim_code).toBeDefined();
    expect(result?.claim_code).toHaveLength(6);
  });

  it("does not generate claim_code for thank_you or digital prizes", async () => {
    const digitalOnlyPool: PrizePool = [
      {
        tier_id: "discount_3",
        weight: 100,
        type: "digital",
        payload: { kind: "discount", amount_cents: 300 },
      },
    ];
    const db = {
      campaigns: { ...ACTIVE_CAMPAIGN, prize_pool: digitalOnlyPool },
      hasPhysicalLock: false,
      rolls: [],
      claimCodeExists: false,
    };
    const deps = makeMockDeps(db);
    const result = await rollPrize(
      { userId: "u1", squareOrderId: "sq1", source: "app" },
      deps,
    );
    expect(result?.claim_code).toBeUndefined();
  });

  it("sets expires_at = +30d for digital, +7d for physical, null for thank_you", async () => {
    const cases: Array<["digital" | "physical" | "thank_you", number | null]> = [
      ["digital", 30],
      ["physical", 7],
      ["thank_you", null],
    ];
    for (const [type, daysExpected] of cases) {
      const pool: PrizePool = [
        type === "thank_you"
          ? { tier_id: "thank_you", weight: 100, type, payload: {} }
          : type === "digital"
          ? {
              tier_id: "discount",
              weight: 100,
              type,
              payload: { kind: "discount", amount_cents: 300 },
            }
          : { tier_id: "sticker", weight: 100, type, payload: { label: "Sticker" } },
      ];
      const db = {
        campaigns: { ...ACTIVE_CAMPAIGN, prize_pool: pool },
        hasPhysicalLock: false,
        rolls: [],
        claimCodeExists: false,
      };
      const deps = makeMockDeps(db);
      const before = Date.now();
      await rollPrize(
        { userId: "u1", squareOrderId: `sq-${type}`, source: "app" },
        deps,
      );
      const after = Date.now();
      const inserted = (deps.insertRoll.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
      const expiresAt = inserted.expires_at as string | null;
      if (daysExpected === null) {
        expect(expiresAt).toBeNull();
      } else {
        const ms = new Date(expiresAt as string).getTime();
        expect(ms).toBeGreaterThanOrEqual(before + daysExpected * 86_400_000 - 1000);
        expect(ms).toBeLessThanOrEqual(after + daysExpected * 86_400_000 + 1000);
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/lottery/roll.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `roll.ts`**

```typescript
// src/lib/lottery/roll.ts
import { generateUniqueClaimCode } from "./claim-code";
import { rollWeighted, defaultRandom, type RandomFn } from "./random";
import type { Campaign, PrizePool, RollResult } from "./types";
import { TIER_LABELS } from "./types";

export type OrderSource = "app" | "web";

export interface RollInput {
  userId: string;
  squareOrderId: string;
  source: OrderSource;
}

export interface RollDeps {
  getActiveCampaign(): Promise<Campaign | null>;
  userHasPhysicalLock(userId: string, campaignId: string): Promise<boolean>;
  insertRoll(row: {
    campaign_id: string;
    user_id: string;
    square_order_id: string;
    tier_id: string;
    prize_type: "thank_you" | "digital" | "physical";
    prize_payload: object;
    expires_at: string | null;
    claim_code: string | null;
  }): Promise<{ id: string }>;
  claimCodeExists(code: string): Promise<boolean>;
  rng?: RandomFn;
}

const MS_PER_DAY = 86_400_000;

function maskPhysical(pool: PrizePool): PrizePool {
  return pool.filter((e) => e.type !== "physical");
}

export async function rollPrize(
  input: RollInput,
  deps: RollDeps,
): Promise<RollResult | null> {
  if (input.source !== "app") return null;

  const campaign = await deps.getActiveCampaign();
  if (!campaign) return null;

  const hasLock = await deps.userHasPhysicalLock(input.userId, campaign.id);
  const pool = hasLock ? maskPhysical(campaign.prize_pool) : campaign.prize_pool;
  if (pool.length === 0) return null;

  const rng = deps.rng ?? defaultRandom;
  const winner = rollWeighted(pool, rng);

  const now = Date.now();
  const expiresAt: string | null =
    winner.type === "digital"
      ? new Date(now + 30 * MS_PER_DAY).toISOString()
      : winner.type === "physical"
      ? new Date(now + 7 * MS_PER_DAY).toISOString()
      : null;

  const claimCode =
    winner.type === "physical"
      ? await generateUniqueClaimCode(deps.claimCodeExists)
      : null;

  const inserted = await deps.insertRoll({
    campaign_id: campaign.id,
    user_id: input.userId,
    square_order_id: input.squareOrderId,
    tier_id: winner.tier_id,
    prize_type: winner.type,
    prize_payload: winner.payload as object,
    expires_at: expiresAt,
    claim_code: claimCode,
  });

  return {
    rollId: inserted.id,
    tier_id: winner.tier_id,
    prize_type: winner.type,
    label: TIER_LABELS[winner.tier_id] ?? winner.tier_id,
    payload: winner.payload,
    claim_code: claimCode ?? undefined,
    expires_at: expiresAt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/lottery/roll.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lottery/roll.ts src/lib/lottery/roll.test.ts
git commit -m "feat(lottery): add rollPrize core function with physical-cap masking"
```

### Task 7: Auto-apply digital prize

**Files:**
- Create: `src/lib/lottery/auto-apply.ts`
- Create: `src/lib/lottery/auto-apply.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/lottery/auto-apply.test.ts
import { describe, expect, it } from "vitest";
import { applyPrizeToOrder } from "./auto-apply";
import type { DigitalPayload } from "./types";

const LINE_ITEMS = [
  {
    uid: "li-1",
    name: "Pearl Milk Tea",
    quantity: "1",
    base_price_money: { amount: 850, currency: "AUD" },
    modifiers: [] as Array<unknown>,
  },
  {
    uid: "li-2",
    name: "Taro Milk Tea",
    quantity: "1",
    base_price_money: { amount: 950, currency: "AUD" },
    modifiers: [] as Array<unknown>,
  },
];

describe("applyPrizeToOrder — discount", () => {
  it("appends an OrderLineItemDiscount of type FIXED_AMOUNT", () => {
    const payload: DigitalPayload = { kind: "discount", amount_cents: 300 };
    const result = applyPrizeToOrder(LINE_ITEMS, payload, "lottery-rollid-1");
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0]).toMatchObject({
      type: "FIXED_AMOUNT",
      amount_money: { amount: 300, currency: "AUD" },
      scope: "ORDER",
    });
    expect(result.lineItems).toEqual(LINE_ITEMS);
  });
});

describe("applyPrizeToOrder — free_modifier", () => {
  it("appends a $0 modifier to the first line item", () => {
    const payload: DigitalPayload = {
      kind: "free_modifier",
      modifier_id: "mod_pearls",
    };
    const result = applyPrizeToOrder(LINE_ITEMS, payload, "lottery-rollid-2");
    expect(result.lineItems[0]?.modifiers).toEqual([
      {
        catalog_object_id: "mod_pearls",
        base_price_money: { amount: 0, currency: "AUD" },
      },
    ]);
    expect(result.lineItems[1]?.modifiers).toEqual([]);
    expect(result.discounts).toEqual([]);
  });
});

describe("applyPrizeToOrder — free_drink", () => {
  it("attaches a line-item-scoped FIXED_AMOUNT discount on the most expensive drink, capped at max_cents", () => {
    const payload: DigitalPayload = { kind: "free_drink", max_cents: 1000 };
    const result = applyPrizeToOrder(LINE_ITEMS, payload, "lottery-rollid-3");
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0]).toMatchObject({
      uid: "discount-lottery-rollid-3",
      type: "FIXED_AMOUNT",
      amount_money: { amount: 950, currency: "AUD" },
      scope: "LINE_ITEM",
    });
    expect(result.lineItems[1]?.applied_discounts).toEqual([
      { discount_uid: "discount-lottery-rollid-3" },
    ]);
    expect(result.lineItems[0]?.applied_discounts).toBeUndefined();
  });

  it("caps amount at max_cents when most expensive drink is more expensive", () => {
    const expensive = [
      {
        uid: "li-1",
        name: "Premium",
        quantity: "1",
        base_price_money: { amount: 1500, currency: "AUD" },
        modifiers: [] as Array<unknown>,
      },
    ];
    const payload: DigitalPayload = { kind: "free_drink", max_cents: 1000 };
    const result = applyPrizeToOrder(expensive, payload, "rollid-4");
    expect(result.discounts[0]?.amount_money).toEqual({ amount: 1000, currency: "AUD" });
  });

  it("respects quantity > 1 by considering unit price only (per spec — first matching line)", () => {
    const multi = [
      {
        uid: "li-1",
        name: "Drink",
        quantity: "3",
        base_price_money: { amount: 800, currency: "AUD" },
        modifiers: [] as Array<unknown>,
      },
    ];
    const payload: DigitalPayload = { kind: "free_drink", max_cents: 5000 };
    const result = applyPrizeToOrder(multi, payload, "rollid-5");
    expect(result.discounts[0]?.amount_money).toEqual({ amount: 800, currency: "AUD" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/lottery/auto-apply.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `auto-apply.ts`**

```typescript
// src/lib/lottery/auto-apply.ts
import type { DigitalPayload } from "./types";

export interface SquareLineItem {
  uid?: string;
  name?: string;
  quantity: string;
  base_price_money: { amount: number; currency: string };
  modifiers: Array<unknown>;
  applied_discounts?: Array<{ discount_uid: string }>;
}

export interface SquareDiscount {
  uid: string;
  type: "FIXED_AMOUNT" | "FIXED_PERCENTAGE";
  name: string;
  amount_money?: { amount: number; currency: string };
  percentage?: string;
  scope: "ORDER" | "LINE_ITEM";
}

export interface ApplyResult {
  lineItems: SquareLineItem[];
  discounts: SquareDiscount[];
}

export function applyPrizeToOrder(
  lineItems: SquareLineItem[],
  payload: DigitalPayload,
  rollId: string,
): ApplyResult {
  const currency = lineItems[0]?.base_price_money.currency ?? "AUD";

  if (payload.kind === "discount") {
    return {
      lineItems,
      discounts: [
        {
          uid: `discount-${rollId}`,
          type: "FIXED_AMOUNT",
          name: "Lottery prize discount",
          amount_money: { amount: payload.amount_cents, currency },
          scope: "ORDER",
        },
      ],
    };
  }

  if (payload.kind === "free_modifier") {
    const updated = lineItems.map((li, idx) =>
      idx === 0
        ? {
            ...li,
            modifiers: [
              ...li.modifiers,
              {
                catalog_object_id: payload.modifier_id,
                base_price_money: { amount: 0, currency },
              },
            ],
          }
        : li,
    );
    return { lineItems: updated, discounts: [] };
  }

  // free_drink
  let bestIdx = 0;
  let bestPrice = -1;
  lineItems.forEach((li, idx) => {
    if (li.base_price_money.amount > bestPrice) {
      bestPrice = li.base_price_money.amount;
      bestIdx = idx;
    }
  });
  const discountAmount = Math.min(bestPrice, payload.max_cents);
  const discountUid = `discount-${rollId}`;
  const updated = lineItems.map((li, idx) =>
    idx === bestIdx
      ? {
          ...li,
          applied_discounts: [
            ...(li.applied_discounts ?? []),
            { discount_uid: discountUid },
          ],
        }
      : li,
  );
  return {
    lineItems: updated,
    discounts: [
      {
        uid: discountUid,
        type: "FIXED_AMOUNT",
        name: "Lottery free drink",
        amount_money: { amount: discountAmount, currency },
        scope: "LINE_ITEM",
      },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/lottery/auto-apply.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lottery/auto-apply.ts src/lib/lottery/auto-apply.test.ts
git commit -m "feat(lottery): add digital prize auto-apply payload shaping"
```

### Task 8: Refund void function

**Files:**
- Create: `src/lib/lottery/refund.ts`
- Create: `src/lib/lottery/refund.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/lottery/refund.test.ts
import { describe, expect, it, vi } from "vitest";
import { handleRefundedOrder } from "./refund";

describe("handleRefundedOrder", () => {
  it("voids the prize_roll for a fully-refunded order", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(1000),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(1000),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 1 }),
    };
    const result = await handleRefundedOrder("sq-order-1", deps);
    expect(result.voided).toBe(true);
    expect(deps.voidPrizeRoll).toHaveBeenCalledWith("sq-order-1");
  });

  it("does not void on partial refund", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(1000),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(500),
      voidPrizeRoll: vi.fn(),
    };
    const result = await handleRefundedOrder("sq-order-1", deps);
    expect(result.voided).toBe(false);
    expect(deps.voidPrizeRoll).not.toHaveBeenCalled();
  });

  it("treats refund cents == total cents as full refund", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(789),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(789),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 1 }),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(true);
  });

  it("handles refund cents > total (rare rounding) as full refund", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(789),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(800),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 1 }),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(true);
  });

  it("returns voided=false when no prize_roll was matched (e.g., already voided)", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(1000),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(1000),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 0 }),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(false);
  });

  it("does not throw if order lookup returns null total", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(null),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(500),
      voidPrizeRoll: vi.fn(),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/lottery/refund.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `refund.ts`**

```typescript
// src/lib/lottery/refund.ts

export interface RefundDeps {
  getOrderTotalCents(squareOrderId: string): Promise<number | null>;
  getCumulativeRefundCents(squareOrderId: string): Promise<number>;
  voidPrizeRoll(squareOrderId: string): Promise<{ updated: number }>;
}

export interface RefundResult {
  voided: boolean;
}

export async function handleRefundedOrder(
  squareOrderId: string,
  deps: RefundDeps,
): Promise<RefundResult> {
  const total = await deps.getOrderTotalCents(squareOrderId);
  if (total == null || total <= 0) return { voided: false };
  const refunded = await deps.getCumulativeRefundCents(squareOrderId);
  if (refunded < total) return { voided: false };
  const result = await deps.voidPrizeRoll(squareOrderId);
  return { voided: result.updated > 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/lottery/refund.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lottery/refund.ts src/lib/lottery/refund.test.ts
git commit -m "feat(lottery): add refund-void handler with full-refund gate"
```

### Task 9: Wire roll + auto-apply into `/api/orders` POST

**Files:**
- Modify: `src/app/api/orders/route.ts`

- [ ] **Step 1: Read the current route to identify the integration points**

```bash
cd ~/Github/mandys_bubble_tea
sed -n '1,50p' src/app/api/orders/route.ts
```

Identify the order-creation function and the place where the response object is constructed. Note the existing patterns for Supabase client (`supabase-server.ts`), Square client (`square.ts`), and order body parsing.

- [ ] **Step 2: Add `__source` to the request schema**

Locate the zod (or similar) request body schema in the route. Add an optional `__source: z.enum(["app", "web"]).default("web")` field. If the route uses raw parsing, add a manual default:

```typescript
const source: "app" | "web" = body.__source === "app" ? "app" : "web";
```

- [ ] **Step 3: After Square `createOrder` returns successfully but before payment, run `applyPrizeToOrder` if an active digital prize exists**

Find the section that constructs the Square order request body. Just before the `square.ordersApi.createOrder(...)` call, add:

```typescript
import { applyPrizeToOrder } from "@/lib/lottery/auto-apply";
import type { DigitalPayload } from "@/lib/lottery/types";

// After line items are built and before createOrder:
let appliedPrize: { rollId: string; tier_id: string; label: string } | null = null;
if (source === "app" && userId) {
  const supa = await getSupabaseServerClient();
  const { data: activePrize } = await supa
    .from("prize_rolls")
    .select("id, tier_id, prize_payload, prize_type")
    .eq("user_id", userId)
    .eq("prize_type", "digital")
    .eq("status", "won_active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (activePrize) {
    const result = applyPrizeToOrder(
      lineItems,
      activePrize.prize_payload as DigitalPayload,
      activePrize.id,
    );
    lineItems = result.lineItems;
    discounts = [...(discounts ?? []), ...result.discounts];
    appliedPrize = {
      rollId: activePrize.id,
      tier_id: activePrize.tier_id,
      label: TIER_LABELS[activePrize.tier_id] ?? activePrize.tier_id,
    };
  }
}
```

After Square successfully creates the order and payment is processed, mark the prize redeemed:

```typescript
if (appliedPrize) {
  await supa
    .from("prize_rolls")
    .update({
      status: "redeemed",
      redeemed_order_id: createdSquareOrderId,
    })
    .eq("id", appliedPrize.rollId)
    .eq("status", "won_active");
}
```

- [ ] **Step 4: After payment + loyalty success, call `rollPrize`**

Add at the end of the success path (after loyalty accrual, before constructing the response):

```typescript
import { rollPrize } from "@/lib/lottery/roll";
import { generateUniqueClaimCode } from "@/lib/lottery/claim-code";

let prize: Awaited<ReturnType<typeof rollPrize>> = null;
if (userId) {
  try {
    prize = await rollPrize(
      { userId, squareOrderId: createdSquareOrderId, source },
      {
        getActiveCampaign: async () => {
          const { data } = await supa
            .from("campaigns")
            .select("*")
            .eq("is_active", true)
            .lte("starts_at", new Date().toISOString())
            .gte("ends_at", new Date().toISOString())
            .maybeSingle();
          return data;
        },
        userHasPhysicalLock: async (uid, campaignId) => {
          const { count } = await supa
            .from("prize_rolls")
            .select("id", { count: "exact", head: true })
            .eq("user_id", uid)
            .eq("campaign_id", campaignId)
            .eq("prize_type", "physical")
            .in("status", ["won_active", "claimed", "expired"]);
          return (count ?? 0) > 0;
        },
        insertRoll: async (row) => {
          const { data, error } = await supa
            .from("prize_rolls")
            .insert(row)
            .select("id")
            .single();
          if (error) throw error;
          return { id: data.id as string };
        },
        claimCodeExists: async (code) => {
          const { count } = await supa
            .from("prize_rolls")
            .select("id", { count: "exact", head: true })
            .eq("claim_code", code);
          return (count ?? 0) > 0;
        },
      },
    );
  } catch (err) {
    console.error("[orders] rollPrize failed", err);
    prize = null;
  }
}
```

- [ ] **Step 5: Add `prize` and `appliedPrize` to the response**

Find the final `NextResponse.json({ ... })` and append both fields:

```typescript
return NextResponse.json({
  ...existingFields,
  prize,
  appliedPrize,
});
```

- [ ] **Step 6: Run unit + integration tests for the route**

```bash
npx vitest run src/app/api/orders
```

If route-level integration tests exist, ensure they still pass. If not, defer integration tests to manual TestFlight acceptance — the lottery libraries are already covered by Tasks 3-8.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/orders/route.ts
git commit -m "feat(orders): wire lottery roll and auto-apply into POST /api/orders"
```

### Task 10: Wire `refund.updated` into Square webhook

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`

- [ ] **Step 1: Add the new event branch**

After the existing `if (event.type === "order.updated") { ... }` block, add:

```typescript
import { handleRefundedOrder } from "@/lib/lottery/refund";

if (event.type === "refund.updated") {
  const refund = (event.data?.object as { refund?: { order_id?: string; status?: string } })?.refund;
  if (refund?.status === "COMPLETED" && refund.order_id) {
    try {
      const orderId = refund.order_id;
      const supa = await getSupabaseServerClient();
      await handleRefundedOrder(orderId, {
        getOrderTotalCents: async (sqId) => {
          const { result } = await squareClient.ordersApi.retrieveOrder(sqId);
          const total = result.order?.totalMoney?.amount;
          return total != null ? Number(total) : null;
        },
        getCumulativeRefundCents: async (sqId) => {
          const { result } = await squareClient.ordersApi.retrieveOrder(sqId);
          const refunds = (result.order?.refunds ?? []) as Array<{
            amountMoney?: { amount?: bigint | number };
            status?: string;
          }>;
          let sum = 0;
          for (const r of refunds) {
            if (r.status === "COMPLETED" && r.amountMoney?.amount != null) {
              sum += Number(r.amountMoney.amount);
            }
          }
          return sum;
        },
        voidPrizeRoll: async (sqId) => {
          const { count, error } = await supa
            .from("prize_rolls")
            .update({ status: "voided", voided_at: new Date().toISOString() })
            .eq("square_order_id", sqId)
            .neq("status", "voided")
            .select("id", { count: "exact", head: true });
          if (error) throw error;
          return { updated: count ?? 0 };
        },
      });
    } catch (err) {
      console.error(
        `[square-webhook] refund.updated handler failed event_id=${event.event_id}`,
        err,
      );
    }
  }
}
```

- [ ] **Step 2: Subscribe `refund.updated` in the Square Developer Dashboard**

Manual step — document in the PR description for the operator:

> In Square Developer Dashboard → the existing webhook for `mandybubbletea.com/api/webhooks/square`, add the `refund.updated` event subscription. No new endpoint URL needed.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "feat(webhooks): handle Square refund.updated to void lottery prize"
```

### Task 11: New `/api/campaigns/active` endpoint

**Files:**
- Create: `src/app/api/campaigns/active/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/campaigns/active/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const now = new Date().toISOString();
  const { data, error } = await supa
    .from("campaigns")
    .select("id, name, starts_at, ends_at, prize_pool")
    .eq("is_active", true)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { campaign: data ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 2: Smoke test in dev**

```bash
npm run dev &
DEV_PID=$!
sleep 3
curl -s http://localhost:3000/api/campaigns/active | jq
kill $DEV_PID
```

Expected: `{ "campaign": null }` (no campaign seeded yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/campaigns/active/route.ts
git commit -m "feat(api): add GET /api/campaigns/active endpoint"
```

### Task 12: New `/api/prizes/me` endpoint

**Files:**
- Create: `src/app/api/prizes/me/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/prizes/me/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { TIER_LABELS } from "@/lib/lottery/types";

export async function GET() {
  const supa = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await supa
    .from("prize_rolls")
    .select("id, tier_id, prize_type, expires_at, claim_code")
    .eq("user_id", user.id)
    .eq("status", "won_active")
    .neq("prize_type", "thank_you")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const prizes = (data ?? []).map((row) => ({
    id: row.id,
    tier_id: row.tier_id,
    prize_type: row.prize_type,
    label: TIER_LABELS[row.tier_id] ?? row.tier_id,
    expires_at: row.expires_at,
    claim_code: row.claim_code ?? undefined,
  }));
  return NextResponse.json(
    { prizes },
    { headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 2: Smoke test in dev**

```bash
npm run dev &
DEV_PID=$!
sleep 3
# Without auth cookie → 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/prizes/me
kill $DEV_PID
```

Expected: `401`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/prizes/me/route.ts
git commit -m "feat(api): add GET /api/prizes/me endpoint"
```

### Task 13: Phase 1 verification gate

- [ ] **Step 1: Full unit + typecheck pass**

```bash
cd ~/Github/mandys_bubble_tea
npm run typecheck
npx vitest run src/lib/lottery
npx vitest run
```

Expected: typecheck clean, all lottery tests pass, no regressions in pre-existing tests.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/lottery-prize
```

- [ ] **Step 3: Open PR (do not merge yet)**

Use GitHub CLI:

```bash
gh pr create --title "feat: lottery prize campaign — server core" --body "$(cat <<'EOF'
## Summary
- Adds `campaigns` and `prize_rolls` tables (migration applied to prod via Supabase MCP).
- Adds `src/lib/lottery/*`: types, pool parser, weighted RNG, claim-code generator, roll core, auto-apply, refund void.
- Wires `rollPrize` and `applyPrizeToOrder` into `POST /api/orders`.
- Wires `refund.updated` Square webhook event to void prizes on full refund.
- Adds `GET /api/campaigns/active` and `GET /api/prizes/me` for app consumption.

Spec: `mandys_bubble_tea_app/docs/superpowers/specs/2026-05-04-app-lottery-prize-design.md`

## Test plan
- [x] vitest unit suites green (pool, random, claim-code, roll, auto-apply, refund)
- [ ] After Phase 2 (admin) and Phase 3 (app) merge, seed an `is_active=false` test campaign and run a single end-to-end roll on TestFlight before activation
- [ ] Operator action: subscribe `refund.updated` in Square Developer Dashboard webhook config

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR stays open for review; do **not** merge until the campaign row is ready and admin + app PRs are also up.

---

## Phase 2 — Admin (`mandys_bubble_tea_admin`)

The admin repo reads from the same Supabase project. Migration was already applied in Task 1; admin only needs RLS-aware reads using the existing service-role pattern.

### Task 14: Admin claim lookup endpoint

**Files:**
- Create: `src/app/api/admin/prizes/lookup/route.ts`
- Create: `src/lib/admin-prizes.ts`

- [ ] **Step 1: Implement the helper module**

```typescript
// src/lib/admin-prizes.ts
import { createClient } from "@supabase/supabase-js";

export function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export interface AdminPrizeRow {
  id: string;
  campaign_id: string;
  user_id: string;
  square_order_id: string;
  tier_id: string;
  prize_type: string;
  prize_payload: object;
  status: string;
  expires_at: string | null;
  claim_code: string | null;
  rolled_at: string;
}

export async function lookupByClaimCode(
  code: string,
): Promise<AdminPrizeRow | null> {
  const supa = getServiceClient();
  const { data } = await supa
    .from("prize_rolls")
    .select("*")
    .eq("claim_code", code.toUpperCase())
    .maybeSingle();
  return (data ?? null) as AdminPrizeRow | null;
}

export async function markClaimed(rollId: string): Promise<{ updated: number }> {
  const supa = getServiceClient();
  const { count } = await supa
    .from("prize_rolls")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", rollId)
    .eq("status", "won_active")
    .select("id", { count: "exact", head: true });
  return { updated: count ?? 0 };
}

export interface CustomerInfo {
  first_name: string | null;
  phone_e164: string | null;
}

export async function getCustomerForRoll(
  userId: string,
): Promise<CustomerInfo> {
  const supa = getServiceClient();
  const { data } = await supa
    .from("user_profiles")
    .select("first_name, phone_e164")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as CustomerInfo) ?? { first_name: null, phone_e164: null };
}

export function maskPhone(e164: string | null): string {
  if (!e164) return "—";
  if (e164.length < 7) return e164;
  return `${e164.slice(0, -6)}••${e164.slice(-2)}`;
}
```

- [ ] **Step 2: Implement the API route**

```typescript
// src/app/api/admin/prizes/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminCookie } from "@/lib/admin-auth";
import {
  getCustomerForRoll,
  lookupByClaimCode,
  maskPhone,
} from "@/lib/admin-prizes";

export async function POST(req: NextRequest) {
  const auth = await requireAdminCookie();
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as { claim_code?: string };
  const code = (body.claim_code ?? "").trim();
  if (!code || code.length !== 6) {
    return NextResponse.json(
      { error: "claim_code must be 6 characters" },
      { status: 400 },
    );
  }
  const row = await lookupByClaimCode(code);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.status !== "won_active") {
    return NextResponse.json(
      { error: "not_active", row_status: row.status },
      { status: 409 },
    );
  }
  const customer = await getCustomerForRoll(row.user_id);
  return NextResponse.json({
    prize: {
      id: row.id,
      label: (row.prize_payload as { label?: string }).label ?? row.tier_id,
      tier_id: row.tier_id,
      customer_first_name: customer.first_name,
      customer_phone_masked: maskPhone(customer.phone_e164),
      rolled_at: row.rolled_at,
      expires_at: row.expires_at,
    },
  });
}
```

The exact import path for `requireAdminCookie` mirrors the existing admin auth pattern (per memory `project_mandys_admin_auth_isolation`). If the admin codebase exposes it as `@/lib/admin-auth/require`, adjust the import to match.

- [ ] **Step 3: Run typecheck**

```bash
cd ~/Github/mandys_bubble_tea_admin
npm run typecheck
```

Expected: clean (or surface adjustments needed for the admin-auth import path; fix and re-run).

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin-prizes.ts src/app/api/admin/prizes/lookup/route.ts
git commit -m "feat(admin): add claim-code lookup endpoint and helpers"
```

### Task 15: Admin mark-claimed endpoint

**Files:**
- Create: `src/app/api/admin/prizes/[id]/mark-claimed/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/admin/prizes/[id]/mark-claimed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminCookie } from "@/lib/admin-auth";
import { markClaimed } from "@/lib/admin-prizes";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminCookie();
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await markClaimed(id);
  if (result.updated === 0) {
    return NextResponse.json(
      { error: "already_claimed_or_not_active" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/prizes/[id]/mark-claimed/route.ts
git commit -m "feat(admin): add POST /api/admin/prizes/[id]/mark-claimed"
```

### Task 16: Admin winners list endpoint + stats endpoint

**Files:**
- Create: `src/app/api/admin/campaigns/[id]/winners/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/admin/campaigns/[id]/winners/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminCookie } from "@/lib/admin-auth";
import { getServiceClient, maskPhone } from "@/lib/admin-prizes";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminCookie();
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: campaignId } = await params;
  const supa = getServiceClient();

  const { data: rolls } = await supa
    .from("prize_rolls")
    .select("id, tier_id, prize_type, status, claim_code, rolled_at, expires_at, user_id")
    .eq("campaign_id", campaignId)
    .order("rolled_at", { ascending: false });

  const userIds = Array.from(new Set((rolls ?? []).map((r) => r.user_id)));
  const { data: profiles } = await supa
    .from("user_profiles")
    .select("user_id, first_name, phone_e164")
    .in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      p.user_id,
      { first_name: p.first_name, phone_e164: p.phone_e164 },
    ]),
  );

  const winners = (rolls ?? [])
    .filter((r) => r.prize_type === "physical")
    .map((r) => {
      const p = profileMap.get(r.user_id);
      return {
        id: r.id,
        tier_id: r.tier_id,
        status: r.status,
        claim_code: r.claim_code,
        rolled_at: r.rolled_at,
        expires_at: r.expires_at,
        customer_first_name: p?.first_name ?? null,
        customer_phone_masked: maskPhone(p?.phone_e164 ?? null),
      };
    });

  const stats: Record<string, { count: number; status: Record<string, number> }> = {};
  for (const r of rolls ?? []) {
    const tier = stats[r.tier_id] ?? { count: 0, status: {} };
    tier.count++;
    tier.status[r.status] = (tier.status[r.status] ?? 0) + 1;
    stats[r.tier_id] = tier;
  }

  return NextResponse.json({ winners, stats });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/campaigns/[id]/winners/route.ts
git commit -m "feat(admin): add GET /api/admin/campaigns/[id]/winners"
```

### Task 17: Winners page UI

**Files:**
- Create: `src/app/campaigns/[id]/winners/page.tsx`
- Create: `src/app/campaigns/[id]/winners/WinnerLookup.tsx`
- Create: `src/app/campaigns/[id]/winners/WinnerStats.tsx`

- [ ] **Step 1: Implement `WinnerLookup.tsx`**

```typescript
// src/app/campaigns/[id]/winners/WinnerLookup.tsx
"use client";

import { useState } from "react";

interface Prize {
  id: string;
  label: string;
  tier_id: string;
  customer_first_name: string | null;
  customer_phone_masked: string;
  rolled_at: string;
  expires_at: string | null;
}

export function WinnerLookup() {
  const [code, setCode] = useState("");
  const [prize, setPrize] = useState<Prize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);

  async function lookup() {
    setError(null);
    setPrize(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/prizes/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim_code: code.trim().toUpperCase() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(
          res.status === 404
            ? "Code not found"
            : res.status === 409
            ? `Already ${body.error?.replace("not_active", "claimed/expired/voided")}`
            : "Lookup failed",
        );
        return;
      }
      const body = (await res.json()) as { prize: Prize };
      setPrize(body.prize);
    } finally {
      setBusy(false);
    }
  }

  async function markClaimed() {
    if (!prize) return;
    setMarking(true);
    try {
      const res = await fetch(`/api/admin/prizes/${prize.id}/mark-claimed`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Mark claimed failed (possibly already claimed)");
        return;
      }
      setPrize(null);
      setCode("");
      setError(null);
      alert("Marked claimed.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
      <h3>Lookup by claim code</h3>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="6-character code"
        maxLength={6}
        style={{ fontSize: 24, padding: 8, width: 180, fontFamily: "monospace" }}
      />
      <button onClick={lookup} disabled={busy || code.length !== 6} style={{ marginLeft: 8 }}>
        {busy ? "Looking up…" : "Lookup"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {prize && (
        <div style={{ marginTop: 16, padding: 12, background: "#fafafa" }}>
          <div><strong>{prize.label}</strong></div>
          <div>Customer: {prize.customer_first_name ?? "(no name)"} {prize.customer_phone_masked}</div>
          <div>Rolled: {new Date(prize.rolled_at).toLocaleString()}</div>
          {prize.expires_at && (
            <div>Expires: {new Date(prize.expires_at).toLocaleString()}</div>
          )}
          <button
            onClick={markClaimed}
            disabled={marking}
            style={{
              marginTop: 12,
              background: "#C43A10",
              color: "white",
              padding: "8px 16px",
              border: "none",
              borderRadius: 4,
            }}
          >
            {marking ? "Marking…" : "Mark claimed"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement `WinnerStats.tsx`**

```typescript
// src/app/campaigns/[id]/winners/WinnerStats.tsx
"use client";

import { useEffect, useState } from "react";

type Stats = Record<string, { count: number; status: Record<string, number> }>;

interface Winner {
  id: string;
  tier_id: string;
  status: string;
  claim_code: string | null;
  rolled_at: string;
  expires_at: string | null;
  customer_first_name: string | null;
  customer_phone_masked: string;
}

export function WinnerStats({ campaignId }: { campaignId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/winners`);
      if (res.ok) {
        const body = (await res.json()) as { stats: Stats; winners: Winner[] };
        setStats(body.stats);
        setWinners(body.winners);
      }
      setLoading(false);
    }
    load();
  }, [campaignId]);

  if (loading) return <div>Loading…</div>;

  return (
    <div>
      <h3>Roll distribution</h3>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ background: "#eee" }}>
            <th style={{ textAlign: "left", padding: 8 }}>Tier</th>
            <th style={{ textAlign: "right", padding: 8 }}>Total rolls</th>
            <th style={{ textAlign: "left", padding: 8 }}>By status</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(stats ?? {}).map(([tier, info]) => (
            <tr key={tier} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{tier}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{info.count}</td>
              <td style={{ padding: 8 }}>
                {Object.entries(info.status)
                  .map(([s, n]) => `${s}: ${n}`)
                  .join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 32 }}>Physical winners</h3>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ background: "#eee" }}>
            <th style={{ textAlign: "left", padding: 8 }}>Code</th>
            <th style={{ textAlign: "left", padding: 8 }}>Tier</th>
            <th style={{ textAlign: "left", padding: 8 }}>Customer</th>
            <th style={{ textAlign: "left", padding: 8 }}>Status</th>
            <th style={{ textAlign: "left", padding: 8 }}>Rolled</th>
          </tr>
        </thead>
        <tbody>
          {winners.map((w) => (
            <tr key={w.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8, fontFamily: "monospace" }}>{w.claim_code}</td>
              <td style={{ padding: 8 }}>{w.tier_id}</td>
              <td style={{ padding: 8 }}>
                {w.customer_first_name ?? "—"} {w.customer_phone_masked}
              </td>
              <td style={{ padding: 8 }}>{w.status}</td>
              <td style={{ padding: 8 }}>
                {new Date(w.rolled_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Implement `page.tsx`**

```typescript
// src/app/campaigns/[id]/winners/page.tsx
import { WinnerLookup } from "./WinnerLookup";
import { WinnerStats } from "./WinnerStats";

export default async function WinnersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1>Lottery Campaign Winners</h1>
      <p>Campaign: <code>{id}</code></p>
      <WinnerLookup />
      <hr style={{ margin: "32px 0" }} />
      <WinnerStats campaignId={id} />
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Smoke test in dev**

```bash
npm run dev &
DEV_PID=$!
sleep 3
# Should require admin auth — open in browser, sign in, then navigate to /campaigns/<any-uuid>/winners
# Lookup with non-existent code returns "Code not found"
kill $DEV_PID
```

- [ ] **Step 6: Commit**

```bash
git add src/app/campaigns/[id]/winners/
git commit -m "feat(admin): add /campaigns/[id]/winners read-only page"
```

### Task 18: Phase 2 verification gate

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin feat/lottery-prize-winners
gh pr create --title "feat(admin): lottery prize winners page" --body "$(cat <<'EOF'
## Summary
- Adds `/campaigns/[id]/winners` page with claim-code lookup and stats.
- Adds `/api/admin/prizes/lookup`, `/api/admin/prizes/[id]/mark-claimed`, `/api/admin/campaigns/[id]/winners` endpoints.
- Reads from `prize_rolls` table created by web migration.

Spec: `mandys_bubble_tea_app/docs/superpowers/specs/2026-05-04-app-lottery-prize-design.md`

## Test plan
- [x] Typecheck clean.
- [ ] Manual smoke after web PR (Phase 1) merges and a test campaign row is seeded.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR stays open until Phase 1 merges and a test campaign exists.

---

## Phase 3 — App (`mandys_bubble_tea_app`)

### Task 19: `lib/api.ts` adds `__source: "app"` field

**Files:**
- Modify: `lib/api.ts`

- [ ] **Step 1: Locate the order POST helper**

```bash
cd ~/Github/mandys_bubble_tea_app
grep -n "api/orders" lib/api.ts
```

- [ ] **Step 2: Add `__source: "app"` to the POST body**

In whichever helper sends the order (typically `placeOrder` or `submitOrder`), inject `__source: "app"` into the request body before serialization. Example:

```typescript
async function placeOrder(payload: OrderPayload) {
  const body = { ...payload, __source: "app" as const };
  const res = await fetch(`${API_BASE}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  // ... existing handling
}
```

The exact existing function name and surrounding code must be matched. Update only the body construction.

- [ ] **Step 3: Update return type to include `prize` and `appliedPrize`**

```typescript
export interface PlaceOrderResponse {
  // ...existing fields
  prize: PrizeReveal | null;
  appliedPrize: { rollId: string; tier_id: string; label: string } | null;
}

export interface PrizeReveal {
  rollId: string;
  tier_id: string;
  prize_type: "thank_you" | "digital" | "physical";
  label: string;
  payload: Record<string, unknown>;
  claim_code?: string;
  expires_at: string | null;
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/api.ts
git commit -m "feat(api): tag app orders with __source=app and accept prize fields in response"
```

### Task 20: `lib/prizes.ts` fetch helper

**Files:**
- Create: `lib/prizes.ts`

- [ ] **Step 1: Implement the helper**

```typescript
// lib/prizes.ts
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "https://mandybubbletea.com";

export interface ActivePrize {
  id: string;
  tier_id: string;
  prize_type: "digital" | "physical";
  label: string;
  expires_at: string;
  claim_code?: string;
}

export async function fetchActivePrizes(): Promise<ActivePrize[]> {
  const res = await fetch(`${API_BASE}/api/prizes/me`, { credentials: "include" });
  if (res.status === 401) return [];
  if (!res.ok) throw new Error(`prizes fetch failed: ${res.status}`);
  const body = (await res.json()) as { prizes: ActivePrize[] };
  return body.prizes;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/prizes.ts
git commit -m "feat(prizes): add fetchActivePrizes helper"
```

### Task 21: Confetti component

**Files:**
- Create: `components/prize/Confetti.tsx`

- [ ] **Step 1: Implement the confetti**

```typescript
// components/prize/Confetti.tsx
import { useEffect } from "react";
import { Dimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const COLORS = ["#C43A10", "#F5E6C8", "#F4B41A", "#E07A5F", "#8FBF9F"];
const COUNT = 40;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

interface Particle {
  startX: number;
  delay: number;
  duration: number;
  rotateEnd: number;
  color: string;
  size: number;
}

const PARTICLES: Particle[] = Array.from({ length: COUNT }).map((_, i) => ({
  startX: Math.random() * SCREEN_W,
  delay: Math.random() * 600,
  duration: 1800 + Math.random() * 1200,
  rotateEnd: 360 + Math.random() * 720,
  color: COLORS[i % COLORS.length]!,
  size: 6 + Math.random() * 8,
}));

function Piece({ p }: { p: Particle }) {
  const fall = useSharedValue(0);
  const rot = useSharedValue(0);

  useEffect(() => {
    fall.value = withDelay(
      p.delay,
      withTiming(1, { duration: p.duration, easing: Easing.out(Easing.cubic) }),
    );
    rot.value = withRepeat(
      withTiming(p.rotateEnd, { duration: p.duration, easing: Easing.linear }),
      -1,
      false,
    );
  }, [fall, rot, p.delay, p.duration, p.rotateEnd]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: fall.value * SCREEN_H * 1.1 },
      { translateX: Math.sin(fall.value * Math.PI * 2) * 20 },
      { rotate: `${rot.value}deg` },
    ],
    opacity: fall.value < 0.9 ? 1 : 1 - (fall.value - 0.9) * 10,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: -20,
          left: p.startX,
          width: p.size,
          height: p.size * 1.4,
          backgroundColor: p.color,
          borderRadius: 2,
        },
        style,
      ]}
    />
  );
}

export function Confetti() {
  return (
    <View pointerEvents="none" style={{ ...absoluteFill, zIndex: 100 }}>
      {PARTICLES.map((p, i) => (
        <Piece key={i} p={p} />
      ))}
    </View>
  );
}

const absoluteFill = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/prize/Confetti.tsx
git commit -m "feat(prize): add Confetti reanimated particle component"
```

### Task 22: PrizeRevealModal component

**Files:**
- Create: `components/prize/PrizeRevealModal.tsx`
- Create: `components/prize/__tests__/PrizeRevealModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// components/prize/__tests__/PrizeRevealModal.test.tsx
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PrizeRevealModal } from "../PrizeRevealModal";

describe("PrizeRevealModal", () => {
  it("renders thank_you variant with no confetti", () => {
    render(
      <PrizeRevealModal
        prize={{
          rollId: "r1",
          tier_id: "thank_you",
          prize_type: "thank_you",
          label: "Better luck next sip!",
          payload: {},
          expires_at: null,
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Better luck next sip!")).toBeTruthy();
    expect(screen.queryByTestId("confetti")).toBeNull();
  });

  it("renders digital variant with confetti and auto-apply note", () => {
    render(
      <PrizeRevealModal
        prize={{
          rollId: "r2",
          tier_id: "discount_3",
          prize_type: "digital",
          label: "$3 off your next order",
          payload: { kind: "discount", amount_cents: 300 },
          expires_at: "2026-06-04T00:00:00Z",
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("$3 off your next order")).toBeTruthy();
    expect(screen.getByText(/Auto-applies/i)).toBeTruthy();
    expect(screen.getByTestId("confetti")).toBeTruthy();
  });

  it("renders physical variant with claim code and QR", () => {
    render(
      <PrizeRevealModal
        prize={{
          rollId: "r3",
          tier_id: "sticker",
          prize_type: "physical",
          label: "Mandy's brand sticker",
          payload: { label: "Mandy's brand sticker" },
          claim_code: "7K3X9P",
          expires_at: "2026-05-11T00:00:00Z",
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Mandy's brand sticker")).toBeTruthy();
    expect(screen.getByText("7K3X9P")).toBeTruthy();
    expect(screen.getByTestId("claim-qr")).toBeTruthy();
  });

  it("calls onDismiss when the action button is pressed", () => {
    const onDismiss = jest.fn();
    render(
      <PrizeRevealModal
        prize={{
          rollId: "r4",
          tier_id: "thank_you",
          prize_type: "thank_you",
          label: "x",
          payload: {},
          expires_at: null,
        }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(screen.getByTestId("prize-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("returns null when prize is null", () => {
    const { toJSON } = render(
      <PrizeRevealModal prize={null} onDismiss={() => {}} />,
    );
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest components/prize/__tests__/PrizeRevealModal.test.tsx
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `PrizeRevealModal.tsx`**

```typescript
// components/prize/PrizeRevealModal.tsx
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Confetti } from "./Confetti";

export interface PrizeReveal {
  rollId: string;
  tier_id: string;
  prize_type: "thank_you" | "digital" | "physical";
  label: string;
  payload: Record<string, unknown>;
  claim_code?: string;
  expires_at: string | null;
}

interface Props {
  prize: PrizeReveal | null;
  onDismiss: () => void;
}

export function PrizeRevealModal({ prize, onDismiss }: Props) {
  if (!prize) return null;

  const isThankYou = prize.prize_type === "thank_you";
  const isPhysical = prize.prize_type === "physical";
  const bg = isThankYou ? "#EAEAEA" : isPhysical ? "#F5E6C8" : "#C43A10";
  const fg = isThankYou ? "#333" : isPhysical ? "#333" : "#fff";

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        {!isThankYou && (
          <View testID="confetti">
            <Confetti />
          </View>
        )}
        <Pressable style={[styles.card, { backgroundColor: bg }]} onPress={() => {}}>
          <Text style={[styles.headline, { color: fg }]}>
            {isThankYou ? "Aww!" : "🎉 You won!"}
          </Text>
          <Text style={[styles.label, { color: fg }]}>{prize.label}</Text>
          {prize.prize_type === "digital" && (
            <Text style={[styles.note, { color: fg }]}>
              Auto-applies on your next order
            </Text>
          )}
          {isPhysical && prize.claim_code && (
            <View style={styles.claim}>
              <Text style={styles.claimCode}>{prize.claim_code}</Text>
              <View testID="claim-qr">
                <QRCode value={`mandybt-claim:${prize.claim_code}`} size={140} />
              </View>
              <Text style={styles.claimNote}>Show at the counter within 7 days</Text>
            </View>
          )}
          <Pressable
            testID="prize-dismiss"
            style={[styles.button, { backgroundColor: isThankYou ? "#333" : "#fff" }]}
            onPress={onDismiss}
          >
            <Text style={[styles.buttonLabel, { color: isThankYou ? "#fff" : "#C43A10" }]}>
              {isThankYou ? "Got it" : "Sweet!"}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
  },
  headline: { fontSize: 26, fontWeight: "700", marginBottom: 12 },
  label: { fontSize: 22, fontWeight: "600", textAlign: "center" },
  note: { fontSize: 14, marginTop: 12, opacity: 0.8 },
  claim: { marginTop: 18, alignItems: "center" },
  claimCode: {
    fontFamily: "Menlo",
    fontSize: 32,
    letterSpacing: 4,
    marginBottom: 16,
    color: "#333",
  },
  claimNote: { marginTop: 12, fontSize: 13, color: "#555" },
  button: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest components/prize/__tests__/PrizeRevealModal.test.tsx
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/prize/PrizeRevealModal.tsx components/prize/__tests__/PrizeRevealModal.test.tsx
git commit -m "feat(prize): add PrizeRevealModal with three prize-type variants"
```

### Task 23: Wire `PrizeRevealModal` into order-confirmation

**Files:**
- Modify: `app/order-confirmation.tsx`

- [ ] **Step 1: Read the existing route to identify where the order data is loaded**

```bash
cd ~/Github/mandys_bubble_tea_app
grep -n "useLocalSearchParams\|useEffect\|orderId" app/order-confirmation.tsx | head -20
```

- [ ] **Step 2: Add prize-reveal state and side-effect**

The order POST response now carries `prize`. Capture it in the route's state. The order-confirmation route receives the orderId from search params and fetches order detail; the route flow likely already has access to the place-order response via navigation params or a state store. Adapt to whichever pattern is in place. Concrete addition:

```typescript
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PrizeRevealModal, type PrizeReveal } from "@/components/prize/PrizeRevealModal";

// Within the screen component:
const [prize, setPrize] = useState<PrizeReveal | null>(null);

useEffect(() => {
  // `placeOrderResponse.prize` is the field added in Task 19; how it's reached
  // depends on the existing navigation pattern. If the response is in
  // route params:
  const incoming = (params.prize ? JSON.parse(params.prize as string) : null) as PrizeReveal | null;
  if (!incoming) return;
  (async () => {
    const seenKey = `prize_seen_${incoming.rollId}`;
    const seen = await AsyncStorage.getItem(seenKey);
    if (seen) return;
    setPrize(incoming);
  })();
}, [params.prize]);

async function handleDismiss() {
  if (prize) {
    await AsyncStorage.setItem(`prize_seen_${prize.rollId}`, "1");
  }
  setPrize(null);
}

// In the JSX:
<PrizeRevealModal prize={prize} onDismiss={handleDismiss} />
```

If the existing checkout flow stores the order response in a Zustand or Context store, read from there instead of search params — but the dedupe via `AsyncStorage` and the modal mount remain identical.

- [ ] **Step 3: At the checkout call site, forward `prize` into the navigation**

In whichever screen calls `placeOrder()` (likely `app/checkout.tsx`), serialize the `prize` field into the navigation params for `order-confirmation`:

```typescript
const result = await placeOrder(payload);
router.replace({
  pathname: "/order-confirmation",
  params: {
    orderId: result.orderId,
    prize: result.prize ? JSON.stringify(result.prize) : "",
  },
});
```

- [ ] **Step 4: Run jest**

```bash
npx jest
```

Expected: existing tests still pass; new modal tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/order-confirmation.tsx app/checkout.tsx
git commit -m "feat(checkout): wire PrizeRevealModal on order-confirmation with seen-key dedupe"
```

### Task 24: ActivePrizes component

**Files:**
- Create: `components/account/ActivePrizes.tsx`
- Create: `components/account/__tests__/ActivePrizes.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// components/account/__tests__/ActivePrizes.test.tsx
import { render, screen, waitFor } from "@testing-library/react-native";
import { ActivePrizes } from "../ActivePrizes";
import * as prizesLib from "@/lib/prizes";

jest.mock("@/lib/prizes");

describe("ActivePrizes", () => {
  beforeEach(() => jest.resetAllMocks());

  it("renders nothing when there are no prizes", async () => {
    (prizesLib.fetchActivePrizes as jest.Mock).mockResolvedValue([]);
    const { toJSON } = render(<ActivePrizes />);
    await waitFor(() => {
      expect(toJSON()).toBeNull();
    });
  });

  it("renders a digital prize card", async () => {
    (prizesLib.fetchActivePrizes as jest.Mock).mockResolvedValue([
      {
        id: "p1",
        tier_id: "discount_3",
        prize_type: "digital",
        label: "$3 off your next order",
        expires_at: "2026-06-04T00:00:00Z",
      },
    ]);
    render(<ActivePrizes />);
    await waitFor(() =>
      expect(screen.getByText("$3 off your next order")).toBeTruthy(),
    );
    expect(screen.getByText(/Auto-applies/i)).toBeTruthy();
  });

  it("renders a physical prize card with claim code", async () => {
    (prizesLib.fetchActivePrizes as jest.Mock).mockResolvedValue([
      {
        id: "p2",
        tier_id: "sticker",
        prize_type: "physical",
        label: "Mandy's brand sticker",
        expires_at: "2026-05-11T00:00:00Z",
        claim_code: "7K3X9P",
      },
    ]);
    render(<ActivePrizes />);
    await waitFor(() => expect(screen.getByText("7K3X9P")).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest components/account/__tests__/ActivePrizes.test.tsx
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `ActivePrizes.tsx`**

```typescript
// components/account/ActivePrizes.tsx
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { fetchActivePrizes, type ActivePrize } from "@/lib/prizes";

export function ActivePrizes() {
  const [prizes, setPrizes] = useState<ActivePrize[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await fetchActivePrizes();
        if (!cancelled) setPrizes(list);
      } catch {
        if (!cancelled) setPrizes([]);
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!prizes || prizes.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Your active prizes</Text>
      {prizes.map((p) => {
        const days = Math.ceil(
          (new Date(p.expires_at).getTime() - Date.now()) / 86_400_000,
        );
        const expiresIn = days <= 0 ? "today" : `${days}d`;
        return (
          <View key={p.id} style={[styles.card, p.prize_type === "physical" ? styles.physicalCard : styles.digitalCard]}>
            <Text style={styles.label}>{p.label}</Text>
            {p.prize_type === "digital" ? (
              <Text style={styles.note}>Auto-applies on your next order · expires in {expiresIn}</Text>
            ) : (
              <View style={styles.physicalContent}>
                <Text style={styles.code}>{p.claim_code}</Text>
                {p.claim_code && <QRCode value={`mandybt-claim:${p.claim_code}`} size={72} />}
                <Text style={styles.note}>Show at the counter · expires in {expiresIn}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: 16, paddingHorizontal: 16 },
  heading: { fontSize: 18, fontWeight: "600", marginBottom: 8, color: "#333" },
  card: { padding: 16, borderRadius: 16, marginBottom: 10 },
  digitalCard: { backgroundColor: "#FFE9D6" },
  physicalCard: { backgroundColor: "#F5E6C8" },
  label: { fontSize: 16, fontWeight: "600", color: "#333" },
  note: { fontSize: 12, color: "#666", marginTop: 6 },
  physicalContent: { marginTop: 8, alignItems: "flex-start" },
  code: {
    fontFamily: "Menlo",
    fontSize: 24,
    letterSpacing: 3,
    color: "#333",
    marginBottom: 8,
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest components/account/__tests__/ActivePrizes.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/account/ActivePrizes.tsx components/account/__tests__/ActivePrizes.test.tsx
git commit -m "feat(account): add ActivePrizes section"
```

### Task 25: Insert ActivePrizes section into account tab

**Files:**
- Modify: `app/(tabs)/account.tsx`

- [ ] **Step 1: Read the existing account tab to identify where LoyaltyCard sits**

```bash
grep -n "LoyaltyCard\|How it works" app/\(tabs\)/account.tsx | head
```

- [ ] **Step 2: Import and render `ActivePrizes` between LoyaltyCard and the "How it works" box**

```typescript
import { ActivePrizes } from "@/components/account/ActivePrizes";

// In the JSX:
<LoyaltyCard ... />
<ActivePrizes />
{/* ...existing "How it works" box... */}
```

Render even when no phone is saved — `ActivePrizes` returns null when the API responds 401 or empty.

- [ ] **Step 3: Run typecheck and tests**

```bash
npm run typecheck
npx jest
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/account.tsx
git commit -m "feat(account): show active prizes on account tab"
```

### Task 26: "Used" line on order-detail receipt

**Files:**
- Modify: `app/order-detail.tsx`

- [ ] **Step 1: Find where the receipt totals/discounts are rendered**

```bash
grep -n "discount\|surcharge\|total" app/order-detail.tsx | head
```

- [ ] **Step 2: Add a render branch for `appliedPrize`**

If the order-detail screen already loads order metadata from `/api/orders/[id]` and the response includes `appliedPrize`, surface a "Used: <label>" line under the line-item totals. If the existing endpoint does not include this field, the simplest path is to surface it from the place-order response stored in app state on the confirmation screen, then forward to order-detail when navigating between them. Otherwise, extend `/api/orders/[id]` (web side) with an extra Supabase lookup.

For V1 the following minimal addition keeps the path local: read `appliedPrize` from `useLocalSearchParams()` (passed forward from `order-confirmation`):

```typescript
const params = useLocalSearchParams<{ appliedPrize?: string }>();
const applied = params.appliedPrize ? JSON.parse(params.appliedPrize) : null;

// In the totals section:
{applied && (
  <View style={styles.usedRow}>
    <Text style={styles.usedLabel}>✓ Used: {applied.label}</Text>
  </View>
)}
```

A V2 follow-up will plumb `appliedPrize` through the order-detail API so the line survives navigation outside of the just-placed flow. V1 surfaces it only on the immediate post-purchase view, which covers the Acceptance Criteria.

- [ ] **Step 3: Forward `appliedPrize` from checkout into navigation params (mirror Task 23)**

```typescript
router.replace({
  pathname: "/order-confirmation",
  params: {
    orderId: result.orderId,
    prize: result.prize ? JSON.stringify(result.prize) : "",
    appliedPrize: result.appliedPrize ? JSON.stringify(result.appliedPrize) : "",
  },
});
```

And from order-confirmation when the user taps "View details" (or however the route transitions):

```typescript
router.push({
  pathname: "/order-detail",
  params: { orderId, appliedPrize: params.appliedPrize ?? "" },
});
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/order-detail.tsx app/order-confirmation.tsx app/checkout.tsx
git commit -m "feat(order-detail): show 'Used: <prize>' line when appliedPrize is forwarded"
```

### Task 27: Phase 3 verification gate

- [ ] **Step 1: Full app typecheck and jest pass**

```bash
cd ~/Github/mandys_bubble_tea_app
npm run typecheck
npx jest
```

Expected: clean.

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feat/lottery-prize
gh pr create --title "feat(app): lottery prize reveal + active prizes section" --body "$(cat <<'EOF'
## Summary
- Adds `__source: "app"` to order POST.
- Adds `lib/prizes.ts` and `GET /api/prizes/me` consumer.
- Adds `Confetti`, `PrizeRevealModal`, `ActivePrizes` components.
- Wires modal into order-confirmation with `AsyncStorage` seen-key dedupe.
- Wires "Used:" line into order-detail.

Spec: `docs/superpowers/specs/2026-05-04-app-lottery-prize-design.md`

## Test plan
- [x] jest unit suites green (PrizeRevealModal, ActivePrizes).
- [ ] After all three PRs merge and a test campaign is seeded with `is_active=true`, run a TestFlight order to verify confetti modal fires; second order auto-applies digital prize and shows "Used:" line; ActivePrizes section reflects the active prize.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: TestFlight build coordination**

Once the app PR is merged, bump the build number, archive, and submit to TestFlight. Per the existing app deployment pattern (do not run `expo prebuild --clean`), the manual Xcode flow is:

```
1. Open ios/mandysbubbleteaapp.xcworkspace in Xcode.
2. Bump CURRENT_PROJECT_VERSION (build number) by 1; leave MARKETING_VERSION alone.
3. Product → Clean Build Folder (Cmd+Shift+K).
4. Product → Archive.
5. Organizer → Distribute App → ASC TestFlight → Upload.
6. Wait for ASC processing → install on device.
```

Refer to the app repo's existing `.claude/deployment.md` for any updates to the flow.

---

## Phase 4 — Activate

### Task 28: Seed the first campaign and run end-to-end acceptance

**Files:**
- (No code changes; SQL seeded via Supabase Studio or MCP)

- [ ] **Step 1: Decide real-world campaign parameters with the operator (Mandy)**

Confirm:
- Campaign name (e.g., "May 2026 Soft Launch").
- Start and end timestamps (in `Australia/Brisbane`, store as UTC).
- The exact Square modifier ID for "free topping". Look it up in Square Dashboard → Catalog → Modifiers; pick one default topping (e.g., Pearl).
- Updated prize labels for any tiers Mandy wants reworded.

- [ ] **Step 2: INSERT the campaign row via Supabase MCP (or Studio)**

```sql
insert into public.campaigns (name, starts_at, ends_at, prize_pool, is_active)
values (
  'May 2026 Soft Launch',
  '2026-05-08T00:00:00+10:00',
  '2026-05-22T23:59:59+10:00',
  '[
    { "tier_id": "thank_you",    "weight": 50, "type": "thank_you", "payload": {} },
    { "tier_id": "free_topping", "weight": 20, "type": "digital",
      "payload": { "kind": "free_modifier", "modifier_id": "REPLACE_ME_REAL_SQUARE_MOD_ID" } },
    { "tier_id": "discount_3",   "weight": 15, "type": "digital",
      "payload": { "kind": "discount", "amount_cents": 300 } },
    { "tier_id": "sticker",      "weight": 10, "type": "physical",
      "payload": { "label": "Mandy''s brand sticker" } },
    { "tier_id": "discount_5",   "weight":  4, "type": "digital",
      "payload": { "kind": "discount", "amount_cents": 500 } },
    { "tier_id": "free_drink",   "weight":  1, "type": "digital",
      "payload": { "kind": "free_drink", "max_cents": 1000 } }
  ]'::jsonb,
  true
);
```

The `campaigns_one_active` partial unique index allows only one `is_active=true` row at a time. To activate a different campaign later, set the current one to `is_active=false` first.

- [ ] **Step 3: Verify the campaign is live**

```bash
curl -s https://mandybubbletea.com/api/campaigns/active | jq
```

Expected: `{ "campaign": { "id": "...", "name": "May 2026 Soft Launch", ... } }`.

- [ ] **Step 4: Acceptance run on TestFlight**

Per the spec's Acceptance Criteria section, run each in production:

1. App order → confetti modal fires with one of the variants.
2. Web order at `mandybubbletea.com` → no `prize` field; no modal.
3. After winning a digital prize, second app order → totalMoney reflects discount + receipt shows "Used:".
4. After winning a physical prize → ActivePrizes card shows code + QR; admin lookup at `admin.mandybubbletea.com/campaigns/<id>/winners` finds the row; "Mark claimed" flips status; ActivePrizes refresh removes the card.
5. Refund the trigger order in Square Dashboard → `prize_rolls.status` flips to `voided`; user can win physical again on subsequent order.
6. After winning physical, attempt another order during same campaign → physical tier is masked (only digital or thank_you results possible).
7. p95 of `/api/orders` POST stays within budget (use Vercel logs to confirm < 250ms added).

If any acceptance step fails, file a follow-up task and roll back via `UPDATE campaigns SET is_active=false`.

- [ ] **Step 5: Update DEV_QUEUE.md**

After acceptance passes, add an entry to `~/system/DEV_QUEUE.md` under Mandy's Bubble Tea App section noting the V1 lottery is live, with a follow-up parking lot for V2 enhancements (user topping choice at redemption, push reminders before expiry, admin self-service campaign authoring, web-channel rollout, multi-tier physical, soon-to-expire push, etc.).

---

## Self-Review Notes

This section is the plan author's check; the implementer should re-read the spec before each phase and confirm all sections still map to a task.

**Spec coverage map:**

| Spec section | Implemented in |
|--------------|----------------|
| Decisions table | All tasks (cumulative) |
| Prize Pool defaults | Task 28 (seed) |
| `campaigns` schema | Task 1 |
| `prize_rolls` schema | Task 1 |
| Cross-repo responsibilities | Tasks 1-27 (split per repo) |
| Flow A — order roll | Tasks 6, 9 |
| Flow B — auto-apply | Tasks 7, 9 |
| Flow C — physical claim | Tasks 14, 15, 17, 22, 24 |
| Flow D — refund void | Tasks 8, 10 |
| Flow E — physical-cap mask | Task 6 |
| `PrizeRevealModal` | Task 22 |
| Account "Active prizes" section | Tasks 24, 25 |
| Order receipt "Used" line | Task 26 |
| `POST /api/orders` (modified) | Task 9 |
| `GET /api/campaigns/active` | Task 11 |
| `GET /api/prizes/me` | Task 12 |
| Admin claim endpoints | Tasks 14-16 |
| Error handling | Distributed across Tasks 6-10 (try/catch + status guards in DB updates) |
| Testing strategy | Tasks 3-8 (vitest), Tasks 22, 24 (jest); manual TestFlight acceptance in Task 28 |
| Migration & deployment sequence | PF1-PF4 + per-phase verification gates |
| Branch strategy | PF1-PF4 |
| Acceptance criteria | Task 28 |

**Type/signature consistency:**

- `PrizeReveal` shape declared once in `lib/api.ts` (app, Task 19) and `PrizeRevealModal.tsx` (Task 22) — confirm they match before running tests in Task 22.
- `applyPrizeToOrder` returns `{ lineItems, discounts }` — same shape consumed in Task 9.
- `rollPrize` returns `RollResult | null` — same shape returned to client in Task 9 response.
- `claim_code` is `string | undefined` in the app types but `string | null` in the database row; the API response normalizes null → undefined (Task 12).
- `appliedPrize` is `{ rollId, tier_id, label } | null` consistently in web response (Task 9), app response type (Task 19), and order-detail render (Task 26).

---

**Plan complete and saved to `~/Github/mandys_bubble_tea_app/docs/superpowers/plans/2026-05-04-app-lottery-prize.md`.**

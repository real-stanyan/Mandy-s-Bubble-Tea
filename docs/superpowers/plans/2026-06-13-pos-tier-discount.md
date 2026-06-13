# POS In-Store Tier Discount (Gold/Diamond 5%) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gold/Diamond members automatically get 5% off at the physical POS when staff attach them to a sale, via Square customer groups + a catalog pricing rule, synced from the existing loyalty webhook.

**Architecture:** A pure planning function maps `lifetimePoints` + current group membership to add/remove operations; an executor applies them through an injected Square client (dependency injection because `@/lib/square` is `server-only` and the ops scripts run under tsx). The existing `loyalty.account.updated` webhook handler gains a second, independently-try/caught step that calls the executor. Two committed tsx scripts handle one-time Square resource setup and backfill/reconcile.

**Tech Stack:** Next.js App Router API routes, Square SDK v44 (`square` npm), vitest, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-06-13-pos-tier-discount-design.md`

**Square SDK v44 facts (verified against `node_modules/square` typings — do not "correct" these):**
- `client.customers.groups.create({ group: { name } })`, `.add({ customerId, groupId })`, `.remove({ customerId, groupId })` — flat camelCase requests.
- `client.customers.groups.list({})` returns a `Page` wrapper: read `page.response.groups`, NOT `page.groups` (compiles but is always empty — known prod trap).
- `client.catalog.search({ objectTypes: [...] })` and `client.catalog.batchUpsert({...})` return `HttpResponsePromise` — await directly, body fields are camelCase (`objects`, `idMappings`).
- Catalog object fields: `discountData.discountType: "FIXED_PERCENTAGE"`, `discountData.percentage: "5.0"` (string, no % sign), `productSetData.allProducts: true`, `pricingRuleData.{discountId, matchProductsId, customerGroupIdsAny}`.
- `client.customers.get({ customerId })` → `{ customer?: { groupIds?: string[] | null } }`.
- `client.loyalty.accounts.get({ accountId })` → `{ loyaltyAccount?: { lifetimePoints?: number } }`.
- `@/lib/square` imports `"server-only"` — NEVER import it (even transitively) from `scripts/*`; scripts construct their own `SquareClient` (see `scripts/backfill-loyalty-safe.mjs` for the idiom).
- `src/lib/tier-group-sync.ts` must import `./membership-tier` with a RELATIVE path (not `@/lib/...`) so tsx scripts can import it without alias resolution.

---

### Task 1: `tierGroupPlan` pure function + env reader

**Files:**
- Create: `src/lib/tier-group-sync.ts`
- Test: `src/lib/tier-group-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/tier-group-sync.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  tierGroupIdsFromEnv,
  tierGroupPlan,
  type TierGroupIds,
} from "./tier-group-sync";

const IDS: TierGroupIds = { gold: "GRP_GOLD", diamond: "GRP_DIA" };

describe("tierGroupPlan", () => {
  it("silver (0 pts) with no groups → no ops", () => {
    expect(tierGroupPlan(0, [], IDS)).toEqual({ add: [], remove: [] });
  });

  it("29 pts is still silver", () => {
    expect(tierGroupPlan(29, [], IDS)).toEqual({ add: [], remove: [] });
  });

  it("silver wrongly in gold group → repair removes it", () => {
    expect(tierGroupPlan(0, ["GRP_GOLD"], IDS)).toEqual({
      add: [],
      remove: ["GRP_GOLD"],
    });
  });

  it("30 pts (gold boundary) → add gold", () => {
    expect(tierGroupPlan(30, [], IDS)).toEqual({
      add: ["GRP_GOLD"],
      remove: [],
    });
  });

  it("79 pts is still gold; already in gold group → idempotent no-op", () => {
    expect(tierGroupPlan(79, ["GRP_GOLD"], IDS)).toEqual({
      add: [],
      remove: [],
    });
  });

  it("80 pts (diamond boundary) promoted from gold → add diamond, remove gold", () => {
    expect(tierGroupPlan(80, ["GRP_GOLD"], IDS)).toEqual({
      add: ["GRP_DIA"],
      remove: ["GRP_GOLD"],
    });
  });

  it("diamond already in diamond group → idempotent no-op", () => {
    expect(tierGroupPlan(120, ["GRP_DIA"], IDS)).toEqual({
      add: [],
      remove: [],
    });
  });

  it("ignores unrelated (non-tier) groups", () => {
    expect(tierGroupPlan(30, ["GRP_OTHER"], IDS)).toEqual({
      add: ["GRP_GOLD"],
      remove: [],
    });
  });

  it("repairs a customer wrongly in BOTH tier groups", () => {
    expect(tierGroupPlan(80, ["GRP_GOLD", "GRP_DIA"], IDS)).toEqual({
      add: [],
      remove: ["GRP_GOLD"],
    });
  });
});

describe("tierGroupIdsFromEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when either env var is missing", () => {
    vi.stubEnv("SQUARE_TIER_GROUP_GOLD_ID", "GRP_GOLD");
    vi.stubEnv("SQUARE_TIER_GROUP_DIAMOND_ID", "");
    expect(tierGroupIdsFromEnv()).toBeNull();
  });

  it("returns both ids when configured", () => {
    vi.stubEnv("SQUARE_TIER_GROUP_GOLD_ID", "GRP_GOLD");
    vi.stubEnv("SQUARE_TIER_GROUP_DIAMOND_ID", "GRP_DIA");
    expect(tierGroupIdsFromEnv()).toEqual(IDS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tier-group-sync.test.ts`
Expected: FAIL — `Cannot find module './tier-group-sync'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/tier-group-sync.ts
// Projects derived membership tier (lib/membership-tier) into Square customer
// groups so the POS pricing rule "Tier member 5% off" auto-applies in-store.
// NOTE: relative import + no "@/lib/square" import — this module is shared
// with tsx ops scripts (scripts/backfill-tier-groups.ts) which cannot resolve
// the "@" alias and must not pull in "server-only".
import { tierFor } from "./membership-tier";

export type TierGroupIds = { gold: string; diamond: string };
export type GroupPlan = { add: string[]; remove: string[] };

export function tierGroupIdsFromEnv(): TierGroupIds | null {
  const gold = process.env.SQUARE_TIER_GROUP_GOLD_ID;
  const diamond = process.env.SQUARE_TIER_GROUP_DIAMOND_ID;
  if (!gold || !diamond) return null;
  return { gold, diamond };
}

/**
 * Pure plan: which tier groups to add/remove for a customer, given lifetime
 * points and the customer's current Square group ids. Idempotent — returns
 * empty arrays when membership already matches the derived tier. Non-tier
 * groups are never touched.
 */
export function tierGroupPlan(
  lifetimePoints: number,
  currentGroupIds: readonly string[],
  ids: TierGroupIds,
): GroupPlan {
  const tier = tierFor(lifetimePoints);
  const want =
    tier === "diamond" ? ids.diamond : tier === "gold" ? ids.gold : null;
  const tierGroups = [ids.gold, ids.diamond];
  const current = currentGroupIds.filter((g) => tierGroups.includes(g));
  return {
    add: want && !current.includes(want) ? [want] : [],
    remove: current.filter((g) => g !== want),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tier-group-sync.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tier-group-sync.ts src/lib/tier-group-sync.test.ts
git commit -m "feat(tier): tierGroupPlan — project derived tier into Square group ops"
```

---

### Task 2: `syncTierGroups` executor (injected client)

**Files:**
- Modify: `src/lib/tier-group-sync.ts` (append)
- Test: `src/lib/tier-group-sync.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to the test file)

```ts
import { syncTierGroups, type TierGroupClient } from "./tier-group-sync";

function fakeClient(groupIds: string[]) {
  const calls: { op: "add" | "remove"; groupId: string }[] = [];
  const client: TierGroupClient = {
    customers: {
      get: async () => ({ customer: { groupIds } }),
      groups: {
        add: async ({ groupId }) => {
          calls.push({ op: "add", groupId });
        },
        remove: async ({ groupId }) => {
          calls.push({ op: "remove", groupId });
        },
      },
    },
  };
  return { client, calls };
}

describe("syncTierGroups", () => {
  it("executes the plan: promotion adds diamond and removes gold", async () => {
    const { client, calls } = fakeClient(["GRP_GOLD"]);
    const plan = await syncTierGroups(client, "CUST_1", 80, IDS);
    expect(plan).toEqual({ add: ["GRP_DIA"], remove: ["GRP_GOLD"] });
    expect(calls).toEqual([
      { op: "add", groupId: "GRP_DIA" },
      { op: "remove", groupId: "GRP_GOLD" },
    ]);
  });

  it("makes no group calls when membership already correct", async () => {
    const { client, calls } = fakeClient(["GRP_DIA"]);
    await syncTierGroups(client, "CUST_1", 95, IDS);
    expect(calls).toEqual([]);
  });

  it("propagates Square errors to the caller (webhook logs them)", async () => {
    const client: TierGroupClient = {
      customers: {
        get: async () => {
          throw new Error("square down");
        },
        groups: {
          add: async () => {},
          remove: async () => {},
        },
      },
    };
    await expect(syncTierGroups(client, "CUST_1", 80, IDS)).rejects.toThrow(
      "square down",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/tier-group-sync.test.ts`
Expected: FAIL — `syncTierGroups` / `TierGroupClient` not exported.

- [ ] **Step 3: Append the implementation**

```ts
/**
 * Minimal structural slice of SquareClient used by the sync — lets vitest
 * inject a plain object and lets tsx scripts pass their own SquareClient
 * without this module importing "@/lib/square" (which is server-only).
 */
export type TierGroupClient = {
  customers: {
    get(req: {
      customerId: string;
    }): Promise<{ customer?: { groupIds?: string[] | null } | null }>;
    groups: {
      add(req: { customerId: string; groupId: string }): Promise<unknown>;
      remove(req: { customerId: string; groupId: string }): Promise<unknown>;
    };
  };
};

/** Fetch current groups, plan, execute. Throws on Square errors — callers log. */
export async function syncTierGroups(
  client: TierGroupClient,
  customerId: string,
  lifetimePoints: number,
  ids: TierGroupIds,
): Promise<GroupPlan> {
  const res = await client.customers.get({ customerId });
  const plan = tierGroupPlan(lifetimePoints, res.customer?.groupIds ?? [], ids);
  for (const groupId of plan.add) {
    await client.customers.groups.add({ customerId, groupId });
  }
  for (const groupId of plan.remove) {
    await client.customers.groups.remove({ customerId, groupId });
  }
  return plan;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tier-group-sync.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tier-group-sync.ts src/lib/tier-group-sync.test.ts
git commit -m "feat(tier): syncTierGroups executor with injected Square client"
```

---

### Task 3: Webhook wiring (`loyalty.account.updated`)

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts` (the `SquareEvent` type at line ~97, a new handler next to `handleLoyaltyBalanceUpdate` at line ~274, and the dispatch block at line ~634)

No new unit test in this task: route-level tests for this file live in the gitignored local `tests/api-contract/` infra, and the wiring below is a thin 3-line dispatch into the already-tested `syncTierGroups`. Coverage = tsc + full vitest suite + the spec/quality reviews + rollout live checks.

- [ ] **Step 1: Extend the `SquareEvent.loyalty_account` type**

In the `SquareEvent` type, change:

```ts
      loyalty_account?: {
        id?: string;
        customer_id?: string;
        balance?: number;
      };
```

to:

```ts
      loyalty_account?: {
        id?: string;
        customer_id?: string;
        balance?: number;
        lifetime_points?: number;
      };
```

- [ ] **Step 2: Add the handler** (insert directly after the closing brace of `handleLoyaltyBalanceUpdate`, ~line 274)

```ts
/**
 * Loyalty balance changed — also re-project the derived tier into Square
 * customer groups so the POS "Tier member 5% off" pricing rule stays correct.
 * No-ops (with a warn) until SQUARE_TIER_GROUP_*_ID env vars are configured.
 */
async function handleTierGroupSync(event: SquareEvent): Promise<void> {
  const account = event.data?.object?.loyalty_account;
  const customerId = account?.customer_id;
  if (!customerId) return;

  const { syncTierGroups, tierGroupIdsFromEnv } = await import(
    "@/lib/tier-group-sync"
  );
  const ids = tierGroupIdsFromEnv();
  if (!ids) {
    console.warn(
      "[tier-group-sync] SQUARE_TIER_GROUP_GOLD_ID/DIAMOND_ID not set — skipping",
    );
    return;
  }

  const { squareClient } = await import("@/lib/square");
  let lifetimePoints = account?.lifetime_points;
  if (typeof lifetimePoints !== "number" && account?.id) {
    const res = await squareClient.loyalty.accounts.get({
      accountId: account.id,
    });
    lifetimePoints = res.loyaltyAccount?.lifetimePoints ?? undefined;
  }
  if (typeof lifetimePoints !== "number") return;

  const plan = await syncTierGroups(squareClient, customerId, lifetimePoints, ids);
  if (plan.add.length > 0 || plan.remove.length > 0) {
    console.log(
      `[tier-group-sync] customer ${customerId} lifetime=${lifetimePoints} add=[${plan.add}] remove=[${plan.remove}] event_id=${event.event_id}`,
    );
  }
}
```

- [ ] **Step 3: Dispatch it** — change the existing block at ~line 634:

```ts
  if (event.type === "loyalty.account.updated") {
    try {
      await handleLoyaltyBalanceUpdate(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[square-webhook] handleLoyaltyBalanceUpdate failed event_id=${event.event_id}: ${message}`,
      );
    }
  }
```

to:

```ts
  if (event.type === "loyalty.account.updated") {
    try {
      await handleLoyaltyBalanceUpdate(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[square-webhook] handleLoyaltyBalanceUpdate failed event_id=${event.event_id}: ${message}`,
      );
    }
    try {
      await handleTierGroupSync(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[tier-group-sync] failed event_id=${event.event_id}: ${message}`,
      );
    }
  }
```

(Separate try/catch: a tier-sync failure must not block wallet-pass pushes, and vice versa. Neither may 5xx the webhook.)

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "^src/" ; npx vitest run`
Expected: zero `src/` tsc errors; all vitest pass (492 existing + 14 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "feat(tier): sync customer tier groups on loyalty.account.updated webhook"
```

---

### Task 4: Setup script (Square groups + pricing-rule triple)

**Files:**
- Create: `scripts/setup-tier-pos-discount.ts` (committed — it defines prod resources)

- [ ] **Step 1: Write the script**

```ts
// scripts/setup-tier-pos-discount.ts
// One-time (rerunnable) Square setup for the POS tier discount:
//   - customer groups "Tier: Gold" / "Tier: Diamond"
//   - catalog triple: Member 5% discount + all-products set + pricing rule
//     with customerGroupIdsAny = [gold, diamond]
// Find-or-create on names — safe to rerun; never duplicates.
// Run: set -a; source .env.production; set +a; npx tsx scripts/setup-tier-pos-discount.ts
import { randomUUID } from "node:crypto";
import { SquareClient, SquareEnvironment } from "square";

const token = process.env.SQUARE_ACCESS_TOKEN;
if (!token) {
  console.error("SQUARE_ACCESS_TOKEN missing");
  process.exit(1);
}
const client = new SquareClient({
  token,
  environment:
    (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production") === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});

const GOLD_NAME = "Tier: Gold";
const DIAMOND_NAME = "Tier: Diamond";
const DISCOUNT_NAME = "Member 5%";
const PRODUCT_SET_NAME = "All products (tier discount)";
const RULE_NAME = "Tier member 5% off";

async function ensureGroup(name: string): Promise<string> {
  // Page wrapper: groups live on page.response.groups (NOT page.groups).
  let page = await client.customers.groups.list({});
  for (;;) {
    const hit = (page.response.groups ?? []).find((g) => g.name === name);
    if (hit?.id) {
      console.log(`group exists: "${name}" → ${hit.id}`);
      return hit.id;
    }
    if (!page.hasNextPage()) break;
    page = await page.getNextPage();
  }
  const created = await client.customers.groups.create({
    idempotencyKey: randomUUID(),
    group: { name },
  });
  const id = created.group?.id;
  if (!id) throw new Error(`create group "${name}" returned no id`);
  console.log(`group created: "${name}" → ${id}`);
  return id;
}

async function findPricingRuleByName(name: string) {
  const res = await client.catalog.search({
    objectTypes: ["PRICING_RULE"],
  });
  return (res.objects ?? []).find(
    (o) => o.type === "PRICING_RULE" && o.pricingRuleData?.name === name,
  );
}

async function main() {
  const goldId = await ensureGroup(GOLD_NAME);
  const diamondId = await ensureGroup(DIAMOND_NAME);

  const existing = await findPricingRuleByName(RULE_NAME);
  if (existing) {
    console.log(`pricing rule exists: "${RULE_NAME}" → ${existing.id} (skipping catalog upsert)`);
  } else {
    const res = await client.catalog.batchUpsert({
      idempotencyKey: randomUUID(),
      batches: [
        {
          objects: [
            {
              type: "DISCOUNT",
              id: "#tier-discount",
              presentAtAllLocations: true,
              discountData: {
                name: DISCOUNT_NAME,
                discountType: "FIXED_PERCENTAGE",
                percentage: "5.0",
              },
            },
            {
              type: "PRODUCT_SET",
              id: "#tier-products",
              presentAtAllLocations: true,
              productSetData: { name: PRODUCT_SET_NAME, allProducts: true },
            },
            {
              type: "PRICING_RULE",
              id: "#tier-rule",
              presentAtAllLocations: true,
              pricingRuleData: {
                name: RULE_NAME,
                discountId: "#tier-discount",
                matchProductsId: "#tier-products",
                customerGroupIdsAny: [goldId, diamondId],
              },
            },
          ],
        },
      ],
    });
    for (const m of res.idMappings ?? []) {
      console.log(`catalog created: ${m.clientObjectId} → ${m.objectId}`);
    }
  }

  console.log("\nSet these in Vercel env (production) AND .env.local / .env.production:");
  console.log(`SQUARE_TIER_GROUP_GOLD_ID=${goldId}`);
  console.log(`SQUARE_TIER_GROUP_DIAMOND_ID=${diamondId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles and dry-check against sandbox creds if available, otherwise just typecheck**

Run: `npx tsc --noEmit scripts/setup-tier-pos-discount.ts --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck`
Expected: no errors. (Do NOT run it against prod in this task — that's the rollout runbook, Task 7.)

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-tier-pos-discount.ts
git commit -m "feat(tier): rerunnable Square setup script for POS tier discount"
```

---

### Task 5: Backfill / reconcile script

**Files:**
- Create: `scripts/backfill-tier-groups.ts` (committed)

- [ ] **Step 1: Write the script**

```ts
// scripts/backfill-tier-groups.ts
// Pages ALL loyalty accounts, derives tier from lifetimePoints, and syncs
// Square customer-group membership via tierGroupPlan. Dry-run by default;
// --apply executes. Rerunnable any time (also the repair tool after admin
// customer merges). Sequential + 150ms delay to stay rate-limit friendly.
// Run: set -a; source .env.production; set +a; npx tsx scripts/backfill-tier-groups.ts [--apply]
import { SquareClient, SquareEnvironment } from "square";
import { syncTierGroups, tierGroupPlan } from "../src/lib/tier-group-sync";
import { tierFor } from "../src/lib/membership-tier";

const APPLY = process.argv.includes("--apply");
const token = process.env.SQUARE_ACCESS_TOKEN;
const goldId = process.env.SQUARE_TIER_GROUP_GOLD_ID;
const diamondId = process.env.SQUARE_TIER_GROUP_DIAMOND_ID;
if (!token || !goldId || !diamondId) {
  console.error(
    "need SQUARE_ACCESS_TOKEN + SQUARE_TIER_GROUP_GOLD_ID + SQUARE_TIER_GROUP_DIAMOND_ID",
  );
  process.exit(1);
}
const IDS = { gold: goldId, diamond: diamondId };
const client = new SquareClient({
  token,
  environment:
    (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production") === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. page all loyalty accounts (search() awaits directly; cursor pagination)
  type Acct = { customerId: string; lifetimePoints: number };
  const accounts: Acct[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.loyalty.accounts.search({ limit: 30, cursor });
    for (const a of res.loyaltyAccounts ?? []) {
      if (a.customerId) {
        accounts.push({
          customerId: a.customerId,
          lifetimePoints: a.lifetimePoints ?? 0,
        });
      }
    }
    cursor = res.cursor ?? undefined;
  } while (cursor);
  console.log(`loyalty accounts: ${accounts.length}`);

  // 2. plan / apply per member (only gold+ need a customers.get round-trip;
  //    silver with no possible membership still gets checked for repair —
  //    cheap and keeps the script the single repair authority)
  const stats = { goldAdd: 0, diamondAdd: 0, removed: 0, ok: 0, errors: 0 };
  for (const acct of accounts) {
    try {
      if (APPLY) {
        const plan = await syncTierGroups(
          client,
          acct.customerId,
          acct.lifetimePoints,
          IDS,
        );
        tally(plan, acct);
      } else {
        const res = await client.customers.get({ customerId: acct.customerId });
        const plan = tierGroupPlan(
          acct.lifetimePoints,
          res.customer?.groupIds ?? [],
          IDS,
        );
        tally(plan, acct);
      }
    } catch (err) {
      stats.errors++;
      console.error(
        `  ERROR ${acct.customerId}: ${err instanceof Error ? err.message : err}`,
      );
    }
    await sleep(150);
  }

  function tally(
    plan: { add: string[]; remove: string[] },
    acct: Acct,
  ) {
    if (plan.add.length === 0 && plan.remove.length === 0) {
      stats.ok++;
      return;
    }
    if (plan.add.includes(IDS.gold)) stats.goldAdd++;
    if (plan.add.includes(IDS.diamond)) stats.diamondAdd++;
    stats.removed += plan.remove.length;
    console.log(
      `  ${APPLY ? "SYNCED" : "WOULD SYNC"} ${acct.customerId} pts=${acct.lifetimePoints} tier=${tierFor(acct.lifetimePoints)} add=[${plan.add}] remove=[${plan.remove}]`,
    );
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY-RUN"}: +gold=${stats.goldAdd} +diamond=${stats.diamondAdd} removals=${stats.removed} already-correct=${stats.ok} errors=${stats.errors}`,
  );
  if (!APPLY) console.log("rerun with --apply to execute");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit scripts/backfill-tier-groups.ts --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck`
Expected: no errors. (Verifies the relative imports from `src/lib` resolve and `SquareClient` structurally satisfies `TierGroupClient` — if the structural check fails here, fix `TierGroupClient` in `src/lib/tier-group-sync.ts`, do not cast.)

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-tier-groups.ts
git commit -m "feat(tier): backfill/reconcile script for tier customer groups"
```

---

### Task 6: Env documentation + full suite + PR

**Files:**
- Modify: `.env.example` (append)

- [ ] **Step 1: Append to `.env.example`**

```bash
# POS tier discount — Square customer group ids (from scripts/setup-tier-pos-discount.ts)
# Webhook tier-group sync no-ops with a warn until these are set.
SQUARE_TIER_GROUP_GOLD_ID=
SQUARE_TIER_GROUP_DIAMOND_ID=
```

- [ ] **Step 2: Full verification**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "^src/" || true`
Expected: all vitest pass (506 = 492 + 14); zero `src/` tsc errors.

- [ ] **Step 3: Commit + push + PR**

```bash
git add .env.example
git commit -m "docs(tier): document POS tier group env vars"
git push -u origin feat/pos-tier-discount
gh pr create --title "POS in-store tier discount: gold/diamond 5% via Square customer groups" --body "$(cat <<'EOF'
## Summary
- Square customer groups (Tier: Gold / Tier: Diamond) + catalog pricing rule auto-apply 5% at POS when staff attach a member to the sale
- Webhook loyalty.account.updated now re-projects derived tier into group membership (no-op until env configured)
- Committed setup + backfill/reconcile tsx scripts (find-or-create / dry-run-first)

Spec: docs/superpowers/specs/2026-06-13-pos-tier-discount-design.md

## Rollout (after merge)
setup script → Vercel env → backfill --apply → POS smoke → online double-discount check

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; Vercel preview build goes green (code is inert without env vars).

---

### Task 7: Rollout runbook (operator steps — after PR preview is green and merged)

No code. Execute in order; every step has a verification.

- [ ] **Step 1: Merge** — preview green → `git checkout main && git pull && git merge --ff-only feat/pos-tier-discount && git push` → wait for prod deploy green (poll commit status).

- [ ] **Step 2: Run setup against prod Square**

```bash
set -a; source .env.production; set +a
npx tsx scripts/setup-tier-pos-discount.ts
```

Expected output: two group ids + 3 catalog `idMappings` lines (or "exists" lines on rerun). Record the two ids.

- [ ] **Step 3: Configure env** — add `SQUARE_TIER_GROUP_GOLD_ID` / `SQUARE_TIER_GROUP_DIAMOND_ID` to Vercel (production) via `vercel env add`, to local `.env.local` and `.env.production`, then redeploy (`vercel redeploy` or empty commit). Verify: Vercel deployment env shows both vars.

- [ ] **Step 4: Backfill**

```bash
npx tsx scripts/backfill-tier-groups.ts            # dry-run, review counts
npx tsx scripts/backfill-tier-groups.ts --apply
```

Verify: rerun dry-run → `+gold=0 +diamond=0 removals=0` (converged). Spot-check Stan's account in Square Dashboard → Customers → groups shows `Tier: Diamond`.

- [ ] **Step 5: Online double-discount check** — place a real web order with a gold/diamond account; confirm checkout shows exactly one "Member −5%" line and the Square Dashboard order has only the `tier-discount` uid discount (no `Member 5%` pricing-rule discount). This proves the pricing rule does not leak into `/api/orders` orders.

- [ ] **Step 6: POS smoke (requires the physical register — known gap if not same-day)** — at the store: New sale → add items → attach Stan's customer → expect automatic "Member 5%" discount line. If not same-day, mark as known gap and push to `TESTER_QUEUE-mandys.md`.

- [ ] **Step 7: Staff SOP** — tell staff: scan member QR → search the phone number → **add customer to the sale** → discount applies by itself; silver members can be attached too (no discount, accrual unaffected).

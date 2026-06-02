# Mandy's Tester P1 Fixtures + Sandbox Lib Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/fixtures`, `packages/lib-sandbox`, `packages/lib-contract-types` + a `mandys-tester seed` CLI that resets and seeds Supabase staging baseline. First independently-usable deliverable.

**Architecture:** 3 workspace packages. `fixtures` exports personas + factories (double-write Supabase staging + Square sandbox). `lib-sandbox` wraps Square Sandbox SDK + Supabase admin client + 5 Square Dashboard helpers. `lib-contract-types` pins 4 SDK shapes. CLI in `apps/cli` calls factories via `fixtures` + `lib-sandbox`.

**Tech Stack:** TypeScript 5, vitest 1.x, Square SDK v44, `@supabase/supabase-js` v2, `@faker-js/faker` 8.x, `commander` for CLI

**Spec reference:** `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md`

---

## Prerequisites
- P0 done; `~/Github/mandys-tester/` ready with `.env.local`
- pnpm 9, Node 20

## File Structure (P1 endstate)

```
mandys-tester/
├── packages/
│   ├── fixtures/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── factories/
│   │   │   │   ├── customer.ts
│   │   │   │   ├── order.ts
│   │   │   │   ├── catalog.ts
│   │   │   │   └── promo.ts
│   │   │   ├── personas/
│   │   │   │   ├── new-user.ts
│   │   │   │   ├── loyalty-mid.ts
│   │   │   │   ├── vip.ts
│   │   │   │   ├── lottery-winner.ts
│   │   │   │   ├── zombie.ts
│   │   │   │   └── apple-pay.ts
│   │   │   ├── seed.ts
│   │   │   └── schema-snapshot.sql
│   │   └── tests/
│   │       ├── factories.customer.test.ts
│   │       ├── factories.order.test.ts
│   │       └── personas.test.ts
│   ├── lib-sandbox/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── square-client.ts
│   │   │   ├── square-toggle.ts
│   │   │   ├── supabase-staging.ts
│   │   │   └── twilio-mock.ts
│   │   └── tests/
│   │       ├── square-client.test.ts
│   │       ├── square-toggle.test.ts
│   │       └── supabase-staging.test.ts
│   └── lib-contract-types/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── square-v44.ts
│           ├── supabase-v2.ts
│           ├── resend-v6.ts
│           └── twilio-verify.ts
└── apps/cli/
    ├── package.json
    ├── tsconfig.json
    └── src/index.ts          # commands: seed, verify-schema (others stub in P6)
```

## Tasks

### Task 1: Capture Prod Schema Snapshot

**Files:** Create `packages/fixtures/src/schema-snapshot.sql`

- [ ] **Step 1:** `cd ~/Github/mandys-tester`
- [ ] **Step 2:** Run `pg_dump --schema-only "$MANDY_PROD_DB_URL" -O -x > packages/fixtures/src/schema-snapshot.sql` (use the prod Supabase project — see existing `~/.claude/projects/-Users-stanyan/memory/reference_supabase_mcp_dual_servers.md` for connection; ask Stan to surface the prod connection string and never log it)
- [ ] **Step 3:** Open and **scrub** any policy hardcoding prod IDs (search `'user_id-`) — replace with `'{{prod-user-uuid}}'` placeholder
- [ ] **Step 4:** Apply schema to staging: `psql "$SUPABASE_STAGING_DB_URL" -f packages/fixtures/src/schema-snapshot.sql` — expect no errors
- [ ] **Step 5:** Verify: `psql "$SUPABASE_STAGING_DB_URL" -c "\dt public.*" → expect tables: user_profiles, orders, welcome_discounts, loyalty_*, print_jobs, cup_label_jobs, ...`

### Task 2: `packages/lib-contract-types` — SDK Shape Pins

**Files:**
- Create: `packages/lib-contract-types/package.json` + `tsconfig.json`
- Create: `packages/lib-contract-types/src/{index,square-v44,supabase-v2,resend-v6,twilio-verify}.ts`

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "@mandys-tester/lib-contract-types",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.5.0" }
}
```

- [ ] **Step 2:** Write `src/square-v44.ts` pinning gotchas from `~/.claude/projects/-Users-stanyan/memory/feedback_square_v44_*.md`:

```ts
import type { Square } from "square";

// Pins from memory:
// - feedback_square_v44_page_wrapper.md: paginated list() returns Page<T,R>, must read page.response.X
// - feedback_square_v44_customer_sdk_quirks.md: limit must be BigInt, response camelCase
// - feedback_square_v44_raw_payload_camelcase.md: orders.raw_payload keys are camelCase
// - feedback_square_v44_catalog_search_method_name.md: catalog.searchItems (not searchCatalogItems)

export type SquareRawPayloadTender = {
  id: string;
  amountMoney: { amount: string; currency: string };
  cardDetails?: { cardBrand?: string; last4?: string };
  createdAt: string;
};

export type SquareOrderRawPayload = {
  id: string;
  totalMoney: { amount: string; currency: string };
  tenders?: SquareRawPayloadTender[];
};

export type SquareCustomerSearchInput = {
  limit: bigint;          // NOT number — SDK v44 quirk
  query: { filter: { phoneNumber?: { exact: string } } };
};
```

- [ ] **Step 3:** Write `src/supabase-v2.ts` per `feedback_supabase_bytea_decode.md`:

```ts
export type SupabaseByteaCell =
  | Buffer
  | Uint8Array
  | `\\x${string}`           // hex prefix string
  | string;                  // base64

// Helper used by all suites that read bytea columns
export function decodeBytea(cell: SupabaseByteaCell): Buffer {
  if (Buffer.isBuffer(cell)) return cell;
  if (cell instanceof Uint8Array) return Buffer.from(cell);
  if (typeof cell === "string" && cell.startsWith("\\x")) return Buffer.from(cell.slice(2), "hex");
  if (typeof cell === "string") return Buffer.from(cell, "base64");
  throw new Error("Unknown bytea shape: " + typeof cell);
}
```

- [ ] **Step 4:** Write `src/resend-v6.ts` per `feedback_resend_v6_wrapped_response.md`:

```ts
export type ResendResponse<T> = { data: T | null; error: { name: string; message: string } | null };

export class ResendLogicalError extends Error {
  constructor(public payload: { name: string; message: string }) { super(payload.message); }
}

export async function unwrapResend<T>(p: Promise<ResendResponse<T>>): Promise<T> {
  const r = await p;
  if (r.error) throw new ResendLogicalError(r.error);
  if (!r.data) throw new Error("Resend returned no data and no error");
  return r.data;
}
```

- [ ] **Step 5:** Write `src/twilio-verify.ts` — mock interface contract:

```ts
export interface TwilioVerifyClient {
  start(args: { to: string; channel: "sms" }): Promise<{ sid: string; status: "pending" }>;
  check(args: { to: string; code: string }): Promise<{ status: "approved" | "pending" }>;
}
```

- [ ] **Step 6:** Write `src/index.ts` re-exporting all
- [ ] **Step 7:** Write `tsconfig.json` extending `../../tsconfig.base.json` + `"include": ["src/**/*.ts"]`
- [ ] **Step 8:** Run `pnpm -F @mandys-tester/lib-contract-types typecheck` → expect 0 errors
- [ ] **Step 9:** Commit: `git commit -am "feat(contract-types): pin Square v44 / Supabase v2 / Resend v6 / Twilio Verify shapes"`

### Task 3: `packages/lib-sandbox` — Square Client + Supabase Staging Client

**Files:** Create `packages/lib-sandbox/{package.json,tsconfig.json,src/*}`

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "@mandys-tester/lib-sandbox",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.103.2",
    "square": "^44.0.1",
    "@mandys-tester/lib-contract-types": "workspace:*"
  },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.5.0" }
}
```

- [ ] **Step 2:** Write `src/square-client.ts`:

```ts
import { SquareClient, SquareEnvironment } from "square";

export function squareSandboxClient() {
  const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_SANDBOX_ACCESS_TOKEN missing");
  return new SquareClient({ token, environment: SquareEnvironment.Sandbox });
}
```

- [ ] **Step 3:** Write failing test `tests/square-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { squareSandboxClient } from "../src/square-client.js";

describe("squareSandboxClient", () => {
  it("hits sandbox locations endpoint", async () => {
    const client = squareSandboxClient();
    const { result } = await client.locationsApi.listLocations();
    expect(result.locations?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4:** Run `pnpm -F @mandys-tester/lib-sandbox test` → expect PASS (provided `.env.local` loaded via vitest config)
- [ ] **Step 5:** Add vitest config: create `packages/lib-sandbox/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ["../../.env.local", "../../.env"] });
export default defineConfig({});
```

- [ ] **Step 6:** Re-run test → expect 200 + ≥1 location
- [ ] **Step 7:** Write `src/supabase-staging.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export function supabaseStaging(role: "anon" | "service" = "service") {
  const url = process.env.SUPABASE_STAGING_URL;
  const key = role === "service"
    ? process.env.SUPABASE_STAGING_SERVICE_KEY
    : process.env.SUPABASE_STAGING_ANON_KEY;
  if (!url || !key) throw new Error(`SUPABASE_STAGING_${role.toUpperCase()}_* missing`);
  return createClient(url, key, { auth: { persistSession: false } });
}
```

- [ ] **Step 8:** Write `tests/supabase-staging.test.ts` asserting `auth.users` table reachable + count returned
- [ ] **Step 9:** Run + commit: `git commit -am "feat(lib-sandbox): Square + Supabase staging clients + first integration tests"`

### Task 4: `lib-sandbox/square-toggle` — 5 Dashboard Helpers

**Files:** Create `packages/lib-sandbox/src/square-toggle.ts` + tests

- [ ] **Step 1:** Write failing test `tests/square-toggle.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setSoldOut } from "../src/square-toggle.js";
import { squareSandboxClient } from "../src/square-client.js";

let catalogId: string;

beforeAll(async () => {
  const client = squareSandboxClient();
  const { result } = await client.catalogApi.searchCatalogObjects({
    objectTypes: ["ITEM"], limit: 1n,
  });
  catalogId = result.objects?.[0]?.id ?? "";
  if (!catalogId) throw new Error("No catalog item to test against");
});

describe("setSoldOut", () => {
  it("toggles sold-out state", async () => {
    await setSoldOut(catalogId, true);
    await setSoldOut(catalogId, false);
    expect(true).toBe(true);  // assertion: no throw
  });
});
```

- [ ] **Step 2:** Write `src/square-toggle.ts`:

```ts
import { squareSandboxClient } from "./square-client.js";

export async function setSoldOut(catalogObjectId: string, soldOut: boolean): Promise<void> {
  const client = squareSandboxClient();
  // Sandbox: present_at_location_ids manipulation
  const locId = process.env.SQUARE_SANDBOX_LOCATION_ID!;
  const { result } = await client.catalogApi.retrieveCatalogObject(catalogObjectId);
  const obj = result.object!;
  const updated = {
    ...obj,
    presentAtAllLocations: !soldOut,
    presentAtLocationIds: soldOut ? [] : [locId],
  };
  await client.catalogApi.upsertCatalogObject({ idempotencyKey: crypto.randomUUID(), object: updated });
}

export async function deleteCustomer(customerId: string): Promise<void> {
  const client = squareSandboxClient();
  await client.customersApi.deleteCustomer(customerId);
}

export async function adjustLoyaltyPoints(accountId: string, points: number, reason: string): Promise<void> {
  const client = squareSandboxClient();
  await client.loyaltyApi.adjustLoyaltyPoints(accountId, {
    idempotencyKey: crypto.randomUUID(),
    adjustPoints: { points, reason },
  });
}

export async function simulateCustomerDeletedWebhook(customerId: string): Promise<void> {
  // Sandbox: real Square webhook fires on actual delete; this helper just calls deleteCustomer
  await deleteCustomer(customerId);
}

export async function resetSandbox(): Promise<void> {
  // No-op for now; sandbox state is shared. Real reset = manual via Square Dashboard.
  // Future: enumerate sandbox catalog/customers/orders and delete via API.
}
```

- [ ] **Step 3:** Run test → expect PASS
- [ ] **Step 4:** Commit: `git commit -am "feat(lib-sandbox): 5 Square Dashboard toggle helpers"`

### Task 5: `lib-sandbox/twilio-mock` — Local Express Server

**Files:** Create `packages/lib-sandbox/src/twilio-mock.ts`

- [ ] **Step 1:** Add dependency: `pnpm -F @mandys-tester/lib-sandbox add express @types/express`
- [ ] **Step 2:** Write:

```ts
import express from "express";
import type { Server } from "http";

export function startTwilioMock(port = 3399): { server: Server; sentCodes: Map<string, string> } {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  const sentCodes = new Map<string, string>();

  app.post("/v2/Services/:sid/Verifications", (req, res) => {
    const to = String(req.body.To);
    sentCodes.set(to, "000000");
    res.json({ sid: "VE_mock_" + Date.now(), status: "pending", to });
  });

  app.post("/v2/Services/:sid/VerificationCheck", (req, res) => {
    const to = String(req.body.To);
    const code = String(req.body.Code);
    const ok = sentCodes.get(to) === code;
    res.json({ status: ok ? "approved" : "pending", to });
  });

  const server = app.listen(port);
  return { server, sentCodes };
}
```

- [ ] **Step 3:** Write `tests/twilio-mock.test.ts` asserting start → POST → check → 200 approved
- [ ] **Step 4:** Run + commit: `git commit -am "feat(lib-sandbox): Twilio Verify mock (sentinel code 000000)"`

### Task 6: `packages/fixtures/personas` — 5 Named Templates

**Files:** Create `packages/fixtures/src/personas/*.ts`

- [ ] **Step 1:** Write `personas/new-user.ts`:

```ts
import type { CustomerSeed } from "../factories/customer.js";

export const newUser: CustomerSeed = {
  givenName: "Test",
  familyName: "NewUser",
  phoneE164: "+61400000001",
  email: "test-new-user@mandybubbletea.com",
  provider: "phone",
  loyaltyStars: 0,
  hasWelcomeDiscount: true,
  hasIgFollowDiscount: false,
};
```

- [ ] **Step 2:** Write `personas/loyalty-mid.ts`, `vip.ts`, `lottery-winner.ts`, `zombie.ts`, `apple-pay.ts` following same shape (varying loyalty stars, providers, discount flags)
- [ ] **Step 3:** Re-export from `personas/index.ts`
- [ ] **Step 4:** Write `tests/personas.test.ts` asserting all 6 personas type-check + have unique phones
- [ ] **Step 5:** Commit: `git commit -am "feat(fixtures): 6 customer personas"`

### Task 7: `packages/fixtures/factories/customer` — Double-Write Factory

**Files:** Create `packages/fixtures/src/factories/customer.ts` + tests

- [ ] **Step 1:** Write failing test `tests/factories.customer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeCustomer } from "../src/factories/customer.js";
import { newUser } from "../src/personas/new-user.js";

describe("makeCustomer", () => {
  it("writes to Supabase staging + Square sandbox, returns handles + cleanup", async () => {
    const handle = await makeCustomer({ persona: newUser });
    expect(handle.supabaseUserId).toMatch(/^[0-9a-f-]{36}$/);
    expect(handle.squareCustomerId).toBeDefined();
    await handle.cleanup();
  });
});
```

- [ ] **Step 2:** Write `src/factories/customer.ts`:

```ts
import { supabaseStaging } from "@mandys-tester/lib-sandbox";
import { squareSandboxClient } from "@mandys-tester/lib-sandbox";

export type CustomerSeed = {
  givenName: string;
  familyName: string;
  phoneE164: string;
  email: string;
  provider: "phone" | "google" | "apple";
  loyaltyStars: number;
  hasWelcomeDiscount: boolean;
  hasIgFollowDiscount: boolean;
};

export type CustomerHandle = {
  supabaseUserId: string;
  squareCustomerId: string;
  seed: CustomerSeed;
  cleanup: () => Promise<void>;
};

export async function makeCustomer(args: { persona?: CustomerSeed; overrides?: Partial<CustomerSeed> }): Promise<CustomerHandle> {
  const seed: CustomerSeed = { ...(args.persona ?? defaultSeed()), ...(args.overrides ?? {}) };
  const sb = supabaseStaging("service");
  const sq = squareSandboxClient();

  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: seed.email,
    phone: seed.phoneE164,
    email_confirm: true,
    phone_confirm: true,
  });
  if (authErr) throw authErr;
  const userId = authData.user.id;

  const { result: sqCustomer } = await sq.customersApi.createCustomer({
    idempotencyKey: crypto.randomUUID(),
    givenName: seed.givenName,
    familyName: seed.familyName,
    phoneNumber: seed.phoneE164,
    emailAddress: seed.email,
  });
  const squareId = sqCustomer.customer!.id!;

  await sb.from("user_profiles").insert({
    user_id: userId,
    phone_e164: seed.phoneE164,
    given_name: seed.givenName,
    family_name: seed.familyName,
    square_customer_id: squareId,
    signup_channel: "test",
  });

  return {
    supabaseUserId: userId,
    squareCustomerId: squareId,
    seed,
    cleanup: async () => {
      await sq.customersApi.deleteCustomer(squareId).catch(() => {});
      await sb.auth.admin.deleteUser(userId).catch(() => {});
    },
  };
}

function defaultSeed(): CustomerSeed {
  return {
    givenName: "Test", familyName: "Unknown",
    phoneE164: `+61400${String(Date.now()).slice(-6)}`,
    email: `test-${Date.now()}@mandybubbletea.com`,
    provider: "phone", loyaltyStars: 0,
    hasWelcomeDiscount: false, hasIgFollowDiscount: false,
  };
}
```

- [ ] **Step 3:** Run test → expect PASS (Supabase + Square sandbox 双写真线)
- [ ] **Step 4:** Commit: `git commit -am "feat(fixtures): customer factory double-writes Supabase + Square sandbox"`

### Task 8: `factories/{order,catalog,promo}`

**Files:** Create 3 factory files + tests

- [ ] **Step 1:** Write `src/factories/order.ts` `makeOrder({ customer, cups, modifiers, useLoyalty, useWelcome })` — creates Square sandbox Order + Supabase orders row
- [ ] **Step 2:** Write `src/factories/catalog.ts` `makeCatalogItem` — creates Square sandbox Catalog ITEM
- [ ] **Step 3:** Write `src/factories/promo.ts` `makeWelcomeDiscount` / `makeIgFollow` / `makeLotteryPrize` — Supabase rows only
- [ ] **Step 4:** Each factory returns `{ id, cleanup }` shape
- [ ] **Step 5:** Write 1 test per factory verifying real write + cleanup
- [ ] **Step 6:** Commit: `git commit -am "feat(fixtures): order/catalog/promo factories"`

### Task 9: `fixtures/seed.ts` — Baseline Seeder

**Files:** Create `packages/fixtures/src/seed.ts`

- [ ] **Step 1:** Write:

```ts
import { supabaseStaging } from "@mandys-tester/lib-sandbox";
import { makeCustomer } from "./factories/customer.js";
import { makeCatalogItem } from "./factories/catalog.js";
import { makeOrder } from "./factories/order.js";
import * as personas from "./personas/index.js";

export async function seedBaseline(opts: { customers?: number; catalogItems?: number; orders?: number } = {}) {
  const sb = supabaseStaging("service");
  // Truncate all tables (CASCADE)
  await sb.rpc("truncate_test_data");  // helper added in schema-snapshot.sql

  const customers = [];
  for (const p of Object.values(personas)) {
    customers.push(await makeCustomer({ persona: p }));
  }
  const catalog = [];
  for (let i = 0; i < (opts.catalogItems ?? 30); i++) {
    catalog.push(await makeCatalogItem({ name: `Test Drink ${i}`, priceCents: 600 + i * 50 }));
  }
  for (let i = 0; i < (opts.orders ?? 100); i++) {
    await makeOrder({
      customer: customers[i % customers.length],
      cups: 1 + (i % 3),
      catalogItem: catalog[i % catalog.length],
    });
  }
  return { customers: customers.length, catalog: catalog.length, orders: opts.orders ?? 100 };
}
```

- [ ] **Step 2:** Add `truncate_test_data` SQL function to `schema-snapshot.sql` (re-apply staging)
- [ ] **Step 3:** Write test `tests/seed.test.ts` asserting seeded counts
- [ ] **Step 4:** Commit: `git commit -am "feat(fixtures): seedBaseline truncates + populates staging"`

### Task 10: `apps/cli` — `mandys-tester seed` Command

**Files:** Create `apps/cli/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "@mandys-tester/cli",
  "version": "0.0.0",
  "type": "module",
  "bin": { "mandys-tester": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "dotenv": "^16.4.5",
    "@mandys-tester/fixtures": "workspace:*",
    "@mandys-tester/lib-sandbox": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.5.0" }
}
```

- [ ] **Step 2:** Write `src/index.ts`:

```ts
#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { seedBaseline } from "@mandys-tester/fixtures";

const program = new Command();
program.name("mandys-tester").description("Mandy's testing framework CLI").version("0.1.0");

program.command("seed")
  .description("Truncate Supabase staging + seed baseline fixtures")
  .option("--customers <n>", "number of customers (default 6 personas)", v => parseInt(v))
  .option("--catalog <n>", "number of catalog items", v => parseInt(v), 30)
  .option("--orders <n>", "number of orders", v => parseInt(v), 100)
  .action(async (opts) => {
    const result = await seedBaseline({
      customers: opts.customers,
      catalogItems: opts.catalog,
      orders: opts.orders,
    });
    console.log("Seeded:", result);
  });

await program.parseAsync();
```

- [ ] **Step 3:** Build: `pnpm -F @mandys-tester/cli build`
- [ ] **Step 4:** Smoke test: `pnpm -F @mandys-tester/cli exec mandys-tester seed --customers 6 --catalog 5 --orders 20` → expect `Seeded: { customers: 6, catalog: 5, orders: 20 }`
- [ ] **Step 5:** Verify in Supabase Studio: tables populated
- [ ] **Step 6:** Commit: `git commit -am "feat(cli): mandys-tester seed command"`

### Task 11: `verify-schema` Command

**Files:** Modify `apps/cli/src/index.ts`

- [ ] **Step 1:** Add subcommand:

```ts
program.command("verify-schema")
  .description("Diff staging schema vs schema-snapshot.sql; fail if drift")
  .action(async () => {
    const { execSync } = await import("node:child_process");
    const staging = execSync(`pg_dump --schema-only ${process.env.SUPABASE_STAGING_DB_URL}`).toString();
    const snapshot = await import("node:fs").then(fs => fs.promises.readFile(
      new URL("../../../packages/fixtures/src/schema-snapshot.sql", import.meta.url), "utf-8"));
    if (normalize(staging) === normalize(snapshot)) {
      console.log("schema match"); return;
    }
    console.error("schema drift detected"); process.exit(1);
  });

function normalize(s: string) {
  return s.replace(/^--.*$/gm, "").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 2:** Smoke: `mandys-tester verify-schema` → expect match
- [ ] **Step 3:** Commit: `git commit -am "feat(cli): verify-schema drift check"`

### Task 12: P1 Push + Done Check

- [ ] **Step 1:** Run full pnpm typecheck + test: `pnpm typecheck && pnpm test` → all green
- [ ] **Step 2:** Push: `git push`
- [ ] **Step 3:** Update `~/system/TESTER_QUEUE-mandys.md` Recently Completed with P1 ship line

## Done Checklist (P1)

- [ ] 3 packages (fixtures, lib-sandbox, lib-contract-types) all build + test
- [ ] 6 personas + 4 factories with double-write semantics + cleanup
- [ ] `mandys-tester seed --customers 6 --catalog 30 --orders 100` succeeds end-to-end
- [ ] `mandys-tester verify-schema` matches snapshot
- [ ] Square Sandbox + Supabase staging both have visible test data after seed

## Self-Review Notes

- Test data uses `+61400000001..N` phone range (reserved for test, won't collide with real user data sweep)
- `cleanup` returns void; failures swallowed (best-effort). Aggregate cleanup at suite level via `afterAll`.
- Contract type pins live in `lib-contract-types`; if SDK breaks shape, type check fails — P2 contract suite consumes.

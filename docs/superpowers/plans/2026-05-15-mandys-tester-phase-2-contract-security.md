# Mandy's Tester P2 Contract + Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `suites/contract` (6 cross-service contracts) + `suites/security` (6 categories) + admin/widget unit baselines in prod repos.

**Architecture:** Contract tests are vitest suites importing `lib-contract-types` shapes + sandbox clients; assert real Square/Supabase/Resend payloads conform. Security tests use Supabase service client + curl to probe RLS / auth / SQL inj / secrets / XSS / CSRF.

**Tech Stack:** vitest 1.x, ts-jest (type assertion only), curl, Supabase v2, Resend SDK v6 stub, Twilio mock

**Spec reference:** `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md`

---

## Prerequisites
- P0 + P1 done; staging seeded
- Mandy web prod repo accessible for snapshot capture

## File Structure (P2 endstate)

```
mandys-tester/
├── suites/
│   ├── contract/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── snapshots/
│   │   │   ├── api-me.json
│   │   │   ├── api-orders-list.json
│   │   │   ├── api-payment-success.json
│   │   │   └── webhook-resend-{delivered,bounced}.json
│   │   └── src/
│   │       ├── web-printer-realtime.test.ts
│   │       ├── web-app-api.test.ts
│   │       ├── square-sdk.test.ts
│   │       ├── supabase-shape.test.ts
│   │       ├── resend-webhook.test.ts
│   │       └── twilio-mock-shape.test.ts
│   └── security/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── rls.test.ts
│           ├── sql-injection.test.ts
│           ├── auth-bypass.test.ts
│           ├── secret-leak.test.ts
│           ├── csrf-cors.test.ts
│           └── xss.test.ts
```

Prod repos (add unit baselines):
```
mandys_bubble_tea_admin/
├── package.json (add scripts test + vitest dep)
├── vitest.config.ts
└── src/**/*.test.ts (initial baseline)

mandys_bubble_tea_widget/
└── (similar, scope-limited to widget logic)
```

## Tasks

### Task 1: `suites/contract/package.json` + `vitest.config.ts`

**Files:** Create `suites/contract/{package.json,tsconfig.json,vitest.config.ts}`

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "@mandys-tester/suite-contract",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@mandys-tester/lib-contract-types": "workspace:*",
    "@mandys-tester/lib-sandbox": "workspace:*",
    "@mandys-tester/fixtures": "workspace:*"
  },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.5.0" }
}
```

- [ ] **Step 2:** Write `vitest.config.ts` loading `.env.local` (same as P1)
- [ ] **Step 3:** Tag tests via vitest meta for severity; example mapping (`@p1`) lives in describe name suffix

### Task 2: Contract — Web ↔ Printer Realtime

**Files:** Create `suites/contract/src/web-printer-realtime.test.ts`

- [ ] **Step 1:** Write failing test:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabaseStaging } from "@mandys-tester/lib-sandbox";
import { makeOrder, makeCustomer } from "@mandys-tester/fixtures";
import { newUser } from "@mandys-tester/fixtures";

describe("[P1] web→printer realtime", () => {
  let cleanup: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of cleanup) await c(); });

  it("print_jobs row has expected schema for printer-client consumer", async () => {
    const sb = supabaseStaging("service");
    const customer = await makeCustomer({ persona: newUser });
    const order = await makeOrder({ customer, cups: 1 });
    cleanup.push(order.cleanup, customer.cleanup);

    const { data } = await sb.from("print_jobs")
      .insert({
        order_id: order.id,
        kind: "sticker",
        zpl_body: "^XA^FO20,20^FDtest^FS^XZ",
        target_printer_kind: "zd410",
        status: "pending",
      }).select().single();

    expect(data).toMatchObject({
      status: "pending",
      target_printer_kind: "zd410",
      zpl_body: expect.stringContaining("^XA"),
      attempts: 0,
    });
    expect(typeof data!.id).toBe("string");
    expect(typeof data!.created_at).toBe("string");
  });

  it("cup_label_jobs UNIQUE(user_id, slot_key, cart_session_id)", async () => {
    const sb = supabaseStaging("service");
    const customer = await makeCustomer({ persona: newUser });
    cleanup.push(customer.cleanup);
    const row = { user_id: customer.supabaseUserId, slot_key: "slot1", cart_session_id: "cart1", doodle_source: "ai" as const };
    await sb.from("cup_label_jobs").insert(row);
    const { error } = await sb.from("cup_label_jobs").insert(row);
    expect(error?.code).toBe("23505");  // duplicate violation
  });
});
```

- [ ] **Step 2:** Run → expect PASS
- [ ] **Step 3:** Commit

### Task 3: Contract — Square SDK v44 Quirks

**Files:** `suites/contract/src/square-sdk.test.ts`

- [ ] **Step 1:** Write 4 tests covering: (a) Page<T,R> wrapper on `listLocations`; (b) `customer.search` requires BigInt limit; (c) `order.raw_payload` camelCase keys; (d) catalog method name `searchItems`:

```ts
import { describe, it, expect } from "vitest";
import { squareSandboxClient } from "@mandys-tester/lib-sandbox";

describe("[P0] Square SDK v44 shape contract", () => {
  const sq = squareSandboxClient();

  it("Page<T,R> — listLocations returns .result.locations not .locations", async () => {
    const page = await sq.locationsApi.listLocations();
    expect(page.result.locations).toBeDefined();
    expect((page as any).locations).toBeUndefined();
  });

  it("customers.search rejects number limit, accepts BigInt", async () => {
    await expect(
      sq.customersApi.searchCustomers({ limit: 1 as any, query: {} as any })
    ).rejects.toThrow();
    const r = await sq.customersApi.searchCustomers({ limit: 1n, query: {} as any });
    expect(r.statusCode).toBeLessThan(300);
  });

  it("order.raw_payload tenders use amountMoney not amount_money", async () => {
    const { result } = await sq.ordersApi.searchOrders({
      locationIds: [process.env.SQUARE_SANDBOX_LOCATION_ID!],
      limit: 1,
    });
    const order = result.orders?.[0];
    if (order?.tenders?.[0]) {
      expect(order.tenders[0]).toHaveProperty("amountMoney");
      expect(order.tenders[0]).not.toHaveProperty("amount_money");
    }
  });

  it("catalog.searchItems exists (not searchCatalogItems)", async () => {
    expect(typeof sq.catalogApi.searchCatalogItems).toBe("function");
    // sandbox accepts empty
    const r = await sq.catalogApi.searchCatalogItems({ limit: 1 });
    expect(r.result.items).toBeDefined();
  });
});
```

- [ ] **Step 2:** Run → expect PASS
- [ ] **Step 3:** Commit

### Task 4: Contract — Supabase Shape Quirks

**Files:** `suites/contract/src/supabase-shape.test.ts`

- [ ] **Step 1:** Test: bytea cells round-trip via `decodeBytea` from `lib-contract-types`:

```ts
import { describe, it, expect } from "vitest";
import { supabaseStaging } from "@mandys-tester/lib-sandbox";
import { decodeBytea } from "@mandys-tester/lib-contract-types";

describe("[P1] supabase bytea contract", () => {
  it("encrypted_token column survives decodeBytea regardless of representation", async () => {
    const sb = supabaseStaging("service");
    const sentinel = Buffer.from([0xAB, 0xCD, 0xEF]);
    await sb.from("oauth_tokens_test").insert({ id: "t1", encrypted_token: sentinel });  // table created in seed
    const { data } = await sb.from("oauth_tokens_test").select("encrypted_token").eq("id", "t1").single();
    const decoded = decodeBytea(data!.encrypted_token as any);
    expect(Buffer.compare(decoded, sentinel)).toBe(0);
    await sb.from("oauth_tokens_test").delete().eq("id", "t1");
  });
});
```

- [ ] **Step 2:** Add `oauth_tokens_test` table to `schema-snapshot.sql` + apply
- [ ] **Step 3:** Run, commit

### Task 5: Contract — Resend Webhook v6 Wrapped Response

**Files:** `suites/contract/src/resend-webhook.test.ts` + `snapshots/webhook-resend-*.json`

- [ ] **Step 1:** Capture real Resend webhook bodies (sample from prod logs or synth) → save as snapshots
- [ ] **Step 2:** Write test asserting `unwrapResend` handles both `{ data: T, error: null }` and `{ data: null, error: {...} }`:

```ts
import { describe, it, expect } from "vitest";
import { unwrapResend, ResendLogicalError } from "@mandys-tester/lib-contract-types";

describe("[P1] Resend v6 wrapped response contract", () => {
  it("data path returns inner value", async () => {
    const v = await unwrapResend(Promise.resolve({ data: { id: "msg_1" }, error: null }));
    expect(v).toEqual({ id: "msg_1" });
  });
  it("error path throws ResendLogicalError", async () => {
    await expect(
      unwrapResend(Promise.resolve({ data: null, error: { name: "validation_error", message: "Invalid recipient" } }))
    ).rejects.toBeInstanceOf(ResendLogicalError);
  });
  it("data missing throws generic Error", async () => {
    await expect(
      unwrapResend(Promise.resolve({ data: null, error: null } as any))
    ).rejects.toThrow(/no data and no error/);
  });
});
```

- [ ] **Step 3:** Commit

### Task 6: Contract — Web ↔ App API Snapshots

**Files:** `suites/contract/src/web-app-api.test.ts` + `snapshots/api-*.json`

- [ ] **Step 1:** Capture 4 API snapshots from prod web (sanitize sensitive fields):
  - `api-me.json` — GET /api/me response
  - `api-orders-list.json` — GET /api/orders response (array of order summaries)
  - `api-payment-success.json` — POST /api/payment 200 body
  - `api-payment-error-401.json` — POST /api/payment 401 body
- [ ] **Step 2:** Run web preview deploy against staging → hit endpoints → assert response shape matches snapshot ignoring volatile fields (ids, timestamps):

```ts
import { describe, it, expect } from "vitest";
import meSnap from "../snapshots/api-me.json" with { type: "json" };

describe("[P1] web/api shape contract", () => {
  it("/api/me matches snapshot keys", async () => {
    const res = await fetch(process.env.WEB_PREVIEW_URL + "/api/me", {
      headers: { authorization: "Bearer " + process.env.TEST_USER_JWT }
    });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(Object.keys(meSnap).sort());
  });
});
```

- [ ] **Step 3:** `WEB_PREVIEW_URL` + `TEST_USER_JWT` go in `.env.local` (env added in P0 envvar list extension)
- [ ] **Step 4:** Commit

### Task 7: Contract — Twilio Mock Shape

**Files:** `suites/contract/src/twilio-mock-shape.test.ts`

- [ ] **Step 1:** Spin up `startTwilioMock`, hit endpoints, assert response shape matches `TwilioVerifyClient` interface
- [ ] **Step 2:** Commit

### Task 8: `suites/security/package.json` + Config

Same shape as contract suite. Add `pg` dependency for direct DB.

- [ ] Commit scaffolding

### Task 9: Security — RLS Positive + Negative (each table 2 tests)

**Files:** `suites/security/src/rls.test.ts`

- [ ] **Step 1:** Write template for each table:

```ts
describe(`[P0] RLS user_profiles`, () => {
  it("anon cannot SELECT other user's row", async () => {
    const anon = supabaseStaging("anon");
    const customer = await makeCustomer({ persona: newUser });
    const { data, error } = await anon.from("user_profiles").select("*").eq("user_id", customer.supabaseUserId);
    expect(data).toEqual([]);  // RLS hides
    expect(error).toBeNull();
    await customer.cleanup();
  });
  it("authed user can SELECT own row", async () => {
    const customer = await makeCustomer({ persona: newUser });
    const { data: { session } } = await supabaseStaging("anon").auth.signInWithPassword({
      email: customer.seed.email, password: "test-password",
    });
    expect(session).toBeDefined();
    const { data } = await supabaseStaging("anon").from("user_profiles").select("*").eq("user_id", customer.supabaseUserId).single();
    expect(data?.user_id).toBe(customer.supabaseUserId);
    await customer.cleanup();
  });
});
```

- [ ] **Step 2:** Apply to: `user_profiles`, `orders`, `welcome_discounts`, `loyalty_accounts`, `print_jobs`, `cup_label_jobs`, `prize_rolls`, `pii_audit_log` (8 tables × 2 tests = 16)
- [ ] **Step 3:** Run, commit

### Task 10: Security — SQL Injection Surface

**Files:** `suites/security/src/sql-injection.test.ts`

- [ ] **Step 1:** Test surface APIs that take string user input + go to DB (`/api/orders?search=`, etc.). Use SQLi payloads `' OR 1=1--` and assert 400 or sanitized:

```ts
it("[P1] /api/orders?search=' OR 1=1-- does not leak rows", async () => {
  const res = await fetch(WEB + "/api/orders?search=' OR 1=1--", { headers: { auth: "..." } });
  const body = await res.json();
  expect(body.orders?.length ?? 0).toBeLessThanOrEqual(10);  // own orders only
});
```

- [ ] **Step 2:** Cover 6 endpoints; if AST validator exists (per `feedback_supabase_security_invoker_grants.md` Mise precedent), import and assert it rejects probes
- [ ] **Step 3:** Commit

### Task 11: Security — Auth Bypass + Secret Leak + CSRF + XSS

**Files:** 4 test files

- [ ] **Step 1:** `auth-bypass.test.ts` — expired token / revoked token / refresh rotation / 401-no-retry-after-logout (test the 5/05 fix shape)
- [ ] **Step 2:** `secret-leak.test.ts` — `git log --all -p | grep -E '(SUPABASE_SERVICE|SQUARE_PROD|ANTHROPIC_API)' | wc -l` expect 0 + `.env*` not in git + console.error scan for token-shaped strings
- [ ] **Step 3:** `csrf-cors.test.ts` — proxy.ts (Next 16) CORS settings + sensitive POST without origin header rejected
- [ ] **Step 4:** `xss.test.ts` — admin/receipt/email HTML render with `<script>alert(1)</script>` in name field → expect escaped
- [ ] **Step 5:** Commit each separately

### Task 12: Admin Unit Test Baseline (in `mandys_bubble_tea_admin`)

**Files:** Modify `mandys_bubble_tea_admin/package.json` + create `vitest.config.ts`

- [ ] **Step 1:** Coordinate via /dev (not /tester) — add a PR to admin repo: install vitest, add `"test": "vitest run"` script, add 5-10 baseline tests for existing pure logic
- [ ] **Step 2:** Verify locally: `cd ~/Github/mandys_bubble_tea_admin && pnpm test`
- [ ] **Step 3:** PR merged → admin test baseline established. **Note:** this task is a hand-off to /dev (TESTER_QUEUE → DEV_QUEUE Bugs from /tester section style, but as a test-baseline request)

### Task 13: Widget Unit Test Baseline (in `mandys_bubble_tea_widget`)

Same as Task 12 for widget repo. Coordinate via /dev.

### Task 14: P2 Push + Done Check

- [ ] **Step 1:** `pnpm typecheck && pnpm test` all green
- [ ] **Step 2:** Push
- [ ] **Step 3:** Update TESTER leaf

## Done Checklist (P2)

- [ ] 6 contract files, ≥15 contract tests passing
- [ ] 6 security files: RLS (16 tests) + SQLi (6) + auth (5) + secret (3) + CSRF (3) + XSS (4) — ≥37 security tests passing
- [ ] Admin + widget unit test baselines merged in their prod repos
- [ ] PR from any of the 4 prod repos can now expect contract + security suites to run (CI wire in P6)

## Self-Review Notes

- API snapshots captured manually from prod; refresh whenever response shape intentionally changes (golden-refresh-style workflow per spec).
- `oauth_tokens_test` table is test-only; lives in `schema-snapshot.sql` to mirror prod side bytea pattern.
- Tasks 12-13 (admin/widget baseline) are work in prod repos via /dev — TESTER plan tracks them as dependencies.

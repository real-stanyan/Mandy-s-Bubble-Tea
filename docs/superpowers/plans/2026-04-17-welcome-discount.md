# Welcome Discount (New User 30% Off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grant every newly-created Square customer a one-time 30% order-level discount, persisted in Supabase, auto-applied at checkout, surfaced as a home banner + account card + checkout line.

**Architecture:** Supabase owns discount state (`welcome_discounts` table + `consume_welcome_discount` RPC). Server-only helpers in `src/lib/supabase.ts`. New status GET endpoint. `/api/customer` grants on create. `/api/orders` applies an ad-hoc ORDER-scope 30% discount to the Square order. `/api/payment` calls the RPC on success. Three client surfaces read the status endpoint and render conditionally.

**Tech Stack:** Next.js App Router, TypeScript, Supabase JS client (already installed), Square Orders API.

**Spec:** `docs/superpowers/specs/2026-04-17-welcome-discount-design.md`

**Codebase note:** No unit-test framework in this repo. Verification uses `npx tsc --noEmit`, `curl` against the local dev server, and the cmux browser pane for UI. Each task ends with a git commit.

---

## File Structure

**Create:**
- `src/app/api/welcome-discount/status/route.ts` — GET status endpoint
- `src/components/account/WelcomeDiscountCard.tsx` — account page card
- `src/components/home/WelcomeDiscountBanner.tsx` — home page banner
- `supabase/migrations/2026-04-17-welcome-discount.sql` — schema migration (reference, run in Supabase SQL editor)

**Modify:**
- `src/lib/supabase.ts` — add `grantWelcomeDiscount`, `getWelcomeDiscountStatus`, `consumeWelcomeDiscount`
- `src/app/api/customer/route.ts` — grant on `created: true`
- `src/app/api/orders/route.ts` — accept `applyWelcomeDiscount`, attach Square discount
- `src/app/api/payment/route.ts` — consume on success, return flag
- `src/app/checkout/page.tsx` — fetch status, show discount line, pass flag, invalidate cache after payment
- `src/app/account/page.tsx` — render `<WelcomeDiscountCard>` when available
- `src/app/page.tsx` — render `<WelcomeDiscountBanner>` when available
- `src/app/account/promotions/page.tsx` — add read-only welcome discount entry

---

### Task 1: Supabase schema migration

**Files:**
- Create: `supabase/migrations/2026-04-17-welcome-discount.sql`
- Run (manual): Supabase SQL editor

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/2026-04-17-welcome-discount.sql` with:

```sql
-- Welcome discount: one-time 30% off for newly-created customers.
-- See docs/superpowers/specs/2026-04-17-welcome-discount-design.md

create table if not exists welcome_discounts (
  customer_id text primary key,
  state text not null default 'unused' check (state in ('unused','used')),
  percentage int not null default 30,
  granted_at timestamptz not null default now(),
  used_at timestamptz,
  order_id text
);

-- Atomic consume: flips state to 'used' only if currently 'unused'.
-- Returns empty if already used or row missing.
create or replace function consume_welcome_discount(
  p_customer_id text,
  p_order_id text
) returns table (consumed bool, percentage int)
language sql as $$
  update welcome_discounts
  set state = 'used', used_at = now(), order_id = p_order_id
  where customer_id = p_customer_id and state = 'unused'
  returning true as consumed, percentage;
$$;
```

- [ ] **Step 2: Apply in Supabase dashboard**

Run: Open Supabase project → SQL Editor → paste the SQL above → Run.
Expected: "Success. No rows returned."

- [ ] **Step 3: Verify table + function exist**

Run in SQL Editor:
```sql
select count(*) from welcome_discounts;
select consume_welcome_discount('nonexistent', 'nonexistent');
```
Expected: first returns `0`, second returns empty row set (no error).

- [ ] **Step 4: Commit**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
git add supabase/migrations/2026-04-17-welcome-discount.sql
git commit -m "feat(db): welcome_discounts table + consume RPC

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Supabase helpers

**Files:**
- Modify: `src/lib/supabase.ts`

- [ ] **Step 1: Add helper functions**

Append to `src/lib/supabase.ts` (leave the existing `getSupabase` internal helper and `nextOnlineOrderNumber` function untouched):

```typescript
/**
 * Insert a welcome_discounts row for a newly-created customer.
 * Idempotent via upsert with ignoreDuplicates. Called after a fresh
 * Square customer is created in /api/customer. Swallows errors — must
 * never block signup.
 */
export async function grantWelcomeDiscount(customerId: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("welcome_discounts")
      .upsert(
        { customer_id: customerId },
        { onConflict: "customer_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  } catch (err) {
    console.error("[welcome-discount] grant failed:", err);
  }
}

/**
 * Returns whether the customer has an unused welcome-discount row.
 * Returns { available: false, percentage: 0 } on any error (fail safe).
 */
export async function getWelcomeDiscountStatus(
  customerId: string,
): Promise<{ available: boolean; percentage: number }> {
  try {
    const { data, error } = await getSupabase()
      .from("welcome_discounts")
      .select("state,percentage")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { available: false, percentage: 0 };
    return {
      available: data.state === "unused",
      percentage: data.percentage ?? 30,
    };
  } catch (err) {
    console.error("[welcome-discount] status failed:", err);
    return { available: false, percentage: 0 };
  }
}

/**
 * Atomic consume via SQL function. Returns true iff this call was the
 * one that flipped the row from unused to used. Already-used, missing,
 * or errored → false (callers must not double-credit).
 */
export async function consumeWelcomeDiscount(
  customerId: string,
  orderId: string,
): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc(
      "consume_welcome_discount",
      { p_customer_id: customerId, p_order_id: orderId },
    );
    if (error) throw error;
    return Array.isArray(data) && data.length > 0 && data[0]?.consumed === true;
  } catch (err) {
    console.error("[welcome-discount] consume failed:", err);
    return false;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/stanyan/Github/mandys_bubble_tea && npx tsc --noEmit --pretty false`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat: supabase helpers for welcome discount grant/status/consume

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Grant on signup

**Files:**
- Modify: `src/app/api/customer/route.ts`

- [ ] **Step 1: Call grantWelcomeDiscount on fresh customer create**

In `src/app/api/customer/route.ts` add an import at the top (after the existing imports):

```typescript
import { grantWelcomeDiscount } from "@/lib/supabase";
```

Find this block:

```typescript
    const newId = created.customer?.id;
    if (!newId) {
      return NextResponse.json(
        { ok: false, error: "Square did not return a customer id" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      customerId: newId,
      phoneE164: e164,
      created: true,
    });
```

Change it to:

```typescript
    const newId = created.customer?.id;
    if (!newId) {
      return NextResponse.json(
        { ok: false, error: "Square did not return a customer id" },
        { status: 502 },
      );
    }

    // Fire-and-forget grant. grantWelcomeDiscount swallows its own
    // errors so signup never fails because of Supabase.
    await grantWelcomeDiscount(newId);

    return NextResponse.json({
      ok: true,
      customerId: newId,
      phoneE164: e164,
      created: true,
    });
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/stanyan/Github/mandys_bubble_tea && npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 3: Manual signup test**

Start the dev server (in background) if not running:
```bash
cd /Users/stanyan/Github/mandys_bubble_tea && npm run dev
```

POST a fake signup with a phone number you have NOT used before:
```bash
curl -s http://localhost:3000/api/customer \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Test","lastName":"Welcome","phone":"0400000099"}'
```
Expected: `{"ok":true,"customerId":"...","phoneE164":"+61400000099","created":true}`

Then verify a row was inserted (Supabase SQL editor):
```sql
select * from welcome_discounts where customer_id = '<customerId from response>';
```
Expected: one row, state = 'unused'.

Call the same endpoint again with the same phone:
```bash
curl -s http://localhost:3000/api/customer \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Test","lastName":"Welcome","phone":"0400000099"}'
```
Expected: `"created": false`. Re-check DB: still only one row (no duplicate).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/customer/route.ts
git commit -m "feat(api): grant welcome discount on new customer create

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Status GET endpoint

**Files:**
- Create: `src/app/api/welcome-discount/status/route.ts`

- [ ] **Step 1: Write the endpoint**

Create `src/app/api/welcome-discount/status/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getWelcomeDiscountStatus } from "@/lib/supabase";

// Read-only status endpoint. Used by home banner, account card, and
// checkout. Returns `{ ok: true, available: boolean, percentage: number }`.
// Missing / invalid customerId → `available: false` (never errors out).

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) {
    return NextResponse.json({ ok: true, available: false, percentage: 0 });
  }
  const status = await getWelcomeDiscountStatus(customerId);
  return NextResponse.json({ ok: true, ...status });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/stanyan/Github/mandys_bubble_tea && npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 3: Manual test**

Using the customerId created in Task 3:
```bash
curl -s 'http://localhost:3000/api/welcome-discount/status?customerId=<CUSTOMER_ID>'
```
Expected: `{"ok":true,"available":true,"percentage":30}`

Missing param:
```bash
curl -s 'http://localhost:3000/api/welcome-discount/status'
```
Expected: `{"ok":true,"available":false,"percentage":0}`

Unknown id:
```bash
curl -s 'http://localhost:3000/api/welcome-discount/status?customerId=NOPE'
```
Expected: `{"ok":true,"available":false,"percentage":0}`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/welcome-discount/status/route.ts
git commit -m "feat(api): welcome-discount status endpoint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Apply discount on order create

**Files:**
- Modify: `src/app/api/orders/route.ts`

- [ ] **Step 1: Accept the flag and re-validate server-side**

In `src/app/api/orders/route.ts`:

Add import at top:
```typescript
import { getWelcomeDiscountStatus } from "@/lib/supabase";
```

Change the `CreateOrderBody` type to include the new field:

```typescript
type CreateOrderBody = {
  lines: ClientLine[];
  customerId: string;
  recipientName: string;
  recipientPhone: string;
  note?: string;
  applyWelcomeDiscount?: boolean;
};
```

The `isValidBody` function doesn't need to check `applyWelcomeDiscount` (it's optional boolean; a wrong type will fall through to the default `false` branch harmlessly).

- [ ] **Step 2: Build the discount payload server-side**

Right BEFORE the `squareClient.orders.create({...})` call, insert:

```typescript
    // Server-verify welcome discount before attaching it. Client is NOT
    // trusted — a request with applyWelcomeDiscount:true but no unused
    // row in Supabase is silently treated as "no discount".
    let welcomeDiscounts:
      | Array<{ uid: string; name: string; percentage: string; scope: "ORDER" }>
      | undefined;
    if (body.applyWelcomeDiscount) {
      const status = await getWelcomeDiscountStatus(body.customerId);
      if (status.available) {
        welcomeDiscounts = [
          {
            uid: "welcome-discount",
            name: "Welcome 30% Off",
            percentage: String(status.percentage || 30),
            scope: "ORDER",
          },
        ];
      }
    }
```

Then modify the order payload to include `discounts`. Change:

```typescript
    const response = await squareClient.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId: SQUARE_LOCATION_ID,
        customerId: body.customerId,
        referenceId: pickupNumber,
        ticketName: pickupNumber,
        lineItems,
        fulfillments: [...],
        metadata: { source: "web", site: BUSINESS.domain },
      },
    });
```

to:

```typescript
    const response = await squareClient.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId: SQUARE_LOCATION_ID,
        customerId: body.customerId,
        referenceId: pickupNumber,
        ticketName: pickupNumber,
        lineItems,
        discounts: welcomeDiscounts,
        fulfillments: [
          {
            type: "PICKUP",
            state: "PROPOSED",
            pickupDetails: {
              scheduleType: "ASAP",
              pickupAt,
              recipient: {
                customerId: body.customerId,
                displayName: body.recipientName,
                phoneNumber: body.recipientPhone,
              },
              note: [pickupNumber, body.note].filter(Boolean).join(" — "),
            },
          },
        ],
        metadata: {
          source: "web",
          site: BUSINESS.domain,
        },
      },
    });
```

(Keep the existing `fulfillments` and `metadata` structure intact — only the `discounts: welcomeDiscounts,` line is added.)

- [ ] **Step 3: Typecheck**

Run: `cd /Users/stanyan/Github/mandys_bubble_tea && npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 4: Manual order-create test**

Using the customerId from Task 3 and any known variationId from `/api/catalog` (grab via `curl http://localhost:3000/api/catalog | jq '.items[0].variations[0].id' -r`):

```bash
curl -s http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId":"<CUSTOMER_ID>",
    "recipientName":"Test",
    "recipientPhone":"+61400000099",
    "applyWelcomeDiscount":true,
    "lines":[{"itemName":"x","variationId":"<VARIATION_ID>","modifiers":[],"quantity":1}]
  }' | jq '.order.discounts, .amountCents, .order.totalMoney'
```
Expected: `.order.discounts` contains the Welcome 30% Off entry; `.amountCents` is 70% of the item price (rounded by Square).

Repeat with `applyWelcomeDiscount:false`:
Expected: `.order.discounts` is null/undefined; `.amountCents` matches the full price.

Client-spoof test (set `applyWelcomeDiscount:true` but use a customerId with NO welcome_discounts row, e.g., an existing customerId in Square that's not in Supabase):
Expected: no discount applied, `.amountCents` full price.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/orders/route.ts
git commit -m "feat(api): attach welcome discount to Square order when available

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Consume on payment success

**Files:**
- Modify: `src/app/api/payment/route.ts`

- [ ] **Step 1: Call consume + return flag**

In `src/app/api/payment/route.ts`:

Add import at top:
```typescript
import { consumeWelcomeDiscount } from "@/lib/supabase";
```

Inside the main `try` block, AFTER the loyalty accrual block (find the line `let loyaltyAccrued = false;` and locate the closing of that loyalty `if` block — the one that ends before `return NextResponse.json({ ok: true, ...})`).

Right BEFORE that `return NextResponse.json({...})`, insert:

```typescript
    // Consume the welcome discount if this order had one applied.
    // We inspect the order we already fetched (orderResponse.order.discounts)
    // instead of trusting the client, so this runs for every paid order
    // whose Square order carries the "welcome-discount" uid.
    let welcomeDiscountConsumed = false;
    const hadWelcomeDiscount = (order.discounts ?? []).some(
      (d) => d.uid === "welcome-discount",
    );
    if (hadWelcomeDiscount && body.customerId) {
      welcomeDiscountConsumed = await consumeWelcomeDiscount(
        body.customerId,
        body.orderId,
      );
    }
```

Then extend the return JSON. Change:

```typescript
    return NextResponse.json({
      ok: true,
      paymentId,
      status: paymentStatus,
      loyaltyAccrued,
      payment: paymentForResponse,
    });
```

to:

```typescript
    return NextResponse.json({
      ok: true,
      paymentId,
      status: paymentStatus,
      loyaltyAccrued,
      welcomeDiscountConsumed,
      payment: paymentForResponse,
    });
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/stanyan/Github/mandys_bubble_tea && npx tsc --noEmit --pretty false`
Expected: exit 0.

- [ ] **Step 3: Defer manual test to Task 7**

Full end-to-end runs through the checkout UI, so we verify it live at the end of Task 7. The payment route is a server-internal change — no new UI surface.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/payment/route.ts
git commit -m "feat(api): consume welcome discount on successful payment

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Checkout UI — status fetch, discount line, submit flag, cache invalidate

**Files:**
- Modify: `src/app/checkout/page.tsx`

- [ ] **Step 1: Add welcome-discount state + fetch**

In `src/app/checkout/page.tsx`, after the existing `loyaltyLookup` state declaration (around line 78), add:

```typescript
  const [welcomeDiscount, setWelcomeDiscount] = useState<
    { available: false } | { available: true; percentage: number }
  >({ available: false });
```

Extend `lookupLoyalty` so it ALSO fetches the welcome-discount status once the customerId is known. Locate the block that sets `setLoyaltyLookup({ status: "ready", customerId: customerJson.customerId, ... })` after the loyalty fetch. Immediately after that `setLoyaltyLookup` call, add:

```typescript
      // Welcome discount lookup (piggybacks on the same customerId).
      if (customerJson.customerId) {
        try {
          const wdRes = await fetch(
            `/api/welcome-discount/status?customerId=${encodeURIComponent(customerJson.customerId)}`,
          );
          const wdJson = await wdRes.json();
          if (wdJson?.available) {
            setWelcomeDiscount({
              available: true,
              percentage: wdJson.percentage ?? 30,
            });
          } else {
            setWelcomeDiscount({ available: false });
          }
        } catch {
          setWelcomeDiscount({ available: false });
        }
      }
```

- [ ] **Step 2: Compute the discount amount for display**

Below the existing `rewardDiscount` `useMemo` (around line 108), add:

```typescript
  // Welcome discount display amount. Square recomputes the real total
  // server-side; this is only for showing the "−$X.XX" line while the
  // user is reviewing the cart.
  const welcomeDiscountAmount = useMemo(() => {
    if (!welcomeDiscount.available) return 0n;
    // 30% off subtotal, rounded to nearest cent (matches Square's math
    // for ORDER-scope percentage discounts closely enough for display).
    const pct = BigInt(welcomeDiscount.percentage);
    return (subtotal * pct) / 100n;
  }, [subtotal, welcomeDiscount]);
```

- [ ] **Step 3: Render the discount line in Order Summary (desktop + mobile)**

The desktop Order Summary block is around line 999. Find:

```tsx
              <span>Subtotal</span>
              ...
              <span>
                {formatPrice(subtotal)}
              </span>
```

Right after the subtotal line (and before the existing loyalty `rewardDiscount` line if any), insert:

```tsx
            {welcomeDiscount.available && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: BRAND.primaryColor }}
                  />
                  Welcome 30% Off
                </span>
                <span style={{ color: BRAND.primaryColor }}>
                  −{formatPrice(welcomeDiscountAmount)}
                </span>
              </div>
            )}
```

Do the equivalent for the mobile collapsible Order Summary block (around line 782-810). Find the loyalty rewardDiscount row there and insert a parallel welcome-discount row right above it.

Update the "Total" displays in both places so they subtract `welcomeDiscountAmount` too. The existing expressions look like:

```tsx
{canRedeemFully && useReward
  ? formatPrice(subtotal - rewardDiscount > 0n ? subtotal - rewardDiscount : 0n)
  : formatPrice(subtotal)}
```

Change the `else` branch (the `: formatPrice(subtotal)`) to:

```tsx
: formatPrice(
    welcomeDiscount.available
      ? (subtotal - welcomeDiscountAmount > 0n
          ? subtotal - welcomeDiscountAmount
          : 0n)
      : subtotal,
  )
```

Apply the same change to the two other total displays on this page (there are three `: formatPrice(subtotal)` spots flagged in the search: lines ~790, ~1039, ~1092).

- [ ] **Step 4: Pass the flag to /api/orders**

Find the `fetch("/api/orders", ...)` call around line 572. Extend its JSON body. Change:

```typescript
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerJson.customerId,
          recipientName: name.trim(),
          recipientPhone: phone.trim(),
          note: note.trim() || undefined,
          lines: lines.map((l) => ({...})),
        }),
      });
```

to (adding one field):

```typescript
      const orderRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerJson.customerId,
          recipientName: name.trim(),
          recipientPhone: phone.trim(),
          note: note.trim() || undefined,
          applyWelcomeDiscount: welcomeDiscount.available,
          lines: lines.map((l) => ({
            itemName: l.itemName,
            variationId: l.variationId,
            variationName: l.variationName,
            modifiers: l.modifiers.map((m) => ({ id: m.id, name: m.name })),
            quantity: l.quantity,
          })),
        }),
      });
```

- [ ] **Step 5: Invalidate cache after payment success**

The payment POST lives later in `handleSubmit`. Locate the block that parses `paymentJson` after `fetch("/api/payment", ...)`. After the existing success-handling (right after the `paymentJson.ok` check and before the `router.push` to the order-confirmation page), insert:

```typescript
      // If the server consumed our welcome discount, refresh local state
      // so banner/card/line disappear on next render and drop any cached
      // "available: true" response.
      if (paymentJson.welcomeDiscountConsumed) {
        setWelcomeDiscount({ available: false });
        try {
          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k?.includes("welcome-discount:status")) {
              sessionStorage.removeItem(k);
            }
          }
        } catch {
          // ignore
        }
      }
```

(The cache key collision is harmless — the checkout page fetches via raw `fetch`, not `cachedPost`, so sessionStorage is only carrying entries from the banner/card. Clearing any match is a belt-and-braces move.)

- [ ] **Step 6: Typecheck + lint**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit --pretty false
npx eslint src/app/checkout/page.tsx
```
Expected: both exit 0.

- [ ] **Step 7: Browser verify**

Dev server should still be running (port 3000). Open the cmux browser pane:
```bash
cmux new-pane --type browser --direction right --url http://localhost:3000/menu
```

Manual flow:
1. Add any drink to cart.
2. Proceed to checkout.
3. Enter a fresh phone (`0400000099` used in Task 3 should work; if already consumed re-insert a fresh row in Supabase or use a different phone via the OTP flow).
4. Verify the Order Summary shows "Welcome 30% Off −$X.XX" line.
5. Fill card form (use Square sandbox test card `4111 1111 1111 1111`, any future date, any CVV, any postcode) and submit.
6. After confirmation page renders, reload and go back to checkout or account — the discount UI should no longer appear.

Also check:
```bash
cmux browser --surface surface:<ID> errors list
cmux browser --surface surface:<ID> console list
```
Expected: no runtime errors tied to welcome discount.

Verify Supabase:
```sql
select state, used_at, order_id from welcome_discounts where customer_id = '<CUSTOMER_ID>';
```
Expected: `state = 'used'`, `used_at` populated, `order_id` = the Square order id.

- [ ] **Step 8: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "feat(checkout): show welcome discount line, pass flag, invalidate on consume

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Account page card

**Files:**
- Create: `src/components/account/WelcomeDiscountCard.tsx`
- Modify: `src/app/account/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/account/WelcomeDiscountCard.tsx`:

```typescript
"use client";

import Link from "next/link";
import { BRAND } from "@/lib/constants";

type Props = {
  percentage: number;
};

export function WelcomeDiscountCard({ percentage }: Props) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-8"
      aria-label="Welcome discount"
    >
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full opacity-[0.08]"
        style={{ backgroundColor: BRAND.primaryColor }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: BRAND.primaryColor }}
          >
            Welcome Gift
          </p>
          <h3 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
            {percentage}% OFF
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            Your first order — auto-applied at checkout.
          </p>
        </div>
        <Link
          href="/menu"
          className="self-start rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 sm:self-auto"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          View Menu →
        </Link>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire into AccountDashboard**

In `src/app/account/page.tsx`:

Add import near the top (next to the existing `MemberQrCard` dynamic import):

```typescript
import { WelcomeDiscountCard } from "@/components/account/WelcomeDiscountCard";
```

Extend the `AccountData` type to carry welcome-discount status:

```typescript
type AccountData = {
  customerId: string;
  givenName: string | null;
  familyName: string | null;
  phoneE164: string;
  loyalty: LoyaltyInfo;
  orders: OrderHistoryItem[];
  welcomeDiscount: { available: boolean; percentage: number };
};
```

In `hydrateDashboard`, after the existing `Promise.all([loyaltyRes, ordersRes])`, fetch the welcome-discount status too. Change:

```typescript
      const [loyaltyRes, ordersRes] = await Promise.all([...]);
      const loyaltyJson = await loyaltyRes.json();
      const ordersJson = await ordersRes.json();
```

to:

```typescript
      const [loyaltyRes, ordersRes, welcomeRes] = await Promise.all([
        fetch("/api/loyalty/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId, phone: phoneE164 }),
        }),
        fetch("/api/orders/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId }),
        }),
        fetch(
          `/api/welcome-discount/status?customerId=${encodeURIComponent(customerId)}`,
        ),
      ]);
      const loyaltyJson = await loyaltyRes.json();
      const ordersJson = await ordersRes.json();
      const welcomeJson = await welcomeRes.json().catch(() => null);
```

(This replaces the existing `Promise.all` block entirely. Leave the rest of the function — the `setData` call — intact, but extend it to pass the new field.)

Extend the `setData({...})` call:

```typescript
      setData({
        customerId,
        givenName,
        familyName,
        phoneE164,
        loyalty: { ... },
        orders: ordersJson.orders ?? [],
        welcomeDiscount: {
          available: !!welcomeJson?.available,
          percentage: welcomeJson?.percentage ?? 0,
        },
      });
```

Finally, render the card. In `AccountDashboard`, below `<MemberQrCard>` and above the Loyalty card, add:

```tsx
      {data.welcomeDiscount.available && (
        <WelcomeDiscountCard percentage={data.welcomeDiscount.percentage} />
      )}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit --pretty false
```
Expected: exit 0.

- [ ] **Step 4: Browser verify**

Log into `/account` as the Task-3 test customer (who has an unused discount):
```bash
cmux browser --surface surface:<ID> goto http://localhost:3000/account
```

Sign in with the phone `0400000099`. Expected: card appears below MemberQrCard showing `30% OFF`. Clicking "View Menu" navigates to `/menu`.

Consume it (place an order end-to-end as in Task 7), come back to `/account`. Expected: card no longer shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/WelcomeDiscountCard.tsx src/app/account/page.tsx
git commit -m "feat(account): welcome discount card

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Home banner

**Files:**
- Create: `src/components/home/WelcomeDiscountBanner.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create the banner component**

Create `src/components/home/WelcomeDiscountBanner.tsx`:

```typescript
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";

const DISMISS_KEY = "mbt:welcome-discount:dismissed";
const PHONE_KEY = "mbt:account:phone";

export function WelcomeDiscountBanner() {
  const [visible, setVisible] = useState(false);
  const [percentage, setPercentage] = useState(30);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (sessionStorage.getItem(DISMISS_KEY)) return;
        const phone = localStorage.getItem(PHONE_KEY);
        if (!phone) return;

        // Resolve phone → customerId via the lookup endpoint.
        const lookupRes = await fetch("/api/customer/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        const lookup = await lookupRes.json();
        if (!lookup?.found || !lookup?.customerId) return;

        const statusRes = await fetch(
          `/api/welcome-discount/status?customerId=${encodeURIComponent(lookup.customerId)}`,
        );
        const status = await statusRes.json();
        if (cancelled) return;
        if (status?.available) {
          setPercentage(status.percentage ?? 30);
          setVisible(true);
        }
      } catch {
        // Silent — banner is purely promotional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="relative mx-auto mt-3 flex w-full max-w-6xl items-center justify-between gap-3 rounded-2xl px-5 py-4 text-white shadow-sm sm:px-6 sm:py-5"
      style={{ backgroundColor: BRAND.primaryColor }}
      role="status"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-widest opacity-90">
          Your Welcome Gift
        </p>
        <p className="mt-0.5 text-sm font-semibold sm:text-base">
          {percentage}% off your first order — auto-applied at checkout
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/menu"
          className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold sm:text-sm"
          style={{ color: BRAND.primaryColor }}
        >
          Order Now
        </Link>
        <button
          type="button"
          aria-label="Dismiss welcome discount banner"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // ignore
            }
            setVisible(false);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
        >
          ×
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the home page**

Open `src/app/page.tsx`. Add import:

```typescript
import { WelcomeDiscountBanner } from "@/components/home/WelcomeDiscountBanner";
```

Find the topmost point in the JSX where a wrapper `<main>` or outer div renders. Insert `<WelcomeDiscountBanner />` as the first child of that wrapper (above the hero / any existing sections).

(If the home page is a server component and the wrapper is such that directly inserting a `"use client"` component is fine — it is, Next 15/16 handles this — proceed. If the home is itself a client component the same placement still works.)

- [ ] **Step 3: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit --pretty false
```
Expected: exit 0.

- [ ] **Step 4: Browser verify**

```bash
cmux browser --surface surface:<ID> goto http://localhost:3000/
```
Expected: with a signed-in test customer that has `available: true`, banner shows at the top. Click × → banner hides this session. Reload tab → banner reappears (sessionStorage cleared). Open fresh incognito / different customer with no discount → banner absent.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/WelcomeDiscountBanner.tsx src/app/page.tsx
git commit -m "feat(home): welcome discount banner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Promotions page read-only entry

**Files:**
- Modify: `src/app/account/promotions/page.tsx`

- [ ] **Step 1: Fetch status + render an info row**

Open `src/app/account/promotions/page.tsx`. In the same effect that already calls `/api/customer/lookup` + `/api/loyalty/account`, add a parallel fetch to `/api/welcome-discount/status` using the resolved `customer.customerId`.

Add a new promotion entry to the `promotions` list when:
- `available: true` → `{ id: 'welcome-30', title: 'Welcome 30% Off', description: 'Auto-applied at checkout on your next order.', available: true, tag: 'ACTIVE' }`
- `available: false` AND the customer has previously consumed it (signal: any past order with a welcome-discount line item — skip this detection for now, just omit the entry when unavailable). Simpler spec: only show when available.

Concrete snippet — after `const loyalty = await loyaltyRes.json();`:

```typescript
        let welcomeDiscountAvailable = false;
        let welcomeDiscountPct = 30;
        try {
          const wdRes = await fetch(
            `/api/welcome-discount/status?customerId=${encodeURIComponent(customer.customerId)}`,
          );
          const wd = await wdRes.json();
          welcomeDiscountAvailable = !!wd?.available;
          welcomeDiscountPct = wd?.percentage ?? 30;
        } catch {
          // Silent — promotions page is informational only.
        }
```

Extend `buildPromotions` (defined elsewhere in the same file) to accept and prepend the welcome-discount entry. If it's cleaner to do it inline here, replace:

```typescript
        setPromotions(buildPromotions(balance, starsPerReward, rewardsAvailable));
```

with:

```typescript
        const base = buildPromotions(balance, starsPerReward, rewardsAvailable);
        const list: PromotionItem[] = [];
        if (welcomeDiscountAvailable) {
          list.push({
            id: "welcome-discount",
            title: `Welcome ${welcomeDiscountPct}% Off`,
            description: "Auto-applied at checkout on your next order.",
            available: true,
            tag: "ACTIVE",
          });
        }
        list.push(...base);
        setPromotions(list);
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit --pretty false
```
Expected: exit 0.

- [ ] **Step 3: Browser verify**

```bash
cmux browser --surface surface:<ID> goto http://localhost:3000/account/promotions
```
Expected: a new "Welcome 30% Off" card appears above the loyalty entries with an ACTIVE tag when the customer has an unused discount. After consuming, the entry disappears on reload.

- [ ] **Step 4: Commit**

```bash
git add src/app/account/promotions/page.tsx
git commit -m "feat(promotions): surface welcome discount on promotions page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end manual QA

**Files:** none (verification pass)

- [ ] **Step 1: Run full typecheck + lint from a clean tree**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit --pretty false
npx eslint .
```
Expected: both exit 0.

- [ ] **Step 2: New user golden-path**

Use a fresh phone number that has never been used. Steps:
1. Go to `/account`, sign in with the fresh number → OTP flow → enter name → account page renders.
2. Check Supabase: `select * from welcome_discounts where customer_id = <id>` → one row, `unused`.
3. Account page shows the Welcome 30% OFF card.
4. Home page `/` shows the banner.
5. Click Order Now → add any item → proceed to checkout.
6. Order Summary shows "Welcome 30% Off −$X.XX" line; total equals subtotal × 0.7.
7. Pay with the sandbox card `4111 1111 1111 1111`.
8. Order confirmation page loads with the discounted total.
9. Reload `/account`, `/`, and `/account/promotions` — welcome discount UI is absent everywhere.
10. Supabase: row is now `state = 'used'`, `used_at` populated, `order_id` populated.

- [ ] **Step 3: Existing user regression**

Sign in with a pre-existing phone that has NO row in `welcome_discounts`. Expected: no banner, no account card, checkout has no welcome line, full-price total.

- [ ] **Step 4: Commit (if any doc updates needed)**

No code changes expected from QA. If QA surfaces bugs, fix them in a new task slot and commit separately.

---

## Self-Review Checklist

**Spec coverage (cross-ref against the spec file):**
- Data model (table + RPC) — Task 1 ✓
- Grant on /api/customer creation — Task 3 ✓
- Status GET endpoint — Task 4 ✓
- /api/orders accepts applyWelcomeDiscount + server re-verifies — Task 5 ✓
- /api/payment consumes on success + returns flag — Task 6 ✓
- Checkout UI: fetch, display line, submit flag, invalidate cache — Task 7 ✓
- Home banner (with session-dismiss) — Task 9 ✓
- Account card — Task 8 ✓
- Promotions page read-only entry — Task 10 ✓
- E2E QA — Task 11 ✓

**Non-goals** (no code for these; sanity re-check that tasks haven't introduced them):
- No manual promo code field — plan does not mention one ✓
- No expiry logic — plan does not mention one ✓
- No admin rate override — percentage comes from DB default (30) ✓
- No refund restore / webhook — out of scope ✓

**Type consistency:**
- `grantWelcomeDiscount(customerId: string): Promise<void>` — used in Task 3 ✓
- `getWelcomeDiscountStatus(customerId): Promise<{available, percentage}>` — used in Task 4 (route handler) and Task 5 (orders route) ✓
- `consumeWelcomeDiscount(customerId, orderId): Promise<boolean>` — used in Task 6 ✓
- Client `welcomeDiscount` discriminated union — used Task 7, Task 8 ✓
- Square discount payload shape — `{ uid, name, percentage, scope }` — Task 5 ✓

---

## Notes for implementer

- Every task is self-contained: typecheck, manual verify, commit.
- Do NOT skip the server-side re-verification in Task 5. Client cannot be trusted — the spec calls this out explicitly.
- The two hairy spots are (a) finding the three `: formatPrice(subtotal)` call sites in checkout (ctrl-F for exact string; Task 7 lists them: mobile collapsed total, desktop total, sticky mobile pay bar total), and (b) the `discounts: welcomeDiscounts` placement inside the order payload (same object level as `lineItems` and `fulfillments`).
- If Square's returned `totalMoney` disagrees with the client's `subtotal × 0.70` by 1 cent due to rounding, that's expected — trust Square. The checkout page already sends `Number(subtotal) / 100` to Apple Pay as the amount to authorize, which is the pre-discount value. That's fine: the ACTUAL charge is recomputed from the Square order by `/api/payment` from `orderResponse.order.totalMoney` regardless of what the wallet authorized as a ceiling.
- After all tasks complete, update `~/system/DEV_QUEUE.md` and `~/system/DEV_HANDOFF.md`.

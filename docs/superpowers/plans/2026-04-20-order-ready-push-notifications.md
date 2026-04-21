# Order-Ready APNs Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a barista marks an order as ready in Square, push an Apple notification to the customer's iPhone so they know to pick it up — works even if the app is backgrounded or fully killed.

**Architecture:** Square webhook (`order.fulfillment.updated`, state=`PREPARED`) → Next.js endpoint → lookup customer's Supabase user → fan out Expo Push (`ExponentPushToken[...]`) → Expo forwards to APNs → iOS delivers local-style alert. Idempotency table prevents dupe sends if Square re-delivers the webhook. Device tokens registered by the RN app on first launch after login; bad tokens pruned on Expo `DeviceNotRegistered` receipts.

**Tech Stack:** Expo SDK 54 + `expo-notifications` (client), `expo-server-sdk` + Supabase service-role client (server), Apple Push Notification Auth Key (`.p8`) uploaded to EAS credentials, Square Orders webhook + Orders API for customer lookup.

---

## File Structure

### Web backend (`~/Github/mandys_bubble_tea`)
- **Create** `supabase/migrations/2026-04-20-push-notifications.sql` — `device_push_tokens` + `order_push_notifications` tables
- **Create** `src/lib/push.ts` — Expo Push send + receipt handling
- **Create** `src/lib/push-tokens.ts` — upsert / delete / list tokens for a user
- **Create** `src/app/api/device-push-token/route.ts` — POST register, DELETE revoke
- **Modify** `src/app/api/webhooks/square/route.ts` — handle `order.fulfillment.updated`

### RN app (`~/Github/mandys_bubble_tea_app`)
- **Modify** `package.json` — add `expo-notifications` + `expo-device`
- **Modify** `app.json` — add `expo-notifications` plugin + `aps-environment` entitlement
- **Create** `lib/push-registration.ts` — token acquisition + upload logic
- **Create** `hooks/use-push-notifications.ts` — permission + register + listeners
- **Modify** `app/_layout.tsx` — mount `useReadyVibration` → replace with `usePushNotifications` (or add alongside) + tap-to-route handler
- **Modify** `components/auth/AuthProvider.tsx` (optional alt mount site) — fire registration after profile hydrates

### Ops / credentials
- Apple Developer Portal → create APN Auth Key (`.p8`)
- `eas credentials` → iOS → upload `.p8`
- Square Developer Dashboard → enable `order.fulfillment.updated` in the production webhook
- Vercel → verify `SQUARE_WEBHOOK_SIGNATURE_KEY` / `SQUARE_WEBHOOK_NOTIFICATION_URL` already set (they are, per `customer.deleted` path)

---

## Context notes for the engineer

### Square webhook payload shape for `order.fulfillment.updated`
```json
{
  "type": "order.fulfillment.updated",
  "event_id": "...",
  "merchant_id": "...",
  "data": {
    "type": "order_fulfillment_updated",
    "id": "<order_id>",
    "object": {
      "order_fulfillment_updated": {
        "order_id": "<order_id>",
        "version": 3,
        "location_id": "...",
        "state": "OPEN",
        "fulfillment_update": [
          {
            "fulfillment_uid": "...",
            "old_state": "PROPOSED",
            "new_state": "PREPARED"
          }
        ]
      }
    }
  }
}
```
The new state we care about is **`PREPARED`** (not `READY` — Square's internal term for "ready for pickup" on PICKUP fulfillments is `PREPARED`). Other transitions (`PROPOSED`→`RESERVED`, `PREPARED`→`COMPLETED`) are ignored.

The event does NOT include the customer id. We must call `ordersApi.retrieveOrder(orderId)` to get `order.customerId`, then look up `user_profiles.square_customer_id`.

### Expo push token vs raw APNs token
Using **Expo push tokens** (`ExponentPushToken[...]`) via `Notifications.getExpoPushTokenAsync({ projectId })`. Reasons: the app is already fully Expo-managed; Expo handles APNs credential rotation; `expo-server-sdk` batches and chunks sends. The tradeoff (one extra hop through Expo's push service) is acceptable for pickup notifications where multi-second delay doesn't matter.

APN Auth Key (`.p8`) is uploaded once to EAS credentials and Expo uses it to talk to APNs on our behalf. No `.p8` in our env vars.

### Existing local READY detection
`hooks/use-ready-vibration.ts` already detects READY transitions while the app is foreground (via polling) and triggers a haptic. We'll keep it — the remote push + local haptic are complementary. When the app is foreground and receives the remote push, we set `Notifications.setNotificationHandler` to still show the banner (since foreground iOS suppresses by default).

### Dedupe key choice
`(order_id, 'ready')` — one "ready" push per order, ever. If Square re-delivers the webhook (they do on 500/5xx responses from us), the insert hits the unique constraint and we skip the send.

### Auth on the token-register endpoint
Mobile app calls via `apiFetch` which attaches `Authorization: Bearer <supabase jwt>`. Server validates via `getAuthedUser(request)` (already handles bearer path). If `user.profile == null` we still register the token against `user.userId` — the user is authed, just hasn't finished phone linking. But the webhook pathway only finds users via `user_profiles.square_customer_id`, so unlinked users won't receive pushes until they complete signup. That's fine — they also can't place orders yet.

---

## Phase 1 — Supabase schema

### Task 1.1: Create migration file

**Files:**
- Create: `supabase/migrations/2026-04-20-push-notifications.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Device push tokens + idempotent order-ready send ledger.
-- See docs/superpowers/plans/2026-04-20-order-ready-push-notifications.md

create table if not exists device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_id_idx
  on device_push_tokens (user_id);

-- One row per (order, event kind) prevents duplicate pushes when
-- Square redelivers the webhook (they retry on non-2xx). Insert with
-- onConflict=ignore: if the insert succeeded, send the push; if it
-- was a no-op, the push already went out.
create table if not exists order_push_notifications (
  order_id text not null,
  kind text not null check (kind in ('ready')),
  sent_at timestamptz not null default now(),
  primary key (order_id, kind)
);
```

- [ ] **Step 2: Commit the migration**

```bash
cd ~/Github/mandys_bubble_tea
git add supabase/migrations/2026-04-20-push-notifications.sql
git commit -m "feat(db): add device_push_tokens + order_push_notifications tables"
```

### Task 1.2: Apply migration to hosted Supabase

- [ ] **Step 1: Open Supabase SQL editor**

Go to https://supabase.com/dashboard/project/<PROJECT_REF>/sql/new

- [ ] **Step 2: Paste the migration body and run**

Paste the contents of `supabase/migrations/2026-04-20-push-notifications.sql`. Click **Run**. Expected: "Success. No rows returned."

- [ ] **Step 3: Verify tables exist**

In SQL editor run:
```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('device_push_tokens', 'order_push_notifications');
```
Expected: 2 rows returned.

---

## Phase 2 — Server-side push helpers

### Task 2.1: Install `expo-server-sdk`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
cd ~/Github/mandys_bubble_tea
npm install expo-server-sdk
```

- [ ] **Step 2: Verify**

Run: `npm list expo-server-sdk`
Expected: `expo-server-sdk@<version>` printed; no extraneous warnings about peer deps.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add expo-server-sdk for push notifications"
```

### Task 2.2: `src/lib/push-tokens.ts` — token CRUD

**Files:**
- Create: `src/lib/push-tokens.ts`

- [ ] **Step 1: Write the module**

```ts
import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export type DevicePushToken = {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android";
  app_version: string | null;
};

/**
 * Upsert a device push token for a user. Same physical device can swap
 * users (account signout + signin) — we key on `token` (unique) and
 * repoint `user_id` if the token was already registered to a different
 * account. Also bumps `last_seen_at` so the table can be pruned later.
 */
export async function upsertDevicePushToken(args: {
  userId: string;
  token: string;
  platform: "ios" | "android";
  appVersion?: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("device_push_tokens").upsert(
    {
      user_id: args.userId,
      token: args.token,
      platform: args.platform,
      app_version: args.appVersion ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error(`upsertDevicePushToken: ${error.message}`);
}

/**
 * Delete a push token. Called when the app signs out, or when Expo
 * returns `DeviceNotRegistered` on a send receipt.
 */
export async function deleteDevicePushToken(token: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("device_push_tokens").delete().eq("token", token);
  if (error) throw new Error(`deleteDevicePushToken: ${error.message}`);
}

/**
 * All active push tokens for a user. Returns [] if the user has none.
 */
export async function getDevicePushTokensForUser(
  userId: string,
): Promise<DevicePushToken[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("device_push_tokens")
    .select("id,user_id,token,platform,app_version")
    .eq("user_id", userId);
  if (error) throw new Error(`getDevicePushTokensForUser: ${error.message}`);
  return (data ?? []) as DevicePushToken[];
}

/**
 * Look up the Supabase user_id that owns a given Square customer id.
 * Returns null if no profile links this Square customer yet.
 */
export async function getUserIdBySquareCustomer(
  squareCustomerId: string,
): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("square_customer_id", squareCustomerId)
    .maybeSingle();
  if (error) throw new Error(`getUserIdBySquareCustomer: ${error.message}`);
  return (data?.user_id as string | undefined) ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/push-tokens.ts
git commit -m "feat(push): add device push token CRUD helpers"
```

### Task 2.3: `src/lib/push.ts` — Expo Push sender

**Files:**
- Create: `src/lib/push.ts`

- [ ] **Step 1: Write the module**

```ts
import "server-only";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { deleteDevicePushToken } from "./push-tokens";

// Single shared client — Expo() is cheap but carries a retry queue
// so a module-level singleton is the documented pattern.
const expo = new Expo();

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Send a push to one or many Expo tokens. Invalid tokens are pruned
 * immediately; Expo-side delivery errors are logged (receipt polling
 * would be a v2 concern — for order-ready notifications, best-effort
 * delivery is acceptable because the order is also visible in-app).
 *
 * Returns the count of accepted tickets.
 */
export async function sendExpoPush(
  tokens: string[],
  payload: PushPayload,
): Promise<number> {
  const valid: string[] = [];
  for (const t of tokens) {
    if (!Expo.isExpoPushToken(t)) {
      console.warn(`[push] dropping malformed token: ${t}`);
      // Remove malformed tokens so we don't keep trying.
      await deleteDevicePushToken(t).catch((err) =>
        console.error("[push] delete malformed token failed:", err),
      );
      continue;
    }
    valid.push(t);
  }
  if (valid.length === 0) return 0;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    priority: "high",
  }));

  const chunks = expo.chunkPushNotifications(messages);
  let accepted = 0;
  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const token = chunk[i].to as string;
        if (ticket.status === "ok") {
          accepted++;
          continue;
        }
        console.error(
          `[push] ticket error for ${token}: ${ticket.message}`,
          ticket.details,
        );
        // Hard failures where the token is dead.
        if (ticket.details?.error === "DeviceNotRegistered") {
          await deleteDevicePushToken(token).catch((err) =>
            console.error("[push] delete stale token failed:", err),
          );
        }
      }
    } catch (err) {
      console.error("[push] chunk send failed:", err);
    }
  }
  return accepted;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/push.ts
git commit -m "feat(push): add Expo Push sender with stale-token pruning"
```

### Task 2.4: `order_push_notifications` dedup helper

**Files:**
- Modify: `src/lib/push-tokens.ts`

- [ ] **Step 1: Append the helper**

Append to `src/lib/push-tokens.ts`:

```ts
/**
 * Atomically record that we sent a given notification kind for an
 * order. Returns true if this is the first record (caller should send
 * the push), false if Square already delivered this webhook and we
 * acted on it previously (caller should skip).
 *
 * Uses insert + onConflict=ignoreDuplicates to turn the unique-key
 * violation into a silent skip.
 */
export async function claimOrderPushSlot(
  orderId: string,
  kind: "ready",
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("order_push_notifications")
    .insert({ order_id: orderId, kind })
    .select("order_id");
  if (error) {
    // Unique-key conflict surfaces as Postgres code 23505. supabase-js
    // returns it as an error with `code: '23505'`.
    const code = (error as { code?: string }).code;
    if (code === "23505") return false;
    throw new Error(`claimOrderPushSlot: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/push-tokens.ts
git commit -m "feat(push): add claimOrderPushSlot dedup helper"
```

---

## Phase 3 — Token registration endpoint

### Task 3.1: `/api/device-push-token` POST + DELETE

**Files:**
- Create: `src/app/api/device-push-token/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { upsertDevicePushToken, deleteDevicePushToken } from "@/lib/push-tokens";

export const dynamic = "force-dynamic";

type RegisterBody = {
  token: string;
  platform: "ios" | "android";
  appVersion?: string | null;
};

function isValidPlatform(p: unknown): p is "ios" | "android" {
  return p === "ios" || p === "android";
}

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.token !== "string" || body.token.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing token" },
      { status: 400 },
    );
  }
  if (!isValidPlatform(body.platform)) {
    return NextResponse.json(
      { ok: false, error: "Invalid platform" },
      { status: 400 },
    );
  }

  try {
    await upsertDevicePushToken({
      userId: user.userId,
      token: body.token,
      platform: body.platform,
      appVersion: body.appVersion ?? null,
    });
  } catch (err) {
    console.error("[device-push-token] upsert failed:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing token query param" },
      { status: 400 },
    );
  }

  try {
    await deleteDevicePushToken(token);
  } catch (err) {
    console.error("[device-push-token] delete failed:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual smoke test (preview deploy or local)**

Start dev server: `npm run dev`
In another terminal (grab a real Supabase JWT from RN app `supabase.auth.getSession()` or via the Supabase dashboard's "impersonate user" → copy token):

```bash
curl -X POST http://localhost:3000/api/device-push-token \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"token":"ExponentPushToken[abc123]","platform":"ios","appVersion":"1.0.4"}'
```
Expected: `{"ok":true}`. Then query Supabase SQL editor: `select * from device_push_tokens;` — one row with your user_id.

Then test DELETE:
```bash
curl -X DELETE "http://localhost:3000/api/device-push-token?token=ExponentPushToken%5Babc123%5D" \
  -H "Authorization: Bearer <JWT>"
```
Expected: `{"ok":true}`. Re-query Supabase — row gone.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/device-push-token/route.ts
git commit -m "feat(api): add device push token register/revoke endpoint"
```

---

## Phase 4 — Square webhook READY handler

### Task 4.1: Extract Square order lookup helper

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`

**Rationale:** The webhook route already has `customer.deleted` logic. Rather than cramming more branches into one file, add a helper for the new `order.fulfillment.updated` path and a small dispatcher. Keeps future events self-contained.

- [ ] **Step 1: Add type + payload picker for the new event**

In `src/app/api/webhooks/square/route.ts`, extend the `SquareEvent` type and add a payload picker near `pickCustomerId`:

```ts
// Replace existing SquareEvent type with this broader shape.
type SquareFulfillmentUpdate = {
  fulfillment_uid?: string;
  old_state?: string;
  new_state?: string;
};

type SquareEvent = {
  type?: string;
  event_id?: string;
  data?: {
    id?: string;
    type?: string;
    object?: {
      customer?: { id?: string };
      order_fulfillment_updated?: {
        order_id?: string;
        state?: string;
        fulfillment_update?: SquareFulfillmentUpdate[];
      };
    };
  };
};

/**
 * Returns the order id + whether any fulfillment in this event
 * transitioned to PREPARED (Square's "ready for pickup" state).
 * Returns null if the event isn't an order.fulfillment.updated or
 * has no PREPARED transition.
 */
function pickReadyOrderId(event: SquareEvent): string | null {
  const payload = event.data?.object?.order_fulfillment_updated;
  if (!payload) return null;
  const updates = payload.fulfillment_update ?? [];
  const toPrepared = updates.some((u) => u.new_state === "PREPARED");
  if (!toPrepared) return null;
  return payload.order_id ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "refactor(webhook): broaden SquareEvent shape + add pickReadyOrderId"
```

### Task 4.2: Add ready-push handler

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts`

- [ ] **Step 1: Add handler function**

Near the top of the file (after imports, before `POST`), import the new helpers:

```ts
import { squareClient } from "@/lib/square";
import { claimOrderPushSlot, getDevicePushTokensForUser, getUserIdBySquareCustomer } from "@/lib/push-tokens";
import { sendExpoPush } from "@/lib/push";
```

Below `pickReadyOrderId`, add:

```ts
/**
 * Called when an order.fulfillment.updated event transitions at least
 * one fulfillment to PREPARED. Fetches the Square order to find the
 * customer id, maps to a Supabase user, claims the dedup slot, and
 * sends the push. All errors are logged; the webhook still ACKs 2xx
 * so Square doesn't spin on retries.
 */
async function handleOrderReady(orderId: string, eventId?: string): Promise<void> {
  const claimed = await claimOrderPushSlot(orderId, "ready");
  if (!claimed) {
    console.log(
      `[square-webhook] order ${orderId} ready push already sent (event_id=${eventId})`,
    );
    return;
  }

  // Fetch order for customer_id. Square SDK v44 exposes orders at
  // `client.orders.get({ orderId })`.
  let customerId: string | null = null;
  let orderNumber: string | null = null;
  try {
    const resp = await squareClient.orders.get({ orderId });
    customerId = resp.order?.customerId ?? null;
    // Square stores online order number in a metadata field or the
    // ticket name — use whatever the app already shows. Fall back to
    // the last 4 of orderId so the push body isn't ugly.
    orderNumber = resp.order?.ticketName ?? null;
  } catch (err) {
    console.error(`[square-webhook] orders.get ${orderId} failed:`, err);
    return;
  }

  if (!customerId) {
    console.log(`[square-webhook] order ${orderId} has no customer_id — skipping push`);
    return;
  }

  const userId = await getUserIdBySquareCustomer(customerId);
  if (!userId) {
    console.log(
      `[square-webhook] Square customer ${customerId} has no Supabase profile — skipping push`,
    );
    return;
  }

  const tokens = await getDevicePushTokensForUser(userId);
  if (tokens.length === 0) {
    console.log(`[square-webhook] user ${userId} has no registered devices`);
    return;
  }

  const displayNumber = orderNumber ?? `#${orderId.slice(-4).toUpperCase()}`;
  const accepted = await sendExpoPush(
    tokens.map((t) => t.token),
    {
      title: "Your order is ready 🧋",
      body: `Order ${displayNumber} is ready for pickup at Mandy's Bubble Tea.`,
      data: { orderId, kind: "ready" },
    },
  );
  console.log(
    `[square-webhook] sent ready push for order ${orderId} to ${accepted}/${tokens.length} devices`,
  );
}
```

- [ ] **Step 2: Wire dispatcher in `POST` handler**

In the `POST` function, after the existing `customer.deleted` branch (around the line `if (event.type === "customer.deleted") { ... }`), add:

```ts
  if (event.type === "order.fulfillment.updated") {
    const orderId = pickReadyOrderId(event);
    if (orderId) {
      try {
        await handleOrderReady(orderId, event.event_id);
      } catch (err) {
        console.error(
          `[square-webhook] handleOrderReady failed for order ${orderId} event_id=${event.event_id}:`,
          err,
        );
      }
    }
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea && npx tsc --noEmit`
Expected: exit 0. If Square SDK `orders.get` signature differs, adapt per the SDK's TypeScript surface — check `node_modules/square/dist/types/api/ordersApi.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "feat(webhook): send push on order.fulfillment PREPARED transitions"
```

### Task 4.3: Local webhook smoke test

- [ ] **Step 1: Insert a test token + profile**

In Supabase SQL editor, pick a real user's `user_profiles` row (one with a `square_customer_id`). Note their `user_id` and `square_customer_id`. Then insert a fake token for them:

```sql
insert into device_push_tokens (user_id, token, platform)
values ('<that user_id>', 'ExponentPushToken[TESTFAKE]', 'ios');
```

- [ ] **Step 2: Replay a real webhook payload locally**

If you have a dev server + a tunnel (ngrok, Cloudflare Tunnel) pointed at `/api/webhooks/square`, and Square Dashboard's sandbox webhook pointed at that tunnel, mark a sandbox order as prepared and watch the dev server logs.

Expected: log line `[square-webhook] sent ready push for order <id> to 0/1 devices` (0 accepted because the fake token is dropped by Expo — that's fine for this smoke; we're verifying the pipeline, not delivery).

If you don't have a tunnel set up, skip this step and rely on the end-to-end test in Phase 6.

- [ ] **Step 3: Clean up fake token**

```sql
delete from device_push_tokens where token = 'ExponentPushToken[TESTFAKE]';
```

---

## Phase 5 — RN client: permissions + registration

### Task 5.1: Install dependencies

**Files:**
- Modify: `~/Github/mandys_bubble_tea_app/package.json`

- [ ] **Step 1: Install**

```bash
cd ~/Github/mandys_bubble_tea_app
npx expo install expo-notifications expo-device
```
(`expo install` pins to the version matching SDK 54.)

- [ ] **Step 2: Verify**

Run: `npm list expo-notifications expo-device`
Expected: both listed with SDK-54-compatible versions.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add expo-notifications + expo-device"
```

### Task 5.2: `app.json` plugin + entitlements

**Files:**
- Modify: `~/Github/mandys_bubble_tea_app/app.json`

- [ ] **Step 1: Add `expo-notifications` plugin config**

In `app.json`, update the `plugins` array — add a new entry after `"expo-router"`:

```json
[
  "expo-notifications",
  {
    "icon": "./assets/images/notification-icon.png",
    "color": "#C43A10",
    "sounds": [],
    "iosDisplayInForeground": true
  }
]
```

If `./assets/images/notification-icon.png` doesn't exist, point to an existing white-on-transparent icon in that directory (required for Android only; iOS ignores it). If you don't have one, temporarily point to `./assets/images/icon.png` — we can swap later.

- [ ] **Step 2: Add `aps-environment` entitlement**

In `app.json`, update `ios.entitlements`:

```json
"entitlements": {
  "com.apple.developer.in-app-payments": [
    "merchant.com.mandysbubbletea.app"
  ],
  "com.apple.developer.applesignin": ["Default"],
  "aps-environment": "production"
}
```

- [ ] **Step 3: Prebuild to regenerate iOS project**

```bash
cd ~/Github/mandys_bubble_tea_app
npx expo prebuild --platform ios --clean
```
This rewrites `ios/mandysbubbleteaapp/*` including the entitlements file. If you have uncommitted native patches in `ios/`, back them up first (`git stash`) and re-apply after prebuild.

Expected: command finishes; `ios/mandysbubbleteaapp/mandysbubbleteaapp.entitlements` now includes an `aps-environment` entry.

- [ ] **Step 4: Verify entitlement via grep**

Run: `grep -n "aps-environment" ~/Github/mandys_bubble_tea_app/ios/mandysbubbleteaapp/mandysbubbleteaapp.entitlements`
Expected: one line printed.

- [ ] **Step 5: Commit**

```bash
git add app.json ios/
git commit -m "feat(app): enable expo-notifications plugin + aps-environment entitlement"
```

### Task 5.3: `lib/push-registration.ts` — token acquisition + upload

**Files:**
- Create: `~/Github/mandys_bubble_tea_app/lib/push-registration.ts`

- [ ] **Step 1: Write the module**

```ts
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { apiFetch } from '@/lib/api'

// Client-side push registration. Flow:
//  1. Ensure we're on a physical device (simulators can't receive APNs)
//  2. Request permission if not yet determined
//  3. Grab the Expo push token (includes projectId from app.json)
//  4. POST it to /api/device-push-token so the Next.js backend can
//     fan out Expo pushes when Square marks orders prepared
//
// iOS only for now. Android would need FCM + Google Services JSON;
// when we add it, flip the Platform gate and the rest works.

const PROJECT_ID =
  Constants.expoConfig?.extra?.eas?.projectId ??
  // @ts-expect-error — easConfig is a runtime fallback used by EAS builds
  Constants.easConfig?.projectId
const APP_VERSION = Constants.expoConfig?.version ?? null

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'not-physical-device' | 'denied' | 'unsupported-platform' | 'error'; detail?: string }

export async function registerForPushAndUpload(): Promise<PushRegistrationResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'unsupported-platform' }
  }
  if (!Device.isDevice) {
    return { ok: false, reason: 'not-physical-device' }
  }

  try {
    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') {
      const next = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      })
      status = next.status
    }
    if (status !== 'granted') {
      return { ok: false, reason: 'denied' }
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync(
      PROJECT_ID ? { projectId: PROJECT_ID } : undefined,
    )
    const token = tokenResp.data

    await apiFetch<{ ok: true }>('/api/device-push-token', {
      method: 'POST',
      body: JSON.stringify({
        token,
        platform: 'ios',
        appVersion: APP_VERSION,
      }),
    })

    return { ok: true, token }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn('[push] registration failed:', detail)
    return { ok: false, reason: 'error', detail }
  }
}

/**
 * Best-effort revoke on sign-out. Swallows errors — a failed revoke
 * is annoying but not a user-facing problem, and the next session's
 * upsert will re-point the token at the new user anyway.
 */
export async function revokeCurrentPushToken(): Promise<void> {
  if (Platform.OS !== 'ios') return
  if (!Device.isDevice) return
  try {
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      PROJECT_ID ? { projectId: PROJECT_ID } : undefined,
    )
    const token = tokenResp.data
    await apiFetch(`/api/device-push-token?token=${encodeURIComponent(token)}`, {
      method: 'DELETE',
    })
  } catch (err) {
    console.warn('[push] revoke failed:', err)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea_app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/push-registration.ts
git commit -m "feat(push): add client push registration helper"
```

### Task 5.4: `hooks/use-push-notifications.ts` — mount hook

**Files:**
- Create: `~/Github/mandys_bubble_tea_app/hooks/use-push-notifications.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useAuth } from '@/components/auth/AuthProvider'
import { registerForPushAndUpload } from '@/lib/push-registration'

// Foreground presentation behavior: iOS by default suppresses the
// notification banner when the app is in focus. Override so our order-
// ready push shows a banner + plays sound even if the user is mid-app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

/**
 * Mount once at the root. Registers the device push token after the
 * Supabase profile is available (auth-gated — we don't want to ask
 * for notification permission before the user finishes signup) and
 * wires a tap handler that deep-links to the relevant order detail.
 */
export function usePushNotifications() {
  const { profile } = useAuth()
  const hasRegistered = useRef(false)

  useEffect(() => {
    if (!profile || hasRegistered.current) return
    hasRegistered.current = true
    registerForPushAndUpload().then((result) => {
      if (!result.ok) {
        console.log(`[push] skipped: ${result.reason}`)
      }
    })
  }, [profile])

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { orderId?: string; kind?: string }
        | undefined
      if (data?.kind === 'ready' && data.orderId) {
        router.push({
          pathname: '/order-detail',
          params: { id: data.orderId },
        })
      }
    })
    return () => sub.remove()
  }, [])
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea_app && npx tsc --noEmit`
Expected: exit 0. If TS complains that `router.push` doesn't accept a pathname + params object, use the string form: `router.push(\`/order-detail?id=\${data.orderId}\`)`.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-push-notifications.ts
git commit -m "feat(push): add usePushNotifications root hook"
```

### Task 5.5: Mount the hook in `app/_layout.tsx`

**Files:**
- Modify: `~/Github/mandys_bubble_tea_app/app/_layout.tsx`

- [ ] **Step 1: Inspect current layout structure**

Read `app/_layout.tsx`. Find the root component (likely `RootLayout` or `RootLayoutNav`) that wraps everything in `<AuthProvider>`. The hook must be called **inside** `<AuthProvider>` (it calls `useAuth`).

- [ ] **Step 2: Add the call**

Add an internal component that calls the hook and mount it inside the auth provider. Example pattern (adapt to the exact file):

```tsx
import { usePushNotifications } from '@/hooks/use-push-notifications'

function PushMount() {
  usePushNotifications()
  return null
}

// Inside the JSX tree, nested under <AuthProvider>:
<AuthProvider>
  <PushMount />
  {/* existing children */}
</AuthProvider>
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea_app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(push): mount usePushNotifications at root"
```

### Task 5.6: Revoke on sign-out

**Files:**
- Modify: `~/Github/mandys_bubble_tea_app/components/auth/AuthProvider.tsx`

- [ ] **Step 1: Find the sign-out implementation**

In `AuthProvider.tsx`, locate the `signOut` function (inside `useMemo` or directly). It currently calls `supabase.auth.signOut()` and clears local state.

- [ ] **Step 2: Call revoke before `supabase.auth.signOut()`**

Import at the top:
```ts
import { revokeCurrentPushToken } from '@/lib/push-registration'
```

In the `signOut` body, before the Supabase sign-out call:
```ts
await revokeCurrentPushToken()
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/Github/mandys_bubble_tea_app && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add components/auth/AuthProvider.tsx
git commit -m "feat(push): revoke device token on sign-out"
```

---

## Phase 6 — APNs credentials + end-to-end verification

### Task 6.1: Create & upload APN Auth Key

- [ ] **Step 1: Create the key in Apple Developer Portal**

1. Log in at https://developer.apple.com/account
2. Keys → (+) → "Apple Push Notifications service (APNs)"
3. Name: `Mandy's Bubble Tea APNs Key`
4. Download the `.p8` — you get one shot; save it somewhere safe (1Password, local backup)
5. Note the **Key ID** (10 chars) and your **Team ID** (10 chars, visible in account overview)

- [ ] **Step 2: Upload to EAS credentials**

```bash
cd ~/Github/mandys_bubble_tea_app
eas credentials
```
Pick: `ios` → `production` → `Push Notifications: Manage your Apple Push Notifications Key` → `Set up push key` → `Upload your own key` → paste the `.p8` path, Key ID, Team ID.

Expected: "Successfully set up push key".

- [ ] **Step 3: Verify Expo sees it**

```bash
eas credentials
```
Pick iOS → production → "Show credentials". The push key section should list the key ID you just uploaded.

### Task 6.2: Enable the Square webhook event

- [ ] **Step 1: Open the production webhook subscription**

Square Developer Dashboard → Applications → your app → Webhooks → Subscriptions → edit the production webhook (the one pointing to `https://mandybubbletea.com/api/webhooks/square`).

- [ ] **Step 2: Check `order.fulfillment.updated`**

In the "Events" list find `order.fulfillment.updated` and enable it alongside the existing `customer.deleted`. Save.

- [ ] **Step 3: Confirm via test event**

In the webhook subscription page, click "Send test event" and pick `order.fulfillment.updated`. In Vercel function logs for `/api/webhooks/square` you should see the request arrive (and the handler log "no PREPARED transition" or "no customer_id" depending on the payload).

### Task 6.3: Archive + TestFlight build

- [ ] **Step 1: Version bump**

Edit `ios/mandysbubbleteaapp/Info.plist`:
- `CFBundleShortVersionString` `1.0.4` → `1.0.5` (or next available)
- `CFBundleVersion` `1`

- [ ] **Step 2: Commit the bump**

```bash
cd ~/Github/mandys_bubble_tea_app
git add ios/mandysbubbleteaapp/Info.plist
git commit -m "chore(ios): bump version to 1.0.5 (1) for push notifications"
```

- [ ] **Step 3: Archive via Xcode**

Open `ios/mandysbubbleteaapp.xcworkspace` → Product → Archive → Distribute App → App Store Connect → Upload. Wait for processing to finish in App Store Connect (5-20 min).

- [ ] **Step 4: Add build to TestFlight internal group**

App Store Connect → TestFlight → processed build → add to internal testers. Install on the physical iPhone you'll test with.

### Task 6.4: Real-device acceptance test

- [ ] **Step 1: Install & sign in**

Install 1.0.5 (1) from TestFlight. Sign in with a test account that has a linked Square customer. Grant notification permission when prompted.

- [ ] **Step 2: Verify token registered**

In Supabase SQL editor:
```sql
select user_id, token, platform, last_seen_at
from device_push_tokens
where user_id = '<test user_id>';
```
Expected: one row with token starting `ExponentPushToken[`.

- [ ] **Step 3: Place a real order**

Use the app to place a small order (one drink, cheapest option). Complete checkout with Apple Pay.

- [ ] **Step 4: Mark order prepared in Square**

In the Square POS / Square Dashboard → Orders → open the just-placed order → mark fulfillment as "Ready for pickup" (or "Prepared").

- [ ] **Step 5: Confirm push arrives**

Within 10 seconds, the test iPhone should display a banner "Your order is ready 🧋 — Order <number> is ready for pickup at Mandy's Bubble Tea."

- [ ] **Step 6: Confirm tap deep-links**

Tap the banner. App should open to the order detail screen for that order.

- [ ] **Step 7: Background the app and re-test**

Place another order, background the app (swipe to home), then mark it prepared. Banner should still arrive.

- [ ] **Step 8: Fully kill the app and re-test**

Place another order, fully kill the app (swipe up from app switcher), then mark it prepared. Banner should STILL arrive — this is the main reason we built this (vs. Tier A local notifications which would fail here).

- [ ] **Step 9: Verify dedup**

Check Vercel logs — when Square redelivers the same `order.fulfillment.updated` event (they may, especially on retries), the handler should log `order <id> ready push already sent`.

### Task 6.5: Post-verify housekeeping

- [ ] **Step 1: Update DEV_QUEUE / DEV_HANDOFF**

Add entry to `~/system/DEV_QUEUE.md` Recently Completed section:
```
- 2026-04-20 — **APNs order-ready push**: end-to-end remote push when barista marks order prepared — Supabase device_push_tokens + order_push_notifications dedup, Expo Push via server SDK, Square webhook order.fulfillment.updated handler, RN expo-notifications registration + tap-to-order-detail
```

- [ ] **Step 2: Remove stale tasks**

If the real-device verification passes, remove or update the relevant V1 items in `~/system/DEV_QUEUE.md`.

---

## Open questions / follow-ups (NOT in this plan)

- **Android**: FCM + Google Services JSON. Gated behind `Platform.OS !== 'ios'` early-return in `push-registration.ts` today — revisit when Android users exist.
- **Receipts polling**: Expo returns tickets synchronously but delivery receipts (confirming APNs accepted the push) require a second call to `getPushNotificationReceiptsAsync`. Not strictly necessary since unhealthy tokens already get pruned on `DeviceNotRegistered`, but would help observability.
- **Alert copy localization**: body is hard-coded English. If the app ever gets i18n, move to a resource file.
- **Silent background refresh**: could use `content-available: 1` pushes to refresh order state silently without a banner (useful for statuses other than READY). Not in scope.
- **Badge count**: currently `shouldSetBadge: false`. If we want app icon badges showing "1 ready order", add badge management alongside.

---

## Self-review checklist (run after writing, before handoff)

**Spec coverage:**
- Server push pipeline: Phase 1 (schema), 2 (helpers), 4 (webhook) ✓
- Token register/revoke API: Phase 3 ✓
- Client permission + registration: Phase 5.3-5.5 ✓
- Sign-out revoke: Phase 5.6 ✓
- Tap deep-link: Phase 5.4 ✓
- Foreground banner: Phase 5.4 `setNotificationHandler` ✓
- iOS entitlements: Phase 5.2 ✓
- Dedup: Phase 2.4 + 4.2 ✓
- End-to-end real device: Phase 6 ✓

**Placeholders:** none (all code inlined).

**Type consistency:**
- `PushPayload` used only within `src/lib/push.ts` ✓
- `DevicePushToken` shape consistent between `push-tokens.ts` and `push.ts` (push.ts only uses `.token`) ✓
- `PushRegistrationResult` discriminated union used once ✓
- `kind: "ready"` literal consistent across `claimOrderPushSlot`, `handleOrderReady`, push `data` payload, RN tap handler ✓

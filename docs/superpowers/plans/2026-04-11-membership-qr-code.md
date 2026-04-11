# Membership QR Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Square-compatible QR code to `/account` so cashiers can scan it via Square Register to attach the customer to a sale.

**Architecture:** Sync `reference_id = E.164 phone` on every customer lookup/create via Square Customer API, then render a QR code (encoding the same E.164 phone) on the signed-in account dashboard. Square Register POS natively matches scanned content against `reference_id`. No database is introduced; Square remains the source of truth.

**Tech Stack:** Next.js 14 App Router · TypeScript · Square SDK v44 (`square` package) · new dep `qrcode.react` (SVG QR renderer, ~10 KB, no runtime deps) · Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-04-11-membership-qr-code-design.md`

**Testing note:** This project has no automated test framework (no jest/vitest/playwright). TDD is not possible. Each task uses a **manual verification gate** instead: explicit steps to run and observe before committing. Do not skip these gates.

---

## File Structure

- **Modify** `src/app/api/customer/route.ts` — lookup-or-create: set `referenceId` on create; sync `referenceId` on existing hit (Task 2)
- **Create** `src/lib/square.ts` export `ensureReferenceId(customer, e164)` helper (Task 3)
- **Modify** `src/app/api/customer/lookup/route.ts` — lookup-only: sync `referenceId` on existing hit via helper (Task 3)
- **Refactor** `src/app/api/customer/route.ts` — switch inline sync to helper (Task 3)
- **Create** `src/components/account/MemberQrCard.tsx` — presentational QR card component (Task 4)
- **Modify** `src/app/account/page.tsx` — insert `<MemberQrCard />` into `AccountDashboard` (Task 5)
- **Modify** `package.json` / `package-lock.json` — add `qrcode.react` dep (Task 1)

---

## Task 1: Install `qrcode.react`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run from repo root:
```bash
npm install qrcode.react
```

Expected: `qrcode.react` appears in `package.json` under `dependencies`. `package-lock.json` updates. No peer-dep warnings (React 18 is compatible).

- [ ] **Step 2: Verify install**

Run:
```bash
npm ls qrcode.react
```

Expected output (exact version may differ):
```
mandys-bubble-tea@... /Users/stanyan/Github/mandys_bubble_tea
└── qrcode.react@3.x.x
```

- [ ] **Step 3: Type-check baseline**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS (no new errors introduced by the install).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add qrcode.react for member QR rendering"
```

---

## Task 2: Sync `referenceId` in `POST /api/customer` (lookup-or-create)

**Files:**
- Modify: `src/app/api/customer/route.ts`

**Context:** This route is called during checkout AND during `/account` sign-up. It does a phone-exact search, and if no customer exists, creates one. We need: (a) newly created customers to have `referenceId = e164`; (b) pre-existing customers whose `referenceId` doesn't match the E.164 phone to be updated.

The update must be non-fatal — if Square rejects the update for any reason, the user's request should still succeed (they logged in; reference_id sync is a background concern).

- [ ] **Step 1: Apply the patch**

Replace the entire `try { ... } catch` block (lines 50–95 of the current file) with the following. The rest of the file — imports, request parsing, validation, phone normalization — stays unchanged.

```typescript
  try {
    // Exact phone lookup first.
    const search = await squareClient.customers.search({
      limit: BigInt(1),
      query: {
        filter: {
          phoneNumber: { exact: e164 },
        },
      },
    });

    const existing = search.customers?.[0];
    if (existing?.id) {
      // Keep Square's reference_id in sync with our E.164 phone so that
      // scanning a QR containing the E.164 phone resolves to this customer
      // inside Square POS (Customer Directory matches reference_id exactly).
      if (existing.referenceId !== e164) {
        try {
          await squareClient.customers.update({
            customerId: existing.id,
            referenceId: e164,
          });
        } catch (err) {
          // Non-fatal: log and continue. Next login will retry.
          console.warn(
            "[api/customer] failed to sync referenceId",
            err instanceof Error ? err.message : err,
          );
        }
      }

      return NextResponse.json({
        ok: true,
        customerId: existing.id,
        phoneE164: e164,
        created: false,
      });
    }

    // Not found — create a new customer with referenceId set up-front.
    const created = await squareClient.customers.create({
      givenName,
      familyName,
      phoneNumber: e164,
      referenceId: e164,
    });

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
```

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS. If the Square SDK rejects `referenceId` in `customers.update` or `customers.create` with a type error, STOP and investigate — the SDK shape may differ. The v44 SDK accepts `referenceId` as a camelCase field on the Customer object for both calls.

- [ ] **Step 3: Manual verification gate — existing customer sync**

Start dev server:
```bash
npm run dev
```

Then in another terminal, pick an existing test customer phone number that is already in Square (sandbox). Manually clear its `reference_id` from the Square Dashboard: **Customers → Customer Directory → select customer → Edit → Reference ID → clear → Save**.

Then in the browser:
1. Open <http://localhost:3000/account>
2. If signed in from a prior run, click **Sign out**
3. Enter the cleared customer's phone and submit the form
4. Sign-up flow triggers only for brand-new numbers; for this existing phone, you land on the dashboard directly
5. Check Square Dashboard → same customer → Edit → **Reference ID should now equal the E.164 phone (e.g. `+61...`)**

Expected: Reference ID is populated after login. Terminal shows no `[api/customer] failed to sync referenceId` warning. If it fails, do NOT commit — inspect the error.

- [ ] **Step 4: Manual verification gate — new customer creation**

Still in `npm run dev`:
1. Sign out
2. Enter a phone number that is NOT in Square (sandbox)
3. The form switches to sign-up mode asking for a name
4. Submit name
5. Land on dashboard
6. Check Square Dashboard → find the newly created customer by phone → confirm **Reference ID = the E.164 phone** right from creation

Expected: New customer has `referenceId` populated on first save.

- [ ] **Step 5: Manual verification gate — idempotency**

Sign out, then sign in again with the same existing customer whose `referenceId` is now in sync. In the terminal running `npm run dev`, watch the logs. The code path `if (existing.referenceId !== e164)` should short-circuit and skip the `customers.update` call.

You can add a temporary `console.log("sync skipped")` inside the `if` branch's `else` (or just outside it) for this verification — **then remove the log before committing**.

Expected: `customers.update` is NOT called a second time.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/customer/route.ts
git commit -m "feat(customer): sync referenceId=E164 phone on lookup/create

Populates Square Customer.reference_id with the E.164 phone so that
Square POS QR/barcode scan resolves to this customer. Update is
non-fatal to avoid blocking the user on transient sync failures."
```

---

## Task 3: Extract `ensureReferenceId` helper and apply to `/api/customer/lookup`

**Files:**
- Modify: `src/lib/square.ts` (add export)
- Modify: `src/app/api/customer/route.ts` (switch to helper)
- Modify: `src/app/api/customer/lookup/route.ts` (add sync via helper)

**Context:** We now have the same sync logic needed in `/api/customer/lookup` (the account-page lookup-only route that does NOT create new customers). Per spec §4: first write inlines, second write extracts. Create a tiny helper, refactor the first call site to use it, then add the second call site.

- [ ] **Step 1: Add helper to `src/lib/square.ts`**

Append this export to the existing file (after the `SQUARE_LOCATION_ID` line):

```typescript

/**
 * Ensure a Square Customer's reference_id equals the given E.164 phone.
 * Idempotent: skips the update if already in sync. Non-fatal: logs and
 * swallows errors so lookup flows never fail on sync issues. Safe to call
 * on every successful customer lookup.
 */
export async function ensureReferenceId(
  customerId: string,
  currentReferenceId: string | null | undefined,
  e164: string,
): Promise<void> {
  if (currentReferenceId === e164) return;
  try {
    await squareClient.customers.update({
      customerId,
      referenceId: e164,
    });
  } catch (err) {
    console.warn(
      "[square] failed to sync referenceId",
      err instanceof Error ? err.message : err,
    );
  }
}
```

- [ ] **Step 2: Refactor `src/app/api/customer/route.ts` to use the helper**

In the import block at the top, change:
```typescript
import { squareClient } from "@/lib/square";
```
to:
```typescript
import { squareClient, ensureReferenceId } from "@/lib/square";
```

Then in the `if (existing?.id) { ... }` branch, replace the inline `if (existing.referenceId !== e164) { try { ... } catch { ... } }` block (written in Task 2) with a single call:

```typescript
    if (existing?.id) {
      await ensureReferenceId(existing.id, existing.referenceId, e164);
      return NextResponse.json({
        ok: true,
        customerId: existing.id,
        phoneE164: e164,
        created: false,
      });
    }
```

Leave the `customers.create({ ..., referenceId: e164 })` call as-is — creation still passes `referenceId` up-front.

- [ ] **Step 3: Add sync to `src/app/api/customer/lookup/route.ts`**

In the import block, change:
```typescript
import { squareClient } from "@/lib/square";
```
to:
```typescript
import { squareClient, ensureReferenceId } from "@/lib/square";
```

Then in the success branch (around the existing `if (!existing?.id)` else path), call the helper before returning. The full patched success path:

```typescript
    const existing = search.customers?.[0];
    if (!existing?.id) {
      return NextResponse.json({ ok: true, found: false });
    }

    await ensureReferenceId(existing.id, existing.referenceId, e164);

    return NextResponse.json({
      ok: true,
      found: true,
      customerId: existing.id,
      givenName: existing.givenName ?? null,
      familyName: existing.familyName ?? null,
      phoneE164: e164,
    });
```

- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Manual verification gate**

With `npm run dev` running:

1. **Existing customer via lookup-only route**: clear `reference_id` on a test customer in Square Dashboard. In the app, sign out, then sign in with that customer's phone. The `/api/customer/lookup` path runs because the account page uses `lookup`, not lookup-or-create. Verify `reference_id` is populated in Square Dashboard afterward.
2. **Regression check on `/api/customer`**: go through checkout → order-confirmation flow once, reusing a known good phone. Confirm no errors and the sync is still working (clear reference_id first, do checkout, check it's repopulated).
3. **Type-check again** just to be safe:
   ```bash
   npx tsc --noEmit
   ```

Expected: Both routes successfully sync reference_id. No terminal warnings unless you deliberately caused a failure.

- [ ] **Step 6: Commit**

```bash
git add src/lib/square.ts src/app/api/customer/route.ts src/app/api/customer/lookup/route.ts
git commit -m "refactor(customer): extract ensureReferenceId helper

Second caller (/api/customer/lookup) needs the same sync logic, so
extract into src/lib/square.ts and apply to both routes."
```

---

## Task 4: Create `MemberQrCard` component

**Files:**
- Create: `src/components/account/MemberQrCard.tsx`

**Context:** Presentational component. Pure client component — `qrcode.react` renders SVG client-side. Takes `customerId` and `phoneE164`; returns `null` if either is missing to avoid partially rendered state.

- [ ] **Step 1: Create `src/components/account/` directory if it doesn't exist**

Run:
```bash
ls src/components/account/ 2>/dev/null || mkdir -p src/components/account
```

Expected: directory exists (either it was already there or just got created).

- [ ] **Step 2: Write the component**

Create `src/components/account/MemberQrCard.tsx` with this exact content:

```tsx
"use client";

import { QRCodeSVG } from "qrcode.react";
import { BRAND } from "@/lib/constants";

type MemberQrCardProps = {
  customerId: string;
  phoneE164: string;
};

export function MemberQrCard({ customerId, phoneE164 }: MemberQrCardProps) {
  if (!customerId || !phoneE164) return null;

  const shortId = customerId.slice(-6).toUpperCase();

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm sm:p-8">
      <h2
        className="text-xs font-bold uppercase tracking-widest"
        style={{ color: BRAND.primaryColor }}
      >
        Member Card
      </h2>

      <div className="mx-auto mt-5 inline-block rounded-xl bg-white p-3 ring-1 ring-black/5">
        <QRCodeSVG value={phoneE164} size={160} level="M" />
      </div>

      <p className="mt-4 font-mono text-lg tracking-widest text-zinc-900">
        #{shortId}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Show at counter to earn stars
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS. If `QRCodeSVG` import fails, confirm Task 1 installed the package and run `npm ls qrcode.react` again.

- [ ] **Step 4: Commit**

```bash
git add src/components/account/MemberQrCard.tsx
git commit -m "feat(account): add MemberQrCard presentational component"
```

---

## Task 5: Integrate `MemberQrCard` into `AccountDashboard`

**Files:**
- Modify: `src/app/account/page.tsx`

**Context:** Insert the new card between the Profile header card and the Loyalty card inside the `AccountDashboard` function. `data.customerId` and `data.phoneE164` are already on the `AccountData` object — no new state, no new API field.

- [ ] **Step 1: Add the import**

At the top of `src/app/account/page.tsx`, in the import block (after the existing `@/lib/utils` import near line 14), add:

```typescript
import { MemberQrCard } from "@/components/account/MemberQrCard";
```

- [ ] **Step 2: Insert the component**

In the `AccountDashboard` function, the JSX currently looks like (simplified):

```tsx
return (
  <div className="space-y-8">
    {error && ( ... )}

    {/* ── Profile header card ── */}
    <section ...>
      ...
    </section>

    {/* ── Loyalty card ── */}
    <div>
      <section ...>
        ...
      </section>
      ...
    </div>

    {/* ── Order history ── */}
    <section>...</section>
  </div>
);
```

Insert `<MemberQrCard />` between the closing `</section>` of the Profile header card and the opening `<div>` of the Loyalty card block. The surrounding context to target:

Find this sequence (around line 451 in the current file):
```tsx
          </div>
        </div>
      </section>

      {/* ── Loyalty card ── */}
      <div>
```

Change it to:
```tsx
          </div>
        </div>
      </section>

      {/* ── Member QR card ── */}
      <MemberQrCard
        customerId={data.customerId}
        phoneE164={data.phoneE164}
      />

      {/* ── Loyalty card ── */}
      <div>
```

Do NOT wrap it in extra flex/grid containers — the outer `<div className="space-y-8">` already handles vertical spacing between sections.

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Lint**

Run:
```bash
npm run lint
```

Expected: PASS (or at worst, unchanged warning count — no new warnings in the touched files).

- [ ] **Step 5: Manual verification gate — UI render & QR correctness**

Start dev server (if not already running):
```bash
npm run dev
```

Then:
1. Open <http://localhost:3000/account>
2. Sign in with a known test phone
3. Confirm the dashboard shows **Profile header → Member Card (new) → Loyalty card → Order history** in that vertical order
4. The Member Card displays:
   - "MEMBER CARD" small caps heading in brand red
   - A black-on-white QR code, ~160px square, centered
   - `#XXXXXX` (last 6 of customer_id, uppercase, mono font)
   - "Show at counter to earn stars" caption
5. **Scan the QR with your phone's camera** (iOS Camera app or a QR scanner). The decoded content MUST start with `+61` (or whichever country code) and match the phone you signed in with exactly. If it doesn't match, stop — do not commit.
6. Resize the browser down to mobile width (Chrome DevTools → ~375px). The card should stay centered, padding shrinks to `p-5`, QR still visible and unclipped.

- [ ] **Step 6: Manual verification gate — guard rails**

Temporarily simulate the missing-data edge case:
1. In the running dev app, open DevTools → Application → Local Storage → delete `mbt:account:phone`
2. Reload `/account`
3. You should see the sign-in form, NOT a broken Member Card. `AccountDashboard` doesn't render when `data === null`, so this is a smoke check that nothing leaks through.

- [ ] **Step 7: Commit**

```bash
git add src/app/account/page.tsx
git commit -m "feat(account): render MemberQrCard on signed-in dashboard

Shows a Square-compatible QR (encoding E.164 phone) between profile
header and loyalty card. Last 6 of customer_id shown as visual Member
ID. Square POS scan support is documented but not hardware-verified."
```

---

## Task 6: Final integration check and handoff notes

**Files:** None modified. This is a review-only task.

- [ ] **Step 1: Full type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: Both PASS.

- [ ] **Step 2: Dev-server smoke test**

Run `npm run dev` and exercise these paths end-to-end in a browser with fresh local storage:

1. Sign in with existing customer → Member Card shows → QR decodes correctly
2. Sign out → sign up with a brand-new phone → name form → dashboard → Member Card shows with new customerId and new phone
3. Checkout flow once (menu → cart → checkout → place sandbox order) — regression check that `/api/customer` still works end-to-end
4. Square Dashboard → spot-check 2 customers (one pre-existing, one newly created) → both have `Reference ID` = E.164 phone

- [ ] **Step 3: Git log sanity**

Run:
```bash
git log --oneline -10
```

Expected: four new commits on top of the prior HEAD:
1. `chore(deps): add qrcode.react for member QR rendering`
2. `feat(customer): sync referenceId=E164 phone on lookup/create`
3. `refactor(customer): extract ensureReferenceId helper`
4. `feat(account): add MemberQrCard presentational component`
5. `feat(account): render MemberQrCard on signed-in dashboard`

(Five commits total. Count re-checks from the list above.)

- [ ] **Step 4: Write follow-up notes for hardware verification**

This is **not** a code change. Create a short note in `.claude/PROJECT_STATUS.md` (append to the bottom) OR in whatever file the project uses to track in-progress work, with the following content:

```markdown
## Member QR code — hardware verification pending (2026-04-11)

Shipped: Square Customer.reference_id is now synced to E.164 phone on
login/create; /account renders a QR encoding the E.164 phone.

Still to verify with physical hardware:

1. On Square Register, go to
   **Settings → Checkout → Customer Management** and enable
   **Scan customers using device camera**.
2. In the checkout flow, tap **Review sale → Add a customer → scan
   icon**, then scan a test account's QR off the `/account` page.
3. Expected: the customer is added to the sale. If the built-in imager
   does not trigger the "Add a customer" scan flow, evaluate an
   external HID Bluetooth scanner — no code changes required.

Until (3) is confirmed, the Member Card is "safe to ship" but the
scan-at-counter workflow is unverified. The card is still useful as a
visual identifier (cashier reads phone/last-6) without scanning.
```

If the file/convention doesn't exist, skip this step and just announce the note in the hand-off summary instead. Do NOT create new top-level doc files for this.

- [ ] **Step 5: Done — nothing to commit**

If Step 4 wrote a note, commit it:
```bash
git add .claude/PROJECT_STATUS.md
git commit -m "docs: note hardware verification pending for member QR"
```

Otherwise, this task ends with no commit.

---

## Self-Review Summary

- **Spec §1 (Architecture)** → Tasks 1–5 cover backend patches, new component, integration, new dep ✓
- **Spec §2 (reference_id = E.164)** → Task 2 creates with referenceId; Tasks 2 & 3 sync on lookup ✓
- **Spec §3 (Data flow)** → Task 3 helper implements the exact "compare then update" flow; Tasks 4–5 render the QR from `phoneE164` ✓
- **Spec §4 (Backend patch detail)** → Tasks 2 & 3, including the "first inline, second extracts" decision ✓
- **Spec §5 (UI regs)** → Task 4 matches the mocked card layout (heading, QR 160px, short ID, caption); Task 5 places it between profile header and loyalty card ✓
- **Spec §6 (Dependency)** → Task 1 ✓
- **Spec §7 (Error handling)** → Task 2 non-fatal try/catch; Task 3 helper preserves it; Task 4 `if (!customerId || !phoneE164) return null` ✓
- **Spec §8 (Test plan)** → Tasks 2, 3, 5 each carry the relevant manual verification gates; Task 6 runs the full integration pass ✓
- **Spec §9 (YAGNI)** → No Apple Wallet, no save/download, no loading states, no color customization in this plan ✓
- **Hardware verification** → Task 6 Step 4 carries it as a handoff note, not a blocking step, matching Spec §8 step 6 and Spec Risks §1 ✓

**Type consistency:** `ensureReferenceId(customerId: string, currentReferenceId: string | null | undefined, e164: string)` is defined in Task 3 Step 1 and called identically in Task 3 Step 2 and Task 3 Step 3. `MemberQrCardProps` with `{ customerId, phoneE164 }` defined in Task 4 Step 2 and passed identically in Task 5 Step 2.

**Placeholder scan:** No TBD, no "handle edge cases", no "similar to above". Every code step ships concrete code.

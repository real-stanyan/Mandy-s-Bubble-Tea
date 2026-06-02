# Order Complaint Channel — Design Spec

**Date**: 2026-04-26
**Author**: Claude (brainstormed with stan)
**Status**: Draft, awaiting user review before plan

## 1. Goal

Give customers a way to report problems with a completed order (drink quality, missing item, wrong topping, etc.) from the order detail page. The complaint, including up to 3 photos, is forwarded to `hello@mandybubbletea.com` so Mandy can follow up directly.

## 2. Scope

- **In scope**: Web only (Next.js). Authenticated customers, viewing their own past orders.
- **Out of scope**: RN app port, complaint admin dashboard, customer-facing status tracking, refund automation.

If app users start asking for the same feature, mirror the UI to RN later — the server endpoint is shared and won't change.

## 3. User-facing flow

1. Customer signs in and clicks a past order from `/account/orders` — `OrderRow.tsx:21` routes to `/order-confirmation/[orderId]` which is the project's actual order detail page (used both right after checkout and when revisiting from past orders).
2. Below the line items + price summary, a section appears (only when the viewer is signed in and owns the order — see §4):

   ```
   Need help with this order?
   Tell us what went wrong.

   [ Report a problem ]
   ```

3. Tap button → modal dialog opens (shadcn `<Dialog>`):
   - **Description** (required): textarea, 10–1000 chars.
   - **Photos** (optional): up to 3 images, ≤8 MB each, types `image/jpeg|png|heic|webp`. Selected photos render as thumbnails with a delete affordance.
   - **Submit**: shows spinner, button disabled while in flight.
4. On 200, dialog closes and a toast appears: "Thanks — we'll be in touch within 24 hours." The button on the page flips to a disabled state showing "Reported on Apr 26, 2026".

## 4. Visibility rules

`/order-confirmation/[orderId]` is a public page (anyone with the link can view, e.g. post-checkout SMS). The complaint section is therefore rendered by a client component that gates on session + ownership. The actual time-window and dedup checks happen server-side via a status endpoint (the client never trusts its own clock).

**Client-side gate (cheap, immediate):**

| Condition                                                            | Section behaviour      |
| -------------------------------------------------------------------- | ---------------------- |
| `useAuth()` profile is null                                           | Don't render section   |
| `profile.square_customer_id !== order.customerId` (passed via prop)  | Don't render section   |
| `order.state !== 'COMPLETED'` (passed via prop)                       | Don't render section   |

**Server-side gate (definitive, on mount):**

When the client gate passes, the section fetches `GET /api/orders/[orderId]/complaint-status`, which returns one of:

| Reason                  | Section behaviour                                                  |
| ----------------------- | ------------------------------------------------------------------ |
| `eligible`              | Button enabled                                                     |
| `window_closed`         | Section visible, button disabled, label "Complaint window closed"  |
| `already_reported`      | Section visible, button disabled, label "Reported on `<date>`"     |
| `not_completed` / 403 / 404 | Section hidden (defensive — client gate should have caught these)  |

The status endpoint runs the same checks as the POST endpoint (sections 6 steps 1–5) but doesn't side-effect; it's a dry-run gate. Always uses `order.closedAt` from Square — not client time.

## 5. Persistence model

Decided to use a minimal dedup-only table. Description + photos live only in the outgoing email; we do not store user-generated content in the DB.

```sql
-- supabase/migrations/2026-04-26-order-complaints.sql
create table public.order_complaints (
  id          uuid primary key default gen_random_uuid(),
  order_id    text not null unique,         -- Square order id
  customer_id text not null,                -- Square customer id (audit)
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.order_complaints enable row level security;

-- Authenticated users can SELECT their own row (used by the page to render
-- "Reported on YYYY-MM-DD"). All INSERTs go through the API route using the
-- service-role key, so we don't need an INSERT policy.
create policy "complaints: select own" on public.order_complaints
  for select using (auth.uid() = user_id);

create index order_complaints_user_id_idx on public.order_complaints (user_id);
```

**Account deletion**: extend the existing `purgeAccount` helper to delete rows in `order_complaints` for the user being purged (matches the welcome-discount / ig-follow-discount patterns).

`user_id` uses `on delete set null` so an audit row survives even if the user is purged — but `purgeAccount` will explicitly delete the rows anyway, matching existing PII-purge behaviour. The `on delete set null` is a defense-in-depth fallback.

## 6. API endpoint

`POST /api/orders/[orderId]/complaint`

- **Content-Type**: `multipart/form-data`
- **Body fields**:
  - `description: string` (10–1000 chars)
  - `photos: File[]` (0–3 files, each ≤8 MB, MIME `image/jpeg|png|heic|webp`)
- **Auth**: required (session cookie)

### Validation chain (cheap → expensive)

| Step | Check                                                | Failure                                       |
| ---- | ---------------------------------------------------- | --------------------------------------------- |
| 1    | Has session                                          | `401 NOT_AUTHENTICATED`                       |
| 2    | Square `order.customerId === session.squareCustomerId` | `403 NOT_OWN_ORDER`                          |
| 3    | `order.state === 'COMPLETED'`                        | `409 NOT_COMPLETED`                           |
| 4    | `now - order.closedAt < 7 days`                      | `410 WINDOW_CLOSED`                           |
| 5    | No existing `order_complaints` row for `order_id`    | `409 ALREADY_REPORTED`                        |
| 6    | Body shape: description length, photo count          | `422 INVALID_INPUT`                           |
| 7    | Each photo: MIME allow-list + size ≤8 MB             | `422 INVALID_PHOTO`                           |
| 8    | sharp compress each photo                            | `500 PROCESSING_FAILED`                       |
| 9    | Resend `emails.send()`                               | `502 EMAIL_FAILED`                            |
| 10   | INSERT `order_complaints` row                        | (success path; on DB error log + return 200, see Ordering invariant) |

### Ordering invariant

`Resend send` happens **before** `INSERT row`. If Resend fails, no dedup row is written, so the customer can retry. If INSERT fails after a successful send, log a warning and return 200 — the email has reached Mandy, and a worst-case retry sends a duplicate email (acceptable: low-frequency feature, easier than two-phase commit).

### Square order fetch

Reuse `squareClient.orders.get({ orderId })` (the same call other order routes use). Do not look up `order_id` only in our DB — Square is source of truth for state + items + closedAt.

## 7. Email payload

Sent via Resend. Both HTML and plaintext bodies generated by `buildComplaintEmail()`.

```
To:       hello@mandybubbletea.com           (env: COMPLAINT_TO_EMAIL)
From:     Mandy's Bubble Tea <noreply@mandybubbletea.com>  (env: COMPLAINT_FROM_EMAIL)
Reply-To: <see fallback rule below>
Subject:  Order issue · OL#OL816 · <customer name>
Attachments: photo-1.jpg, photo-2.jpg, ... (post-compression jpegs, base64-encoded)
```

### Reply-To fallback rule

`session.user.email` is null for phone-OTP signups (verified at `src/lib/auth.ts:47`). Resolution:

1. If `user.email` is non-null **and** doesn't end with `@phone.supabase.local` (Supabase's auto-generated placeholder), use it.
2. Otherwise, omit the `reply_to` header entirely. The body still includes the phone number, so Mandy can call/SMS instead.

The body always shows the resolved channel — either `Customer: <name> · <phone> · <email>` or `Customer: <name> · <phone> · (no email on file)` — so Mandy isn't surprised when reply bounces.

### Body content

```
Order #OL816  (placed 2026-04-26 10:34, completed 11:02 Brisbane time)
Customer: <name> · <phone> · <email>

Items:
  • Brown Sugar Milk Tea (Large, 50% sugar, Less ice, Pearl ×2)  $7.20
  • Lychee Slushy (Regular, 100% sugar, Cheese Cream)            $7.50
  Subtotal $14.70 · PH 10% $1.47 · Card 1.9% $0.27 · Total $16.44

Customer says:
> The pearls in the brown sugar were undercooked, super hard.
> Lychee slushy melted by the time we got home, machine looked off?

Photos: 2 attached (photo-1.jpg, photo-2.jpg)
Reply directly to this email to reach the customer.
```

Items are formatted using existing helpers (mirror what print-jobs / cart drawer use to render line items).

## 8. Photo compression pipeline

`src/lib/photo-compress.ts` exposes `compressForEmail(buffer, mimeType) → { buffer, filename }`.

```ts
sharp(buffer)
  .rotate()                                  // respect EXIF (iPhone HEIC fix)
  .resize({ width: 1920, withoutEnlargement: true })
  .jpeg({ quality: 80 })
  .toBuffer();
```

- All output is jpeg regardless of input — best email-client compatibility (Apple Mail, Gmail web/iOS all preview natively).
- Output size in practice: 200–500 KB / photo. Three photos total → ~1.5 MB, comfortably under Gmail's 25 MB SMTP receive limit (the original 8 MB raw cap × 3 × 1.37 base64 overhead = ~33 MB would have been over the limit, so compression is load-bearing).
- Filenames assigned server-side (`photo-1.jpg`, `photo-2.jpg`, ...) to avoid leaking customer device filenames.

## 9. Components & files

### New files

```
supabase/migrations/2026-04-26-order-complaints.sql

src/lib/email/resend.ts
src/lib/email/complaint-mail.ts
src/lib/email/complaint-mail.test.ts

src/lib/photo-compress.ts
src/lib/photo-compress.test.ts

src/lib/order-complaint.ts                                # window + ownership + dedup validators
src/lib/order-complaint.test.ts

src/app/api/orders/[orderId]/complaint/route.ts           # POST handler
src/app/api/orders/[orderId]/complaint/route.test.ts
src/app/api/orders/[orderId]/complaint-status/route.ts    # GET status (dry-run gate)
src/app/api/orders/[orderId]/complaint-status/route.test.ts

src/components/ui/dialog.tsx                              # shadcn dialog primitive (project ships only alert-dialog today)

src/components/account/OrderComplaintSection.tsx          # client wrapper: gate + button + dialog mount
src/components/account/OrderComplaintFormDialog.tsx       # the dialog form itself

src/lib/__fixtures__/sample-photo.jpg                     # ~3 MB iPhone-class fixture for compress tests
```

### Modified files

```
src/app/order-confirmation/[orderId]/page.tsx             # mount <OrderComplaintSection /> below price summary, pass {orderId, orderState, customerId, closedAt}
src/lib/supabase.ts                                       # purgeAccount() — add order_complaints DELETE (file confirmed at src/lib/supabase.ts:88)
.env.example                                              # 3 new env vars
package.json                                              # add sharp, resend, @radix-ui/react-dialog
```

> Note: the project currently ships `src/components/ui/alert-dialog.tsx` but not `dialog.tsx`. The `<AlertDialog>` primitive is geared toward yes/no confirmations (semantic role=alertdialog, no title/description structure for forms). For the complaint form we add a proper `<Dialog>` primitive.

### Why a dedicated `email/` directory

`resend.ts` is a project-level singleton. `notifyMandyDispatchFailure` (delivery Phase 5b in DEV_QUEUE) is going to need the same Resend client — putting it in `src/lib/email/` reserves the directory and avoids a refactor when that lands.

## 10. Environment

New env vars (add to Vercel + `.env.example`):

- `RESEND_API_KEY` — server-only secret from Resend dashboard.
- `COMPLAINT_TO_EMAIL=hello@mandybubbletea.com`
- `COMPLAINT_FROM_EMAIL=noreply@mandybubbletea.com`

### Manual deploy steps (human, not automatable)

1. Resend dashboard → Domains → add `mandybubbletea.com`.
2. Add the three DNS records Resend provides (SPF, DKIM, Return-Path TXT) at the domain registrar.
3. Wait for verification (usually <15 min).
4. Generate API key in Resend dashboard.
5. Add the three env vars in Vercel project settings (production + preview).
6. Run the migration in Supabase Studio for both dev and prod projects.

## 11. Testing strategy

| File                                              | Coverage                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/lib/order-complaint.test.ts`                 | window validator (boundary at 7d, < 7d, > 7d, exactly 7d), ownership match/mismatch                                  |
| `src/lib/photo-compress.test.ts`                  | real sharp call against fixture: output is jpeg ≤500 KB, EXIF rotation applied, HEIC input → jpeg, non-image rejects |
| `src/lib/email/complaint-mail.test.ts`            | subject format, line item rendering, reply-to wiring, attachments base64                                             |
| `src/app/api/orders/[orderId]/complaint/route.test.ts` | All 9 failure branches + happy path, mocking Square + Resend + Supabase                                          |
| `src/app/api/orders/[orderId]/complaint-status/route.test.ts` | All 5 reason codes (eligible / window_closed / already_reported / not_completed / not_owner), mocking Square + Supabase |

No new e2e suite — vitest covers logic; the UI dialog is exercised manually via cmux browser before completion (`verification-before-completion` skill).

## 12. Anti-abuse posture

- 1 order = 1 complaint (DB UNIQUE on `order_id`) — natural rate limit.
- Customer must own the order (Square customerId check).
- Customer must have actually paid for the order (`state = COMPLETED` implies payment captured by Square).
- Photos compressed server-side → DoS via huge files mostly defanged at sharp boundary.
- No additional IP / user-day rate limit. Will revisit if abuse patterns appear.

## 13. Out of scope (future work, not in this plan)

- RN app mirror.
- Admin dashboard for Mandy to triage complaints (current model: she just lives in her inbox).
- Status tracking ("Resolved", "Refunded", etc.) for the customer to see.
- Auto-suggest refund actions in Square.
- Customer-facing complaint history page.
- Per-photo upload progress indicators (single submit-time spinner is fine for v1).

## 14. Open questions

None — all 9 brainstorming questions resolved with the user. Ready for plan.

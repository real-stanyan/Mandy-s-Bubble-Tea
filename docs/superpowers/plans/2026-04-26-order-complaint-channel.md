# Order Complaint Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Report a problem" channel on the order detail page (`/order-confirmation/[orderId]`) so customers can describe a problem and attach up to 3 photos, all forwarded to `hello@mandybubbletea.com` via email. One complaint per order.

**Architecture:** Server-side validation chain (session → ownership → COMPLETED → 7-day window → dedup) gates a multipart POST. Photos are recompressed with `sharp` to keep total payload under Gmail's 25 MB SMTP limit. Resend handles the email transport. A minimal `order_complaints` table enforces dedup; the description and photos themselves live only in the outgoing email, never in the DB. The order-detail page is public, so a small client section gates UI on `useAuth()` and a status endpoint.

**Tech Stack:** Next.js 16 App Router · TypeScript · vitest · Supabase · Square SDK 44 · `sharp@0.34.5` (already installed) · `resend` (new) · `@radix-ui/react-dialog` (new) · shadcn/ui · Tailwind v4

**Spec:** `docs/superpowers/specs/2026-04-26-order-complaint-channel-design.md`

**Branch policy:** Implement directly on `main` (matches recent IG-follow + Warm-ice pattern). Each task commits.

---

## Task 1: Install dependencies + scaffold env

**Files:**
- Modify: `package.json` (add `resend`, `@radix-ui/react-dialog`)
- Modify: `.env.example`

- [ ] **Step 1: Install runtime deps**

```bash
npm install resend @radix-ui/react-dialog
```

Expected: both packages added to `dependencies` in `package.json`. `package-lock.json` updated.

- [ ] **Step 2: Add env vars to `.env.example`**

Append to `.env.example`:

```bash

# ─── Order complaint channel (Resend transport) ────────────
# Resend API key (https://resend.com → API Keys). Server-only.
RESEND_API_KEY=
# Where complaint emails are sent.
COMPLAINT_TO_EMAIL=hello@mandybubbletea.com
# Sender. Domain must be verified in Resend (DNS SPF/DKIM/Return-Path).
COMPLAINT_FROM_EMAIL=noreply@mandybubbletea.com
```

- [ ] **Step 3: Verify install + typecheck still clean**

Run: `npx tsc --noEmit`
Expected: no NEW errors (pre-existing `.next/types/validator.ts` baseline + `src/lib/delivery/uber.ts` WIP errors are OK).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(deps): add resend + radix-dialog for order complaint channel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Supabase migration + purgeAccount hook

**Files:**
- Create: `supabase/migrations/2026-04-26-order-complaints.sql`
- Modify: `src/lib/supabase.ts` (extend `purgeAccount`)

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/2026-04-26-order-complaints.sql`:

```sql
-- Order complaints: one row per complaint, used as a dedup table only.
-- Description and photos live in the outgoing email, never in this DB.
-- See docs/superpowers/specs/2026-04-26-order-complaint-channel-design.md

create table if not exists public.order_complaints (
  id          uuid primary key default gen_random_uuid(),
  order_id    text not null unique,
  customer_id text not null,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.order_complaints enable row level security;

-- Authenticated users may read their own complaint rows so the order detail
-- page can render "Reported on YYYY-MM-DD". All INSERTs go through the
-- service-role API route, so we don't expose a client INSERT policy.
create policy "complaints: select own" on public.order_complaints
  for select using (auth.uid() = user_id);

create index if not exists order_complaints_user_id_idx
  on public.order_complaints (user_id);
```

- [ ] **Step 2: Apply migration on local/dev Supabase**

Run the migration in Supabase Studio (SQL editor) for the dev project. Verify the table exists:

```sql
select * from public.order_complaints limit 1;
```

Expected: empty result, no error. (Production migration runs after the feature is shipped; flag this as a manual deploy step in Task 13.)

- [ ] **Step 3: Add order_complaints DELETE to purgeAccount**

In `src/lib/supabase.ts`, locate the `purgeAccount` function (~line 88). Inside the `if (customerId)` block, after the existing `ig_follow_discounts` delete, add:

```ts
    if (userId) {
      const { error: ocErr } = await admin
        .from("order_complaints")
        .delete()
        .eq("user_id", userId);
      if (ocErr) console.error("[purge] order_complaints delete", ocErr);
    }
```

Note: `order_complaints` is keyed by `user_id` (not `customer_id`), so this fragment must run inside a scope where `userId` is available. The existing `purgeAccount` already resolves `userId` near the top — verify your insertion site has it in scope. If `userId` is undefined at that point, skip the delete (the `on delete set null` FK on the auth user takes over).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all existing tests still pass. `purgeAccount` doesn't yet have a unit test (existing pattern), so no new tests in this step.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-04-26-order-complaints.sql src/lib/supabase.ts
git commit -m "feat(db): add order_complaints dedup table + purge hook

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Pure validators in `src/lib/order-complaint.ts`

**Files:**
- Create: `src/lib/order-complaint.ts`
- Test: `src/lib/order-complaint.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/order-complaint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  COMPLAINT_WINDOW_DAYS,
  isWithinComplaintWindow,
  ownsOrder,
  validateComplaintBody,
} from "./order-complaint";

describe("isWithinComplaintWindow", () => {
  const now = new Date("2026-04-26T10:00:00Z");

  it("returns true when closedAt is just now", () => {
    expect(isWithinComplaintWindow(now.toISOString(), now)).toBe(true);
  });

  it("returns true at exactly 6 days 23 hours after close", () => {
    const closed = new Date(now.getTime() - (7 * 24 - 1) * 60 * 60 * 1000);
    expect(isWithinComplaintWindow(closed.toISOString(), now)).toBe(true);
  });

  it("returns false at exactly 7 days + 1 minute after close", () => {
    const closed = new Date(now.getTime() - (7 * 24 * 60 + 1) * 60 * 1000);
    expect(isWithinComplaintWindow(closed.toISOString(), now)).toBe(false);
  });

  it("returns false for null closedAt", () => {
    expect(isWithinComplaintWindow(null, now)).toBe(false);
  });
});

describe("ownsOrder", () => {
  it("returns true when customer ids match", () => {
    expect(ownsOrder("CUST_A", "CUST_A")).toBe(true);
  });

  it("returns false when ids differ", () => {
    expect(ownsOrder("CUST_A", "CUST_B")).toBe(false);
  });

  it("returns false when either side is null", () => {
    expect(ownsOrder(null, "CUST_A")).toBe(false);
    expect(ownsOrder("CUST_A", null)).toBe(false);
    expect(ownsOrder(null, null)).toBe(false);
  });
});

describe("validateComplaintBody", () => {
  it("accepts a 10-char description with no photos", () => {
    const r = validateComplaintBody({ description: "Pearls hard", photoCount: 0 });
    expect(r.ok).toBe(true);
  });

  it("rejects descriptions shorter than 10 chars", () => {
    const r = validateComplaintBody({ description: "too short", photoCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DESCRIPTION_TOO_SHORT");
  });

  it("rejects descriptions longer than 1000 chars", () => {
    const r = validateComplaintBody({ description: "a".repeat(1001), photoCount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DESCRIPTION_TOO_LONG");
  });

  it("rejects more than 3 photos", () => {
    const r = validateComplaintBody({ description: "Description here.", photoCount: 4 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TOO_MANY_PHOTOS");
  });

  it("rejects negative photo count (defensive)", () => {
    const r = validateComplaintBody({ description: "Description here.", photoCount: -1 });
    expect(r.ok).toBe(false);
  });
});

export const COMPLAINT_WINDOW_DAYS_FROM_LIB: number = COMPLAINT_WINDOW_DAYS;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/order-complaint.test.ts`
Expected: FAIL — `Cannot find module './order-complaint'`.

- [ ] **Step 3: Write the validator module**

Create `src/lib/order-complaint.ts`:

```ts
export const COMPLAINT_WINDOW_DAYS = 7;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const PHOTO_MAX_COUNT = 3;
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
] as const;

export function isWithinComplaintWindow(
  closedAt: string | null,
  now: Date,
): boolean {
  if (!closedAt) return false;
  const closed = new Date(closedAt).getTime();
  if (Number.isNaN(closed)) return false;
  const ageMs = now.getTime() - closed;
  return ageMs < COMPLAINT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function ownsOrder(
  sessionCustomerId: string | null,
  orderCustomerId: string | null,
): boolean {
  if (!sessionCustomerId || !orderCustomerId) return false;
  return sessionCustomerId === orderCustomerId;
}

export type ValidateBodyInput = {
  description: string;
  photoCount: number;
};

export type ValidateBodyResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "DESCRIPTION_TOO_SHORT"
        | "DESCRIPTION_TOO_LONG"
        | "TOO_MANY_PHOTOS"
        | "INVALID_PHOTO_COUNT";
      message: string;
    };

export function validateComplaintBody(
  input: ValidateBodyInput,
): ValidateBodyResult {
  const desc = input.description?.trim() ?? "";
  if (desc.length < DESCRIPTION_MIN) {
    return {
      ok: false,
      code: "DESCRIPTION_TOO_SHORT",
      message: `Description must be at least ${DESCRIPTION_MIN} characters.`,
    };
  }
  if (desc.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      code: "DESCRIPTION_TOO_LONG",
      message: `Description must be ${DESCRIPTION_MAX} characters or fewer.`,
    };
  }
  if (input.photoCount < 0) {
    return {
      ok: false,
      code: "INVALID_PHOTO_COUNT",
      message: "Photo count cannot be negative.",
    };
  }
  if (input.photoCount > PHOTO_MAX_COUNT) {
    return {
      ok: false,
      code: "TOO_MANY_PHOTOS",
      message: `At most ${PHOTO_MAX_COUNT} photos.`,
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/order-complaint.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-complaint.ts src/lib/order-complaint.test.ts
git commit -m "feat(complaint): add window + ownership + body validators

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Photo compression in `src/lib/photo-compress.ts`

**Files:**
- Create: `src/lib/photo-compress.ts`
- Test: `src/lib/photo-compress.test.ts`
- Create: `src/lib/__fixtures__/sample-photo.jpg` (~1–3 MB; capture or download a reasonably large JPEG)

- [ ] **Step 1: Provide a real fixture image**

Save a real-world JPEG (~1–3 MB, ideally with EXIF orientation rotated) to `src/lib/__fixtures__/sample-photo.jpg`.

You can grab any iPhone photo, or generate one with:

```bash
# generates a 4000x3000 random-noise JPEG ~2 MB at quality 80 — 800x600 fixture used in tests instead
node -e "
const sharp = require('sharp');
const buf = Buffer.alloc(800*600*3);
for (let i=0;i<buf.length;i++) buf[i] = Math.random()*255;
sharp(buf, { raw: { width: 800, height: 600, channels: 3 }})
  .jpeg({ quality: 90 })
  .toFile('src/lib/__fixtures__/sample-photo.jpg')
"
```

Verify the file exists and is non-empty:

```bash
ls -lh src/lib/__fixtures__/sample-photo.jpg
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/photo-compress.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { compressForEmail } from "./photo-compress";

const FIXTURE = path.resolve(
  __dirname,
  "__fixtures__/sample-photo.jpg",
);

describe("compressForEmail", () => {
  it("compresses a real photo to a smaller jpeg buffer", async () => {
    const input = await readFile(FIXTURE);
    const result = await compressForEmail(input, "image/jpeg", 0);
    expect(result.filename).toBe("photo-1.jpg");
    expect(result.buffer.length).toBeLessThan(input.length);
    // Quality 80 + 1920px max should keep result well under 1 MB for typical input
    expect(result.buffer.length).toBeLessThan(1_000_000);
  });

  it("outputs jpeg even for png input", async () => {
    // A tiny 1x1 png
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const result = await compressForEmail(png, "image/png", 1);
    expect(result.filename).toBe("photo-2.jpg");
    // jpeg magic number FF D8 FF
    expect(result.buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("rejects non-image mime", async () => {
    const buf = Buffer.from("not an image");
    await expect(compressForEmail(buf, "application/pdf", 0)).rejects.toThrow(
      /unsupported mime/i,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/photo-compress.test.ts`
Expected: FAIL — `Cannot find module './photo-compress'`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/photo-compress.ts`:

```ts
import "server-only";
import sharp from "sharp";
import { PHOTO_ALLOWED_MIME } from "./order-complaint";

export type CompressedPhoto = {
  buffer: Buffer;
  filename: string;
  mimeType: "image/jpeg";
};

/**
 * Recompress a customer-uploaded photo to a small jpeg suitable for email
 * attachment. Output is always jpeg regardless of input — best email-client
 * compatibility (Apple Mail, Gmail web/iOS all preview natively).
 *
 * @param input  Raw upload bytes.
 * @param mimeType Reported by the browser; checked against allow-list.
 * @param index  Zero-based slot used to name the output file (`photo-1.jpg` …).
 */
export async function compressForEmail(
  input: Buffer,
  mimeType: string,
  index: number,
): Promise<CompressedPhoto> {
  if (!PHOTO_ALLOWED_MIME.includes(mimeType as (typeof PHOTO_ALLOWED_MIME)[number])) {
    throw new Error(`unsupported mime: ${mimeType}`);
  }

  const buffer = await sharp(input)
    .rotate() // respect EXIF orientation (iPhone HEIC)
    .resize({ width: 1920, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    filename: `photo-${index + 1}.jpg`,
    mimeType: "image/jpeg",
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/photo-compress.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/photo-compress.ts src/lib/photo-compress.test.ts src/lib/__fixtures__/sample-photo.jpg
git commit -m "feat(photo): add sharp-based compressForEmail helper

Resize to 1920px, jpeg quality 80, EXIF-rotated. Always outputs jpeg
regardless of input MIME for maximum email-client compatibility.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Resend client singleton in `src/lib/email/resend.ts`

**Files:**
- Create: `src/lib/email/resend.ts`

- [ ] **Step 1: Create the Resend wrapper**

```ts
// src/lib/email/resend.ts
import "server-only";
import { Resend } from "resend";

let cached: Resend | null = null;

/**
 * Returns the singleton Resend client. Throws at first call if
 * RESEND_API_KEY is missing — failure is loud so misconfigured deploys
 * trip the route's 502 path immediately.
 */
export function getResendClient(): Resend {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  cached = new Resend(apiKey);
  return cached;
}

export const COMPLAINT_TO_EMAIL =
  process.env.COMPLAINT_TO_EMAIL ?? "hello@mandybubbletea.com";

export const COMPLAINT_FROM_EMAIL =
  process.env.COMPLAINT_FROM_EMAIL ??
  "Mandy's Bubble Tea <noreply@mandybubbletea.com>";
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/resend.ts
git commit -m "feat(email): add Resend client singleton + complaint endpoints

First real email transport in the project. Future delivery dispatch-failure
notifications will reuse this lib.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Email payload builder in `src/lib/email/complaint-mail.ts`

**Files:**
- Create: `src/lib/email/complaint-mail.ts`
- Test: `src/lib/email/complaint-mail.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/email/complaint-mail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildComplaintEmail,
  resolveReplyTo,
  type ComplaintMailInput,
} from "./complaint-mail";

const baseInput: ComplaintMailInput = {
  orderId: "abc123",
  pickupNumber: "OL816",
  customerName: "Stan Yan",
  customerPhone: "+61412345678",
  customerEmail: "stan@example.com",
  description: "Pearls were hard and the milk tea tasted off.",
  placedAt: "2026-04-26T00:34:00Z",
  closedAt: "2026-04-26T01:02:00Z",
  totalsLine: "Subtotal $14.70 · PH 10% $1.47 · Card 1.9% $0.27 · Total $16.44",
  itemLines: [
    "Brown Sugar Milk Tea (Large, 50% sugar, Less ice, Pearl ×2)  $7.20",
    "Lychee Slushy (Regular, 100% sugar, Cheese Cream)            $7.50",
  ],
  attachments: [
    { filename: "photo-1.jpg", contentBase64: "AAAA" },
    { filename: "photo-2.jpg", contentBase64: "BBBB" },
  ],
};

describe("resolveReplyTo", () => {
  it("returns the email when it's a real address", () => {
    expect(resolveReplyTo("stan@example.com")).toBe("stan@example.com");
  });

  it("returns null for the supabase placeholder pattern", () => {
    expect(resolveReplyTo("12345@phone.supabase.local")).toBeNull();
  });

  it("returns null for the deleted marker", () => {
    expect(resolveReplyTo("uuid-here@deleted.invalid")).toBeNull();
  });

  it("returns null for null / empty", () => {
    expect(resolveReplyTo(null)).toBeNull();
    expect(resolveReplyTo("")).toBeNull();
  });
});

describe("buildComplaintEmail", () => {
  it("subject contains pickup number + customer name", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.subject).toContain("OL816");
    expect(m.subject).toContain("Stan Yan");
  });

  it("plaintext body contains all line items + totals + description", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.text).toContain("Brown Sugar Milk Tea");
    expect(m.text).toContain("Lychee Slushy");
    expect(m.text).toContain("Subtotal $14.70");
    expect(m.text).toContain("Pearls were hard");
  });

  it("plaintext body shows phone + email when available", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.text).toContain("+61412345678");
    expect(m.text).toContain("stan@example.com");
  });

  it("plaintext body shows '(no email on file)' when reply-to is null", () => {
    const m = buildComplaintEmail({ ...baseInput, customerEmail: null });
    expect(m.text).toContain("(no email on file)");
  });

  it("attachments are forwarded with filename + base64 content", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments[0]).toEqual({
      filename: "photo-1.jpg",
      content: "AAAA",
    });
  });

  it("replyTo is set when resolveReplyTo returns a real email", () => {
    const m = buildComplaintEmail(baseInput);
    expect(m.replyTo).toBe("stan@example.com");
  });

  it("replyTo is omitted when email is null", () => {
    const m = buildComplaintEmail({ ...baseInput, customerEmail: null });
    expect(m.replyTo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/email/complaint-mail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/email/complaint-mail.ts`:

```ts
import "server-only";

const PLACEHOLDER_EMAIL_DOMAINS = [
  "@phone.supabase.local",
  "@deleted.invalid",
];

export function resolveReplyTo(email: string | null | undefined): string | null {
  if (!email) return null;
  if (PLACEHOLDER_EMAIL_DOMAINS.some((s) => email.toLowerCase().endsWith(s))) {
    return null;
  }
  if (!email.includes("@")) return null;
  return email;
}

export type ComplaintMailAttachment = {
  filename: string;
  contentBase64: string;
};

export type ComplaintMailInput = {
  orderId: string;
  pickupNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  description: string;
  placedAt: string | null;
  closedAt: string | null;
  totalsLine: string;
  itemLines: string[];
  attachments: ComplaintMailAttachment[];
};

export type ComplaintMailPayload = {
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments: { filename: string; content: string }[];
};

export function buildComplaintEmail(
  input: ComplaintMailInput,
): ComplaintMailPayload {
  const replyTo = resolveReplyTo(input.customerEmail) ?? undefined;

  const subject = `Order issue · ${input.pickupNumber} · ${input.customerName}`;

  const placedLabel = input.placedAt ? formatBrisbane(input.placedAt) : "?";
  const closedLabel = input.closedAt ? formatBrisbane(input.closedAt) : "?";
  const phoneLine = input.customerPhone ?? "(no phone on file)";
  const emailLine = replyTo ?? "(no email on file)";

  const text = [
    `Order ${input.pickupNumber}  (placed ${placedLabel}, completed ${closedLabel} Brisbane time)`,
    `Customer: ${input.customerName} · ${phoneLine} · ${emailLine}`,
    "",
    "Items:",
    ...input.itemLines.map((l) => `  • ${l}`),
    `  ${input.totalsLine}`,
    "",
    "Customer says:",
    ...input.description.split(/\r?\n/).map((l) => `> ${l}`),
    "",
    input.attachments.length > 0
      ? `Photos: ${input.attachments.length} attached (${input.attachments.map((a) => a.filename).join(", ")})`
      : "Photos: none attached",
    "",
    replyTo
      ? "Reply directly to this email to reach the customer."
      : "No customer email on file — call or SMS to reach them.",
  ].join("\n");

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; line-height: 1.5; color: #1a1a1a;">
  <h2 style="margin: 0 0 8px;">Order ${escapeHtml(input.pickupNumber)}</h2>
  <p style="margin: 0 0 16px; color: #666;">Placed ${escapeHtml(placedLabel)} · Completed ${escapeHtml(closedLabel)} Brisbane time</p>

  <p style="margin: 0 0 4px;"><strong>Customer:</strong> ${escapeHtml(input.customerName)}</p>
  <p style="margin: 0 0 16px;">${escapeHtml(phoneLine)} · ${escapeHtml(emailLine)}</p>

  <h3 style="margin: 16px 0 8px;">Items</h3>
  <ul style="margin: 0; padding-left: 20px;">
    ${input.itemLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
  </ul>
  <p style="margin: 8px 0 16px; color: #666;">${escapeHtml(input.totalsLine)}</p>

  <h3 style="margin: 16px 0 8px;">Customer says</h3>
  <blockquote style="margin: 0; padding: 8px 12px; border-left: 3px solid #C43A10; background: #FFF7F2; white-space: pre-wrap;">${escapeHtml(input.description)}</blockquote>

  <p style="margin: 16px 0 0; color: #666; font-size: 13px;">
    ${input.attachments.length > 0 ? `${input.attachments.length} photo(s) attached.` : "No photos attached."}
    ${replyTo ? "Reply to this email to reach the customer." : "No customer email on file — call or SMS to reach them."}
  </p>
</div>`;

  return {
    subject,
    text,
    html,
    replyTo,
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
    })),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBrisbane(iso: string): string {
  // Brisbane is fixed UTC+10 (no DST). Manually offset and format.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const local = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/email/complaint-mail.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/complaint-mail.ts src/lib/email/complaint-mail.test.ts
git commit -m "feat(email): build complaint mail payload (subject/body/attachments)

Includes Reply-To fallback for phone-OTP users (per spec §7).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: GET `/api/orders/[orderId]/complaint-status`

**Files:**
- Create: `src/app/api/orders/[orderId]/complaint-status/route.ts`
- Test: `src/app/api/orders/[orderId]/complaint-status/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/orders/[orderId]/complaint-status/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { get: vi.fn() } },
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { GET } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const completedOrder = {
  id: "ord_abc",
  state: "COMPLETED",
  customerId: "CUST_OWN",
  closedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
};

function mockReq(orderId = "ord_abc") {
  return {
    request: new Request(`http://test/api/orders/${orderId}/complaint-status`),
    context: { params: Promise.resolve({ orderId }) },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

function mockSupabaseRow(row: { created_at: string } | null) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle: single });
  const select = vi.fn().mockReturnValue({ eq });
  (getSupabaseAdmin as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({ select }),
  });
}

describe("GET complaint-status", () => {
  it("401 when no session", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    expect(res.status).toBe(401);
  });

  it("eligible when COMPLETED + within 7 days + own order + no row", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: completedOrder,
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.reason).toBe("eligible");
  });

  it("returns already_reported when row exists", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: completedOrder,
    });
    mockSupabaseRow({ created_at: "2026-04-25T00:00:00Z" });
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(json.reason).toBe("already_reported");
    expect(json.alreadyReportedAt).toBe("2026-04-25T00:00:00Z");
  });

  it("returns window_closed when closedAt > 7 days", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: {
        ...completedOrder,
        closedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(json.reason).toBe("window_closed");
  });

  it("returns not_completed for OPEN orders", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: { ...completedOrder, state: "OPEN", closedAt: null },
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(json.reason).toBe("not_completed");
  });

  it("403 when order belongs to another customer", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OTHER" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: completedOrder,
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/orders/[orderId]/complaint-status/`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the GET handler**

Create `src/app/api/orders/[orderId]/complaint-status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isWithinComplaintWindow, ownsOrder } from "@/lib/order-complaint";

export type ComplaintStatusReason =
  | "eligible"
  | "not_completed"
  | "window_closed"
  | "already_reported";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  const auth = await getAuthedUser(request);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "NOT_AUTHENTICATED" },
      { status: 401 },
    );
  }

  let order;
  try {
    const response = await squareClient.orders.get({ orderId });
    order = response.order;
  } catch {
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  if (!order) {
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  const sessionCustomerId = auth.profile?.square_customer_id ?? null;
  if (!ownsOrder(sessionCustomerId, order.customerId ?? null)) {
    return NextResponse.json(
      { ok: false, error: "NOT_OWN_ORDER" },
      { status: 403 },
    );
  }

  if (order.state !== "COMPLETED") {
    return NextResponse.json({
      ok: true,
      reason: "not_completed" satisfies ComplaintStatusReason,
    });
  }

  if (!isWithinComplaintWindow(order.closedAt ?? null, new Date())) {
    return NextResponse.json({
      ok: true,
      reason: "window_closed" satisfies ComplaintStatusReason,
    });
  }

  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("order_complaints")
    .select("created_at")
    .eq("order_id", orderId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      reason: "already_reported" satisfies ComplaintStatusReason,
      alreadyReportedAt: existing.created_at,
    });
  }

  return NextResponse.json({
    ok: true,
    reason: "eligible" satisfies ComplaintStatusReason,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/app/api/orders/[orderId]/complaint-status/`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/orders/[orderId]/complaint-status/
git commit -m "feat(api): add GET /api/orders/[orderId]/complaint-status

Dry-run gate that returns one of {eligible, not_completed, window_closed,
already_reported}. Used by the order detail page to decide whether to
render an enabled / disabled / hidden complaint button.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: POST `/api/orders/[orderId]/complaint`

**Files:**
- Create: `src/app/api/orders/[orderId]/complaint/route.ts`
- Test: `src/app/api/orders/[orderId]/complaint/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/orders/[orderId]/complaint/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { get: vi.fn() }, customers: { get: vi.fn() } },
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/email/resend", () => ({
  getResendClient: vi.fn(),
  COMPLAINT_TO_EMAIL: "hello@mandybubbletea.com",
  COMPLAINT_FROM_EMAIL: "noreply@mandybubbletea.com",
}));
vi.mock("@/lib/photo-compress", () => ({
  compressForEmail: vi.fn(),
}));

import { POST } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getResendClient } from "@/lib/email/resend";
import { compressForEmail } from "@/lib/photo-compress";

const ORDER = {
  id: "ord_abc",
  state: "COMPLETED",
  customerId: "CUST_OWN",
  closedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  ticketName: "OL999",
  lineItems: [
    {
      name: "Pearl Milk Tea",
      quantity: "1",
      basePriceMoney: { amount: BigInt(700), currency: "AUD" },
      variationName: "Large",
    },
  ],
  totalMoney: { amount: BigInt(700), currency: "AUD" },
};

function makeRequest(form: FormData, orderId = "ord_abc") {
  return {
    request: new Request(`http://test/api/orders/${orderId}/complaint`, {
      method: "POST",
      body: form,
    }),
    context: { params: Promise.resolve({ orderId }) },
  };
}

function setupHappyPathMocks(opts: { existingComplaint?: boolean } = {}) {
  (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: "u1",
    email: "stan@example.com",
    phone: "+61412345678",
    profile: {
      user_id: "u1",
      square_customer_id: "CUST_OWN",
      first_name: "Stan",
      last_name: "Yan",
      phone_e164: "+61412345678",
    },
  });
  (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    order: ORDER,
  });
  (squareClient.customers.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    customer: { givenName: "Stan", familyName: "Yan", phoneNumber: "+61412345678", emailAddress: "stan@example.com" },
  });
  (compressForEmail as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (_buf: Buffer, _mime: string, idx: number) => ({
      buffer: Buffer.from("compressed"),
      filename: `photo-${idx + 1}.jpg`,
      mimeType: "image/jpeg",
    }),
  );

  const existing = opts.existingComplaint ? { id: "row1" } : null;

  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const insert = vi.fn().mockResolvedValue({ error: null });

  (getSupabaseAdmin as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({ select, insert }),
  });

  const send = vi.fn().mockResolvedValue({ data: { id: "msg_123" }, error: null });
  (getResendClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    emails: { send },
  });

  return { send, insert };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST complaint", () => {
  it("401 when no session", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(401);
  });

  it("403 when order belongs to another customer", async () => {
    setupHappyPathMocks();
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OTHER", first_name: "Stan", last_name: "Yan" },
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(403);
  });

  it("409 when order not COMPLETED", async () => {
    setupHappyPathMocks();
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: { ...ORDER, state: "OPEN" },
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(409);
  });

  it("410 when window closed", async () => {
    setupHappyPathMocks();
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: {
        ...ORDER,
        closedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(410);
  });

  it("409 when already reported", async () => {
    setupHappyPathMocks({ existingComplaint: true });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("ALREADY_REPORTED");
  });

  it("422 when description < 10 chars", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "short");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("422 when more than 3 photos", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    for (let i = 0; i < 4; i++) {
      fd.append("photos", new File([new Uint8Array(1000)], `p${i}.jpg`, { type: "image/jpeg" }));
    }
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("422 when a photo exceeds 8 MB", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    fd.append("photos", new File([new Uint8Array(9 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }));
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("422 when MIME not allowed", async () => {
    setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    fd.append("photos", new File([new Uint8Array(100)], "x.pdf", { type: "application/pdf" }));
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(422);
  });

  it("502 when Resend fails (no row inserted)", async () => {
    const mocks = setupHappyPathMocks();
    mocks.send.mockResolvedValueOnce({ data: null, error: { message: "Service unavailable" } });
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(502);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("happy path: 200, Resend called, row inserted", async () => {
    const mocks = setupHappyPathMocks();
    const fd = new FormData();
    fd.set("description", "Pearls were hard, drink off.");
    fd.append("photos", new File([new Uint8Array(2 * 1024 * 1024)], "p.jpg", { type: "image/jpeg" }));
    const { request, context } = makeRequest(fd);
    const res = await POST(request, context);
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const sendArg = mocks.send.mock.calls[0][0];
    expect(sendArg.to).toBe("hello@mandybubbletea.com");
    expect(sendArg.replyTo).toBe("stan@example.com");
    expect(sendArg.subject).toContain("OL999");
    expect(sendArg.attachments).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/api/orders/[orderId]/complaint/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the POST handler**

Create `src/app/api/orders/[orderId]/complaint/route.ts`:

```ts
import { NextResponse } from "next/server";
import type { Square } from "square";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { compressForEmail } from "@/lib/photo-compress";
import {
  buildComplaintEmail,
  type ComplaintMailAttachment,
} from "@/lib/email/complaint-mail";
import {
  COMPLAINT_FROM_EMAIL,
  COMPLAINT_TO_EMAIL,
  getResendClient,
} from "@/lib/email/resend";
import {
  PHOTO_ALLOWED_MIME,
  PHOTO_MAX_BYTES,
  isWithinComplaintWindow,
  ownsOrder,
  validateComplaintBody,
} from "@/lib/order-complaint";
import { formatPrice } from "@/lib/utils";

export const runtime = "nodejs"; // sharp + Buffer

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  // 1. Session
  const auth = await getAuthedUser(request);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "NOT_AUTHENTICATED" },
      { status: 401 },
    );
  }

  // Fetch order
  let order;
  try {
    const response = await squareClient.orders.get({ orderId });
    order = response.order;
  } catch {
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  // 2. Ownership
  const sessionCustomerId = auth.profile?.square_customer_id ?? null;
  if (!ownsOrder(sessionCustomerId, order.customerId ?? null)) {
    return NextResponse.json(
      { ok: false, error: "NOT_OWN_ORDER" },
      { status: 403 },
    );
  }

  // 3. Status
  if (order.state !== "COMPLETED") {
    return NextResponse.json(
      { ok: false, error: "NOT_COMPLETED" },
      { status: 409 },
    );
  }

  // 4. Window
  if (!isWithinComplaintWindow(order.closedAt ?? null, new Date())) {
    return NextResponse.json(
      { ok: false, error: "WINDOW_CLOSED" },
      { status: 410 },
    );
  }

  // 5. Dedup
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("order_complaints")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "ALREADY_REPORTED" },
      { status: 409 },
    );
  }

  // Parse multipart body
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_INPUT" },
      { status: 422 },
    );
  }

  const description = (formData.get("description") as string | null) ?? "";
  const photoEntries = formData.getAll("photos").filter((v): v is File => v instanceof File);

  // 6. Body shape
  const bodyValidation = validateComplaintBody({
    description,
    photoCount: photoEntries.length,
  });
  if (!bodyValidation.ok) {
    return NextResponse.json(
      { ok: false, error: bodyValidation.code, message: bodyValidation.message },
      { status: 422 },
    );
  }

  // 7. Photo MIME + size
  for (const file of photoEntries) {
    if (!PHOTO_ALLOWED_MIME.includes(file.type as (typeof PHOTO_ALLOWED_MIME)[number])) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHOTO", message: `unsupported type: ${file.type}` },
        { status: 422 },
      );
    }
    if (file.size > PHOTO_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHOTO", message: "photo exceeds 8 MB" },
        { status: 422 },
      );
    }
  }

  // 8. Compress
  let attachments: ComplaintMailAttachment[];
  try {
    attachments = await Promise.all(
      photoEntries.map(async (file, idx) => {
        const buf = Buffer.from(await file.arrayBuffer());
        const compressed = await compressForEmail(buf, file.type, idx);
        return {
          filename: compressed.filename,
          contentBase64: compressed.buffer.toString("base64"),
        };
      }),
    );
  } catch (err) {
    console.error("[complaint] photo compress failed", err);
    return NextResponse.json(
      { ok: false, error: "PROCESSING_FAILED" },
      { status: 500 },
    );
  }

  // Build customer name + line item summary for email body
  const customerName = [auth.profile?.first_name, auth.profile?.last_name]
    .filter(Boolean)
    .join(" ") || "Customer";
  const customerPhone = auth.profile?.phone_e164 ?? auth.phone ?? null;
  const customerEmail = auth.email;

  const itemLines = (order.lineItems ?? []).map((li) => formatLineItem(li));
  const totalsLine = formatTotalsLine(order);
  const pickupNumber = order.ticketName ||
    (order.id ? `#${order.id.slice(-4).toUpperCase()}` : "OL???");

  const mail = buildComplaintEmail({
    orderId,
    pickupNumber,
    customerName,
    customerPhone,
    customerEmail,
    description: description.trim(),
    placedAt: order.createdAt ?? null,
    closedAt: order.closedAt ?? null,
    totalsLine,
    itemLines,
    attachments,
  });

  // 9. Resend send
  let sendError: { message: string } | null = null;
  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      to: COMPLAINT_TO_EMAIL,
      from: COMPLAINT_FROM_EMAIL,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    if (result.error) sendError = { message: result.error.message };
  } catch (err) {
    sendError = {
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (sendError) {
    console.error("[complaint] Resend send failed", sendError);
    return NextResponse.json(
      { ok: false, error: "EMAIL_FAILED" },
      { status: 502 },
    );
  }

  // 10. Dedup row (after successful send)
  const { error: insertError } = await admin.from("order_complaints").insert({
    order_id: orderId,
    customer_id: order.customerId,
    user_id: auth.userId,
  });
  if (insertError) {
    // Email already sent. Log + still return 200; worst case retry sends a duplicate.
    console.error("[complaint] dedup row insert failed (email was sent)", insertError);
  }

  return NextResponse.json({ ok: true });
}

function formatLineItem(li: Square.OrderLineItem): string {
  const name = li.name ?? "Item";
  const variation = li.variationName ? ` (${li.variationName}` : "";
  const mods = (li.modifiers ?? [])
    .map((m) => m.name)
    .filter(Boolean)
    .join(", ");
  const modsPart = mods ? `${variation ? ", " : " ("}${mods}` : "";
  const closing = variation || mods ? ")" : "";
  const qty = parseInt(li.quantity ?? "1", 10);
  const qtyPart = qty > 1 ? ` ×${qty}` : "";
  const total = li.totalMoney?.amount;
  const priceStr = typeof total === "bigint" ? `  ${formatPrice(total)}` : "";
  return `${name}${variation}${modsPart}${closing}${qtyPart}${priceStr}`;
}

function formatTotalsLine(order: Square.Order): string {
  const subtotal = order.totalMoney?.amount;
  const subPart = typeof subtotal === "bigint" ? `Total ${formatPrice(subtotal)}` : "";
  const charges = (order.serviceCharges ?? [])
    .map((c) => {
      const amt = c.totalMoney?.amount ?? c.appliedMoney?.amount;
      if (typeof amt !== "bigint") return null;
      return `${c.name ?? "Charge"} ${formatPrice(amt)}`;
    })
    .filter((s): s is string => !!s);
  return [subPart, ...charges].filter(Boolean).join(" · ") || "—";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/app/api/orders/[orderId]/complaint/route.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/orders/[orderId]/complaint/
git commit -m "feat(api): add POST /api/orders/[orderId]/complaint

10-step validation chain: session, ownership, COMPLETED, window, dedup,
body, photo MIME+size, compress, Resend send, INSERT dedup row. Resend
runs before INSERT so failed sends leave no dedup row (retry possible).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Add shadcn `dialog` primitive

**Files:**
- Create: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Create the dialog primitive**

Create `src/components/ui/dialog.tsx`. This is the standard shadcn dialog component scaffolded against Radix's `react-dialog`. Match the styling of the existing `alert-dialog.tsx` (same overlay/animation classes).

```tsx
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

// Mirror the inline cn helper used in alert-dialog.tsx (the project does not
// expose a shared cn from @/lib/utils).
function cn(...classes: Array<string | false | undefined | null>): string {
  return classes.filter(Boolean).join(" ");
}

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-card border border-line bg-paper p-5 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-sm opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-serif text-lg leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-ink2 text-sm", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat(ui): add shadcn Dialog primitive (radix-dialog wrapper)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: `OrderComplaintFormDialog` (the form itself)

**Files:**
- Create: `src/components/account/OrderComplaintFormDialog.tsx`

- [ ] **Step 1: Create the form dialog**

```tsx
"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_PHOTOS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];

type Props = {
  orderId: string;
  pickupNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export function OrderComplaintFormDialog({
  orderId,
  pickupNumber,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setDescription("");
    setPhotos([]);
    setSubmitting(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return; // don't close mid-submit
    if (!next) reset();
    onOpenChange(next);
  }

  function pickPhotos(files: FileList | null) {
    if (!files) return;
    const errs: string[] = [];
    const accepted: File[] = [];
    for (const f of Array.from(files)) {
      if (!ALLOWED.includes(f.type)) {
        errs.push(`${f.name}: unsupported type`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        errs.push(`${f.name}: over 8 MB`);
        continue;
      }
      accepted.push(f);
    }
    const next = [...photos, ...accepted].slice(0, MAX_PHOTOS);
    setPhotos(next);
    if (errs.length) setError(errs.join(", "));
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (description.trim().length < 10) {
      setError("Please add a bit more detail (at least 10 characters).");
      return;
    }
    if (description.length > 1000) {
      setError("Description is too long (max 1000 characters).");
      return;
    }

    const fd = new FormData();
    fd.set("description", description.trim());
    photos.forEach((p) => fd.append("photos", p));

    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/complaint`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = json?.message || json?.error || `Server error (${res.status}).`;
        setError(String(msg));
        setSubmitting(false);
        return;
      }
      onSuccess();
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem with order {pickupNumber}</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. We&apos;ll be in touch within 24 hours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what went wrong (e.g. wrong topping, drink looked off, missing item)..."
              maxLength={1000}
              rows={5}
              className="rounded-tile border border-line bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
              required
            />
            <span className="text-right text-[11px] text-ink3">
              {description.length}/1000
            </span>
          </label>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-ink">
              Photos ({photos.length}/{MAX_PHOTOS}, optional)
            </span>
            {photos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <li
                    key={`${p.name}-${i}`}
                    className="relative aspect-square overflow-hidden rounded-tile border border-line bg-white"
                  >
                    <img
                      src={URL.createObjectURL(p)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove ${p.name}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex items-center justify-center gap-2 rounded-tile border border-dashed border-line py-3 text-sm text-ink2 transition active:opacity-80"
              >
                <Upload size={14} />
                Add photo
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ALLOWED.join(",")}
              multiple
              onChange={(e) => {
                pickPhotos(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>

          {error && (
            <p className="rounded-tile border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
              className="rounded-tile border border-line px-4 py-2 text-sm text-ink2 transition active:opacity-80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-tile bg-brand px-4 py-2 text-sm font-medium text-white transition active:opacity-80 disabled:opacity-50"
            >
              {submitting && <Loader2 className="animate-spin" size={14} />}
              Submit
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

> Note: this is web-only, so we use the native `fetch` with `credentials: "include"` (mirrors the pattern in `src/app/account/orders/page.tsx:24` and other client components). RN equivalents would use the app's own `apiFetch` wrapper but this feature does not ship to RN.

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/OrderComplaintFormDialog.tsx
git commit -m "feat(account): add OrderComplaintFormDialog (description + photos)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: `OrderComplaintSection` (gate + button + toast)

**Files:**
- Create: `src/components/account/OrderComplaintSection.tsx`

- [ ] **Step 1: Create the section component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { OrderComplaintFormDialog } from "./OrderComplaintFormDialog";

type Status =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "eligible" }
  | { kind: "window_closed" }
  | { kind: "already_reported"; at: string };

type Props = {
  orderId: string;
  pickupNumber: string;
  orderState: string | null;
  orderCustomerId: string | null;
};

export function OrderComplaintSection({
  orderId,
  pickupNumber,
  orderState,
  orderCustomerId,
}: Props) {
  const { profile } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Cheap client-side gate: hide entirely if not the owner / not completed.
  const visible =
    profile?.square_customer_id != null &&
    profile.square_customer_id === orderCustomerId &&
    orderState === "COMPLETED";

  useEffect(() => {
    if (!visible) {
      setStatus({ kind: "hidden" });
      return;
    }
    let cancelled = false;
    setStatus({ kind: "loading" });
    fetch(`/api/orders/${orderId}/complaint-status`, {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setStatus({ kind: "hidden" });
          return;
        }
        const json = await res.json();
        if (json.reason === "eligible") setStatus({ kind: "eligible" });
        else if (json.reason === "window_closed") setStatus({ kind: "window_closed" });
        else if (json.reason === "already_reported") {
          setStatus({ kind: "already_reported", at: json.alreadyReportedAt });
        } else setStatus({ kind: "hidden" });
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "hidden" });
      });
    return () => {
      cancelled = true;
    };
  }, [visible, orderId]);

  if (!visible || status.kind === "hidden") return null;

  if (status.kind === "loading") {
    return (
      <section className="mt-6 rounded-card border border-line bg-paper p-4">
        <p className="text-sm text-ink3">Checking…</p>
      </section>
    );
  }

  return (
    <>
      <section className="mt-6 rounded-card border border-line bg-paper p-4">
        <h3 className="font-serif text-base text-ink">Need help with this order?</h3>
        <p className="mt-1 text-sm text-ink2">Tell us what went wrong.</p>
        <div className="mt-3">
          {status.kind === "eligible" && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="rounded-tile border border-brand px-4 py-2 text-sm font-medium text-brand transition active:opacity-80"
            >
              Report a problem
            </button>
          )}
          {status.kind === "window_closed" && (
            <button
              type="button"
              disabled
              className="rounded-tile border border-line bg-line/40 px-4 py-2 text-sm text-ink3"
            >
              Complaint window closed
            </button>
          )}
          {status.kind === "already_reported" && (
            <button
              type="button"
              disabled
              className="rounded-tile border border-line bg-line/40 px-4 py-2 text-sm text-ink3"
            >
              Reported on {formatReportedDate(status.at)}
            </button>
          )}
        </div>
        {toast && (
          <p className="mt-3 rounded-tile bg-green-50 px-3 py-2 text-sm text-green-800">
            {toast}
          </p>
        )}
      </section>

      <OrderComplaintFormDialog
        orderId={orderId}
        pickupNumber={pickupNumber}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => {
          setStatus({ kind: "already_reported", at: new Date().toISOString() });
          setToast("Thanks — we'll be in touch within 24 hours.");
        }}
      />
    </>
  );
}

function formatReportedDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/OrderComplaintSection.tsx
git commit -m "feat(account): add OrderComplaintSection (gate + button + toast)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Mount `OrderComplaintSection` on the order detail page

**Files:**
- Modify: `src/app/order-confirmation/[orderId]/page.tsx`

- [ ] **Step 1: Import the section component**

In `src/app/order-confirmation/[orderId]/page.tsx`, add to the existing imports:

```ts
import { OrderComplaintSection } from "@/components/account/OrderComplaintSection";
```

- [ ] **Step 2: Mount the section near the bottom of the JSX**

Locate the bottom of the page (after the loyalty block and any existing content). Just before the closing `</main>`, add:

```tsx
      <OrderComplaintSection
        orderId={orderId}
        pickupNumber={pickupNumber}
        orderState={order.state ?? null}
        orderCustomerId={order.customerId ?? null}
      />
```

(`order`, `orderId`, and `pickupNumber` are already in scope at that point.)

- [ ] **Step 3: Run dev server + cmux smoke**

```bash
npm run dev &
# wait briefly, then
cmux new-pane --type browser --direction right --url http://localhost:3000
```

Sign in as a real test user, navigate to a recent completed order via `/account/orders`, click into it. Verify:
- For a completed order owned by the user, the "Need help" section appears with a clickable button.
- Click the button → dialog opens with description textarea + Add photo button.
- For an order in OPEN state or someone else's order (impersonate via prod customer if you can, otherwise skip), section does not appear.

Use `cmux browser snapshot --compact` and `cmux browser console list` to assert no JS errors.

- [ ] **Step 4: Verify typecheck + tests still clean**

Run in parallel:
```bash
npx tsc --noEmit
npm test
```

Expected: tsc — only pre-existing baseline errors. Vitest — all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/order-confirmation/[orderId]/page.tsx
git commit -m "feat(order-detail): mount complaint section on order-confirmation page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Final verification + manual deploy steps

**Files:** none modified, this is a verification gate.

- [ ] **Step 1: Run the full test + typecheck suite once more**

```bash
npx tsc --noEmit
npm test
```

Expected: typecheck only pre-existing baseline; vitest all green; total test count increased by ~30 (4 new test files: order-complaint, photo-compress, complaint-mail, both routes).

- [ ] **Step 2: cmux UI smoke — happy path**

With dev server still running, in cmux browser:

1. Sign in as a real user that has at least one completed order.
2. Navigate `/account` → "View All Orders" → click a completed order.
3. Verify "Need help with this order?" section is visible.
4. Click "Report a problem" → dialog opens.
5. Type a description longer than 10 characters.
6. Add 1–2 photos (any image file from your machine).
7. Click Submit.

Expected: spinner → dialog closes → green success message → button on page flips to "Reported on `<today>`" disabled state.

Run `cmux browser console list` and `cmux browser errors list` — must be 0 errors.

If running against a real Resend key with a verified domain, check `hello@mandybubbletea.com` (or a stand-in test inbox) for the email with the attachments and rendered body.

If running without Resend configured, the route returns 502 — verify the dialog displays the error inline rather than crashing, and that **no row** was inserted in `order_complaints` (re-tries are still possible).

- [ ] **Step 3: cmux UI smoke — already reported branch**

In cmux browser, with the same order from Step 2 (now reported), reload the page.

Expected: section shows "Reported on YYYY-MM-DD" disabled button, no "Report a problem" enabled. Dialog cannot be opened.

- [ ] **Step 4: cmux UI smoke — non-owner / OPEN order**

Open an `/order-confirmation/[orderId]` URL for an order that does NOT belong to the signed-in user (you can grab one from a coworker's confirmation link, or open a confirmation in an incognito session).

Expected: complaint section does NOT render at all.

For an OPEN order (place a fresh order but don't have it marked COMPLETED yet): section does NOT render.

- [ ] **Step 5: Document manual deploy steps**

Before pushing to production, the following human steps are required (cannot be automated):

```
1. Resend dashboard:
   - Domains → Add → enter mandybubbletea.com
   - Copy the SPF, DKIM, Return-Path TXT records
2. Domain registrar (whatever DNS host serves mandybubbletea.com):
   - Add the three TXT records as instructed by Resend
   - Wait for verification (usually <15 min, can be up to 48h)
3. Resend dashboard:
   - API keys → Create API key (full access, name "Order complaints")
   - Copy the key (one-time display)
4. Vercel project settings → Environment Variables (Production + Preview):
   - RESEND_API_KEY=<key from step 3>
   - COMPLAINT_TO_EMAIL=hello@mandybubbletea.com
   - COMPLAINT_FROM_EMAIL=Mandy's Bubble Tea <noreply@mandybubbletea.com>
5. Supabase Studio (production project):
   - SQL Editor → run the contents of supabase/migrations/2026-04-26-order-complaints.sql
   - Verify table + index + RLS policy created.
```

If any of these are missing in production:
- Missing env: route returns 502 EMAIL_FAILED at first send, no dedup row written.
- Missing migration: route returns 500 at the dedup-check step.
- Domain not verified: Resend will reject the send → 502.

- [ ] **Step 6: Push to origin/main**

```bash
git push origin main
```

Expected: 12 commits pushed (one per task; Task 13 has no commit). Vercel preview/production deploys automatically.

- [ ] **Step 7: Update DEV_QUEUE + DEV_HANDOFF**

Add an entry to `~/system/DEV_QUEUE.md` "Recently Completed" section (one-liner) and write a session HANDOFF.

---

## Self-Review Checklist (already run when this plan was written)

- [x] Spec coverage: every section of the spec has at least one task implementing it.
- [x] No placeholders: every step has the actual code or command.
- [x] Type consistency: `ComplaintMailInput` / `ComplaintMailAttachment` / `ComplaintStatusReason` / `Status` types are used consistently across tasks.
- [x] Error code names match spec table (NOT_AUTHENTICATED, NOT_OWN_ORDER, NOT_COMPLETED, WINDOW_CLOSED, ALREADY_REPORTED, INVALID_INPUT, INVALID_PHOTO, PROCESSING_FAILED, EMAIL_FAILED).
- [x] Reply-To fallback rule from spec §7 implemented in `resolveReplyTo` test cases (Task 6).

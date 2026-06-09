# Checkout Keepsake Cup Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free checkout opt-in that makes the ZD410 printer produce one extra "keepsake" copy (drink name + modifiers omitted) of each cup the customer actually customized, for staff to hand to the customer.

**Architecture:** Keepsakes ride the existing cup-label rails as extra `cup_label_jobs` rows discriminated by a new `copy_idx` column (`0` = primary, `1` = keepsake). The authoritative payment-route enqueue emits them; the renderer gains a `keepsake` variant that drops the drink/modifier band; the checkout shows the toggle only when ≥1 cup is customized; admin gallery filters `copy_idx = 0` so keepsakes don't double-list.

**Tech Stack:** Next.js 14, TypeScript, Supabase Postgres, Zustand, Square SDK, Vitest, ZPL (Zebra). Web repo `mandys_bubble_tea` + admin repo `mandys_bubble_tea_admin`.

**Spec:** `docs/superpowers/specs/2026-06-09-checkout-keepsake-cup-label-design.md`

**Branch:** `feat/checkout-keepsake-cup-label` (already created in `mandys_bubble_tea`).

---

## Task 1: Schema migration — `copy_idx` column + unique constraint swap

**Files:**
- Create: `supabase/migrations/2026-06-09-cup-label-keepsake-copy-idx.sql`

- [ ] **Step 1: Confirm the real unique-constraint name (prod Supabase)**

Use the Supabase MCP (default `mcp__supabase__execute_sql`, hardcoded to the Mandy web project):

```sql
select conname from pg_constraint
where conrelid = 'cup_label_jobs'::regclass and contype = 'u';
```

Expected: one row, almost certainly `cup_label_jobs_square_order_id_line_id_cup_idx_key`. Record the exact name for Step 2 — do NOT assume.

- [ ] **Step 2: Write the migration file**

Use the exact constraint name from Step 1 in the `drop constraint` line.

```sql
-- Keepsake extra-copy support: a second printed copy of a customised cup
-- label (drink name + modifiers omitted) that staff hand to the customer.
-- copy_idx discriminates primary rows (0) from keepsake copies (1). The
-- old 3-column unique must be dropped or keepsake rows (same 3 cols,
-- different copy_idx) violate it. See docs/superpowers/specs/
-- 2026-06-09-checkout-keepsake-cup-label-design.md

alter table cup_label_jobs
  add column if not exists copy_idx int not null default 0;

alter table cup_label_jobs
  drop constraint if exists cup_label_jobs_square_order_id_line_id_cup_idx_key;

alter table cup_label_jobs
  add constraint cup_label_jobs_order_line_cup_copy_key
  unique (square_order_id, line_id, cup_idx, copy_idx);
```

- [ ] **Step 3: Apply the migration to prod**

Apply via Supabase MCP `mcp__supabase__apply_migration` with name `2026-06-09-cup-label-keepsake-copy-idx` and the SQL body from Step 2. (Existing rows backfill to `copy_idx = 0` via the column default; the table is small and the lock is brief.)

- [ ] **Step 4: Verify the new constraint exists and the old one is gone**

```sql
select conname from pg_constraint
where conrelid = 'cup_label_jobs'::regclass and contype = 'u';
```

Expected: exactly one row, `cup_label_jobs_order_line_cup_copy_key`. The old name must be absent.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/2026-06-09-cup-label-keepsake-copy-idx.sql
git commit -m "feat(cup-label): add copy_idx column + 4-col unique for keepsake copies"
```

---

## Task 2: Renderer — `keepsake` variant drops drink + modifiers

**Files:**
- Modify: `src/lib/cup-label/render-zebra-cup.ts`
- Test: `src/lib/cup-label/render-zebra-cup.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/cup-label/render-zebra-cup.test.ts`:

```ts
describe("renderCupLabel (keepsake variant)", () => {
  const base = {
    stickerNumber: "OL900",
    cupIdxOf: { idx: 1, total: 1 },
    drinkName: "Pearl Milk Tea",
    modifiersText: "Pearls -> 50%S",
    doodleSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#000"/></svg>',
    customerFirstName: "Stan",
  };

  it("omits drink name + modifiers when keepsake is true", async () => {
    const { zpl } = await renderCupLabel({ ...base, keepsake: true });
    expect(zpl).not.toContain("Pearl Milk Tea");
    expect(zpl).not.toContain("50%S");
    // Greeting + order/cup line are retained.
    expect(zpl).toContain("Hi, Stan");
    expect(zpl).toContain("OL900");
  });

  it("keeps drink name + modifiers when keepsake is absent (regression)", async () => {
    const { zpl } = await renderCupLabel(base);
    expect(zpl).toContain("Pearl Milk Tea");
    expect(zpl).toContain("50%S");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/render-zebra-cup.test.ts -t keepsake`
Expected: FAIL — the keepsake ZPL still contains "Pearl Milk Tea" (flag not implemented yet).

- [ ] **Step 3: Add `keepsake` to the input type**

In `src/lib/cup-label/render-zebra-cup.ts`, add to `CupLabelInput` (after `customerFirstName`):

```ts
  /**
   * Keepsake copy: the extra label the customer keeps. Renders the same
   * greeting / order-number / cup-fraction / doodle / logo but OMITS the
   * drink name and modifier list (the "keep everything except drink +
   * mods" requirement). Defaults to false — every existing caller renders
   * the full label unchanged.
   */
  keepsake?: boolean;
```

- [ ] **Step 4: Thread `keepsake` into both `buildZpl` calls**

In `renderCupLabel`, both `buildZpl({...})` invocations (the fortune branch ~L148 and the doodle branch ~L188) — add `keepsake: input.keepsake,` to each args object.

- [ ] **Step 5: Add `keepsake` to `buildZpl` args + guard the bottom band**

In `buildZpl`'s args type, add `keepsake?: boolean;`. Then in the bottom-band section, guard the drink + modifier field pushes. Replace:

```ts
  const drinkFont = drinkFontSizeFor(args.drinkName);
  const reserveRight = MANDY_LOGO_WIDTH + LOGO_MARGIN;
  const drinkWidth = innerWidth - reserveRight;
  const modWidth = innerWidth - reserveRight;
  parts.push(
    `^FO20,${BOTTOM_BAND_Y + 15}^A0N,${drinkFont},${drinkFont}^FB${drinkWidth},2,0,L,0^FD${escapeZpl(args.drinkName)}^FS`,
  );
  if (modLines.length > 0) {
    const lineCount = Math.min(modLines.length, MOD_MAX_LINES);
    parts.push(
      `^FO20,${BOTTOM_BAND_Y + 70}^A0N,32,32^FB${modWidth},${lineCount},4,L,0^FD${modField}^FS`,
    );
  }
```

with:

```ts
  // Keepsake copies print everything except the drink name + modifier
  // list — the divider and logo below stay so the band still frames.
  if (!args.keepsake) {
    const drinkFont = drinkFontSizeFor(args.drinkName);
    const reserveRight = MANDY_LOGO_WIDTH + LOGO_MARGIN;
    const drinkWidth = innerWidth - reserveRight;
    const modWidth = innerWidth - reserveRight;
    parts.push(
      `^FO20,${BOTTOM_BAND_Y + 15}^A0N,${drinkFont},${drinkFont}^FB${drinkWidth},2,0,L,0^FD${escapeZpl(args.drinkName)}^FS`,
    );
    if (modLines.length > 0) {
      const lineCount = Math.min(modLines.length, MOD_MAX_LINES);
      parts.push(
        `^FO20,${BOTTOM_BAND_Y + 70}^A0N,32,32^FB${modWidth},${lineCount},4,L,0^FD${modField}^FS`,
      );
    }
  }
```

- [ ] **Step 6: Guard the dev-preview bottom band too**

In `renderBottomBandPng`, guard the `drinkText` + `modText` SVG fragments so the preview matches the ZPL. Replace the `${drinkText}` and `${modText}` interpolations in the returned SVG with `${input.keepsake ? "" : drinkText}` and `${input.keepsake ? "" : modText}`. (The function already receives `input`; `drinkText`/`modText` may be computed above — leaving them computed but unused is fine, or wrap their computation in `if (!input.keepsake)` and default to `""`.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/lib/cup-label/render-zebra-cup.test.ts`
Expected: PASS (both new tests + all existing render tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/cup-label/render-zebra-cup.ts src/lib/cup-label/render-zebra-cup.test.ts
git commit -m "feat(cup-label): keepsake render variant omits drink + modifiers"
```

---

## Task 3: Enqueue — emit keepsake rows for customized cups

**Files:**
- Modify: `src/lib/cup-label/enqueue.ts`
- Test: `src/lib/cup-label/enqueue.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/cup-label/enqueue.test.ts`:

```ts
describe("enqueueCupLabelJobs (keepsake copies)", () => {
  const clientLineId = `VAR1::MOD_50S,MOD_PEARL`;
  const okDraw = () =>
    downloadMock.mockResolvedValue({
      data: { text: async () => JSON.stringify({ paths: [{ d: "M0,0 L1,1", stroke: "#000", width: 3 }] }) },
      error: null,
    });

  it("emits one keepsake row (copy_idx 1) per customized cup, none for fallback cups", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never, // qty 2: cup0 customized (drawn), cup1 fallback
      stickerNumber: "OL910",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
      includeKeepsakeCopies: true,
    });
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(3); // cup0 primary + cup0 keepsake + cup1 primary

    const keepsakes = rows.filter((r: { copy_idx: number }) => r.copy_idx === 1);
    expect(keepsakes).toHaveLength(1);
    expect(keepsakes[0].cup_idx).toBe(0);
    expect(keepsakes[0].doodle_source).toBe("user");
    expect(keepsakes[0].original_image_path).toBeNull();
    expect(keepsakes[0].ai_job_id).toBeNull();

    // renderCupLabel was called with keepsake:true exactly once.
    const keepsakeCalls = (renderCupLabel as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0]?.keepsake === true);
    expect(keepsakeCalls).toHaveLength(1);
  });

  it("primary rows carry copy_idx 0", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL911",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
      includeKeepsakeCopies: true,
    });
    const [rows] = upsertMock.mock.calls[0];
    const primaries = rows.filter((r: { copy_idx: number }) => r.copy_idx === 0);
    expect(primaries).toHaveLength(2);
  });

  it("no keepsakes when flag is off (regression)", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL912",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
    });
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows.every((r: { copy_idx: number }) => r.copy_idx === 0)).toBe(true);
  });

  it("no keepsakes for an all-fallback order even with flag on", async () => {
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL913",
      includeKeepsakeCopies: true,
    });
    const [rows] = upsertMock.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows.some((r: { copy_idx: number }) => r.copy_idx === 1)).toBe(false);
  });

  it("upsert onConflict includes copy_idx", async () => {
    okDraw();
    await enqueueCupLabelJobs({
      order: buildOrder() as never,
      stickerNumber: "OL914",
      doodleIds: { [`${clientLineId}:0`]: "doodle-uuid-1" },
      userId: "user-1",
      includeKeepsakeCopies: true,
    });
    expect(upsertMock.mock.calls[0][1].onConflict).toBe("square_order_id,line_id,cup_idx,copy_idx");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/cup-label/enqueue.test.ts -t keepsake`
Expected: FAIL — `includeKeepsakeCopies` unknown / rows have no `copy_idx` / onConflict lacks copy_idx.

- [ ] **Step 3: Add `includeKeepsakeCopies` to the args type**

In `src/lib/cup-label/enqueue.ts`, add to `EnqueueCupLabelArgs` (after `mode`):

```ts
  /**
   * When true, every cup the customer *actually customized* (drawn / AI /
   * photo / gallery sticker) also gets a second "keepsake" row
   * (`copy_idx = 1`) rendered with the drink name + modifiers omitted, for
   * staff to hand to the customer. Tarot/POOL fallback cups never get one.
   * Defaults to false. Only the authoritative payment-route enqueue passes
   * this — the webhook default path and the backfill never do.
   */
  includeKeepsakeCopies?: boolean;
```

- [ ] **Step 4: Add `copy_idx` to the `Row` type**

In the `Row` type, add (after `ai_job_id`):

```ts
  // 0 = the cup's own printed label; 1 = the keepsake copy the customer
  // keeps (same artwork, drink name + modifiers omitted). Discriminator
  // for the (square_order_id, line_id, cup_idx, copy_idx) unique key.
  copy_idx: number;
```

- [ ] **Step 5: Destructure the new arg + track per-cup eligibility**

In the `enqueueCupLabelJobs` destructure, add `includeKeepsakeCopies,` to the parameter list.

Inside the `for (let localIdx ...)` loop, near the other per-cup `let` declarations (alongside `let source`, `let poolKey`, etc.), add:

```ts
      // True only when this cup resolved to a *customer-chosen* source
      // (drawn / AI / photo / gallery sticker). Stays false for tarot/POOL
      // fallback, POS, and any branch that caught an error and fell back —
      // so a cup whose custom art failed to load never prints a keepsake of
      // the wrong (fallback) image.
      let keepsakeEligible = false;
```

- [ ] **Step 6: Set `keepsakeEligible = true` in the three custom-source branches**

In the `presetStickerHash` success branch, immediately after `doodleSvg = "";` (the line following `originalImagePath = ...gallery...`):

```ts
          keepsakeEligible = true;
```

In the `aiDoodleId` branch, immediately after `doodleSvg = "";` (the line following `source = "ai";`):

```ts
          keepsakeEligible = true;
```

In the `userDoodleId` branch, immediately after `userPaths = paths;`:

```ts
          keepsakeEligible = true;
```

(Do NOT set it anywhere inside `useDefaultFallback` / the POS branch / the final `else` — those are fallbacks.)

- [ ] **Step 7: Add `copy_idx: 0` to the primary row + push the keepsake row**

Change the existing `rows.push({ ... })` (the primary row) to include `copy_idx: 0,` (add it after `ai_job_id: aiJobId,`).

Then, immediately after that `rows.push({...})` and before the closing `}` of the `for (let localIdx ...)` loop, add:

```ts
      if (includeKeepsakeCopies && keepsakeEligible) {
        const { zpl: keepsakeZpl } = await renderCupLabel({
          stickerNumber,
          cupIdxOf: { idx: orderCupSeq, total: orderTotalCups },
          drinkName,
          modifiersText,
          doodleSvg,
          doodlePngBuffer,
          customerFirstName: customerFirstName ?? null,
          keepsake: true,
        });
        rows.push({
          square_order_id: orderId,
          line_id: lineId,
          cup_idx: cupIdx,
          sticker_number: stickerNumber,
          drink_name: drinkName,
          modifiers_text: modifiersText,
          doodle_source: source,
          doodle_pool_key: poolKey,
          doodle_paths: userPaths,
          raster_path: null,
          zpl_body: keepsakeZpl,
          target_printer_kind: "zd410",
          original_image_path: null,
          ai_job_id: null,
          copy_idx: 1,
        });
      }
```

- [ ] **Step 8: Update the upsert `onConflict`**

Change the upsert options string from `onConflict: "square_order_id,line_id,cup_idx"` to:

```ts
      onConflict: "square_order_id,line_id,cup_idx,copy_idx",
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cup-label/enqueue.test.ts`
Expected: PASS (all new keepsake tests + every existing enqueue test).

- [ ] **Step 10: Commit**

```bash
git add src/lib/cup-label/enqueue.ts src/lib/cup-label/enqueue.test.ts
git commit -m "feat(cup-label): enqueue keepsake copy rows for customized cups"
```

---

## Task 4: Payment body + route plumb `keepLabelCopy` → `includeKeepsakeCopies`

**Files:**
- Modify: `src/lib/cup-label/payment-request.ts`
- Test: `src/lib/cup-label/payment-request.test.ts`
- Modify: `src/app/api/payment/route.ts`
- Test: `src/app/api/payment/route.test.ts`

- [ ] **Step 1: Write the failing test for `buildPaymentRequestBody`**

Add to `src/lib/cup-label/payment-request.test.ts`:

```ts
  it("forwards keepLabelCopy into the body", () => {
    const body = buildPaymentRequestBody({
      orderId: "ORD1",
      labelSelections: {},
      keepLabelCopy: true,
    });
    expect(body.keepLabelCopy).toBe(true);
  });

  it("defaults keepLabelCopy to false when omitted", () => {
    const body = buildPaymentRequestBody({ orderId: "ORD1", labelSelections: {} });
    expect(body.keepLabelCopy).toBe(false);
  });
```

(If `payment-request.test.ts` does not exist, create it with the standard import `import { buildPaymentRequestBody } from "./payment-request";` and a `describe("buildPaymentRequestBody", () => { ... })` wrapper.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/cup-label/payment-request.test.ts -t keepLabelCopy`
Expected: FAIL — `keepLabelCopy` not on args/body.

- [ ] **Step 3: Add `keepLabelCopy` to args, body, and the builder**

In `src/lib/cup-label/payment-request.ts`:

Add to `PaymentRequestArgs`:

```ts
  /** Order-level opt-in: print a free keepsake copy of each customized cup. */
  keepLabelCopy?: boolean;
```

Add to `PaymentRequestBody`:

```ts
  keepLabelCopy: boolean;
```

In `buildPaymentRequestBody`'s returned object, add:

```ts
    keepLabelCopy: args.keepLabelCopy === true,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/cup-label/payment-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

In `src/app/api/payment/route.test.ts`, add a test asserting that when the request body has `keepLabelCopy: true` together with a customer choice, `enqueueCupLabelJobs` is invoked with `includeKeepsakeCopies: true`. Mirror the existing route-test harness (the file already mocks `enqueueCupLabelJobs` — see `route.test.ts:60`). Capture the mock's call args and assert:

```ts
    const enqueueArg = (enqueueCupLabelJobs as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(enqueueArg.includeKeepsakeCopies).toBe(true);
```

Use whatever request/order fixtures the surrounding tests use; set `keepLabelCopy: true` and a non-empty `presetStickerHashes`/`doodleIds` in the posted body so the `hasUserDoodleChoice` branch runs. If the harness runs the enqueue inside `after()`, await the same flush the existing cup-label route tests use.

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/app/api/payment/route.test.ts -t keepLabel`
Expected: FAIL — `includeKeepsakeCopies` is `undefined` on the enqueue args.

- [ ] **Step 7: Accept `keepLabelCopy` on the route body type + validator**

In `src/app/api/payment/route.ts`, add to the `PaymentBody` type (after `presetStickerHashes`):

```ts
  /** Order-level opt-in: print a free keepsake copy of each customized cup. */
  keepLabelCopy?: boolean;
```

In `isValidBody`, before `return true;`, add:

```ts
  if (b.keepLabelCopy !== undefined && typeof b.keepLabelCopy !== "boolean") return false;
```

- [ ] **Step 8: Pass `includeKeepsakeCopies` into both enqueueArgs**

In `route.ts`, both `enqueueArgs` objects (paid branch ~L246 and $0 branch ~L314) — add to each:

```ts
              includeKeepsakeCopies: body.keepLabelCopy === true,
```

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run src/app/api/payment/route.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/cup-label/payment-request.ts src/lib/cup-label/payment-request.test.ts src/app/api/payment/route.ts src/app/api/payment/route.test.ts
git commit -m "feat(cup-label): plumb keepLabelCopy from payment body to enqueue"
```

---

## Task 5: Cart store — `keepLabelCopy` state

**Files:**
- Modify: `src/store/cart.ts`
- Test: `src/store/__tests__/cart-label-selections.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/store/__tests__/cart-label-selections.test.ts`:

```ts
describe("cart keepLabelCopy", () => {
  it("defaults to false and toggles", () => {
    useCart.setState({ keepLabelCopy: false });
    useCart.getState().setKeepLabelCopy(true);
    expect(useCart.getState().keepLabelCopy).toBe(true);
  });

  it("clear() resets keepLabelCopy to false", () => {
    useCart.getState().setKeepLabelCopy(true);
    useCart.getState().clear();
    expect(useCart.getState().keepLabelCopy).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/__tests__/cart-label-selections.test.ts -t keepLabelCopy`
Expected: FAIL — `setKeepLabelCopy` is not a function.

- [ ] **Step 3: Add state, action, type, reset, and persistence**

In `src/store/cart.ts`:

Add to the `CartState` type (after `labelSelections`):

```ts
  /** Order-level opt-in: print a free keepsake copy of each customized cup. */
  keepLabelCopy: boolean;
```

Add to the actions list in `CartState` (after `clearLabel`):

```ts
  setKeepLabelCopy: (value: boolean) => void;
```

In the store initializer, add `keepLabelCopy: false,` to the initial state (next to `labelSelections: {}`).

Add the action implementation (next to `setLabel`):

```ts
      setKeepLabelCopy: (value) => set({ keepLabelCopy: value }),
```

In `clear()`, where it resets `labelSelections: {}`, also reset `keepLabelCopy: false`. (Find the `clear:` action — add `keepLabelCopy: false` to the object it sets, next to the `labelSelections: {}` / `cartSessionId` regeneration.)

In the persist `partialize` (the returned slice near `labelSelections: state.labelSelections`), add:

```ts
        keepLabelCopy: state.keepLabelCopy,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/__tests__/cart-label-selections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/cart.ts src/store/__tests__/cart-label-selections.test.ts
git commit -m "feat(cart): keepLabelCopy opt-in state"
```

---

## Task 6: Checkout UI — gated toggle + forward into payment body

**Files:**
- Modify: `src/app/checkout/page.tsx`

- [ ] **Step 1: Compute `hasAnyCustomizedCup` (mirrors server eligibility)**

Near the existing `cupLabelGate` memo (~L266) in `src/app/checkout/page.tsx`, add:

```ts
  // True iff at least one cup carries a committed customer choice — exactly
  // the union buildPaymentSelections forwards to the server (so the toggle
  // appears precisely when ≥1 cup will print a keepsake). In-flight null-id
  // selections are excluded, same as the server's fall-back-to-default.
  const hasAnyCustomizedCup = useMemo(() => {
    const { presetStickerHashes, aiDoodleIds, doodleIds } =
      buildPaymentSelections(labelSelections);
    return Boolean(presetStickerHashes || aiDoodleIds || doodleIds);
  }, [labelSelections]);
```

Add the import at the top of the file (next to the `buildPaymentRequestBody` import on L32):

```ts
import { buildPaymentSelections } from "@/lib/cup-label/build-payment-selections";
```

- [ ] **Step 2: Read the cart store flag + action**

With the other `useCart` selectors (~L117), add:

```ts
  const keepLabelCopy = useCart((s) => s.keepLabelCopy);
  const setKeepLabelCopy = useCart((s) => s.setKeepLabelCopy);
```

- [ ] **Step 3: Render the gated toggle**

In the JSX, in the cup-label / order-summary region of the checkout form (near where cup-label selections or the order summary render), add a checkbox shown only when `hasAnyCustomizedCup`:

```tsx
{hasAnyCustomizedCup && (
  <label className="mt-4 flex items-start gap-3 rounded-lg border border-[#F5E6C8] bg-white/60 p-3 text-sm cursor-pointer">
    <input
      type="checkbox"
      checked={keepLabelCopy}
      onChange={(e) => setKeepLabelCopy(e.target.checked)}
      className="mt-0.5 h-4 w-4 accent-[#C43A10]"
    />
    <span className="text-stone-700">
      🎁 Print an extra copy of my custom cup design to keep
      <span className="block text-xs text-stone-500">
        We&apos;ll print a spare label of each cup you customized — yours to keep.
      </span>
    </span>
  </label>
)}
```

(Place it inside the existing form column. Match the surrounding spacing/markup conventions of the nearby blocks.)

- [ ] **Step 4: Forward the flag into the payment body**

In the `buildPaymentRequestBody({ ... })` call (~L785), add:

```ts
            keepLabelCopy,
```

- [ ] **Step 5: Verify type-check + full unit suite**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "checkout/page|payment-request|build-payment-selections" || echo "no tsc errors in touched files"`
Expected: `no tsc errors in touched files`.

Run: `npx vitest run`
Expected: full suite green (previous baseline was 424/424; new tests add to that).

- [ ] **Step 6: Verify in the browser (cmux)**

Start the dev server (background) and open/refresh the checkout page in a cmux browser pane. With a cart that has a customized cup, confirm:
- the 🎁 toggle appears and is clickable (`cmux browser snapshot --compact` greps the copy);
- `cmux browser console list` / `errors list` show no new errors;
- with a tarot-only cart (no customization), the toggle is absent.

(Logged-in checkout state may be blocked locally — if so, mark the live walk as a /tester known-gap and rely on the unit gate test.)

- [ ] **Step 7: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "feat(checkout): keepsake cup-label opt-in toggle (gated on customized cups)"
```

---

## Task 7: Admin gallery — exclude keepsake rows (`copy_idx = 0`)

**Files (separate repo `~/Github/mandys_bubble_tea_admin`, branch off `main`):**
- Modify: `src/lib/cup-doodles.ts`
- Test: `src/lib/cup-doodles.test.ts`

- [ ] **Step 0: Pin the repo + branch**

```bash
cd ~/Github/mandys_bubble_tea_admin && git checkout main && git pull --ff-only && git checkout -b feat/cup-doodles-exclude-keepsake
```

- [ ] **Step 1: Write the failing test**

The admin gallery query must filter `copy_idx = 0` so keepsake copies (`copy_idx = 1`) never appear. Add a test to `src/lib/cup-doodles.test.ts` using a chainable Supabase mock that records the filters applied. Assert that both `getCupDoodlesPage` and `getCupDoodlesCounts` apply a `copy_idx = 0` constraint. Concretely, build a mock query object whose `.eq` pushes `[col, val]` into a captured array and whose `.or` pushes the raw string, then assert `captured` contains `["copy_idx", 0]` (for the `.eq` branches) or an `.or` string containing `copy_idx.eq.0` (for the "all" branch). Follow the existing mock style in `cup-doodles.test.ts`; if none exists, model the chainable mock on the `getSupabaseAdmin` mock used in the web repo's `enqueue.test.ts`.

Minimum assertions:

```ts
it("page query for source=draw filters copy_idx=0", async () => {
  // ...invoke getCupDoodlesPage({ page: 0, pageSize: 10, source: "draw" })
  expect(capturedEq).toContainEqual(["copy_idx", 0]);
});

it("page query for source=all ANDs copy_idx.eq.0 into the or()", async () => {
  // ...invoke getCupDoodlesPage({ page: 0, pageSize: 10, source: "all" })
  expect(capturedOr.join(" ")).toContain("copy_idx.eq.0");
});

it("counts filter copy_idx=0", async () => {
  // ...invoke getCupDoodlesCounts()
  expect(capturedEq).toContainEqual(["copy_idx", 0]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/cup-doodles.test.ts -t copy_idx`
Expected: FAIL — no `copy_idx` filter applied yet.

- [ ] **Step 3: Add `copy_idx = 0` to the specific page branches + counts base**

In `getCupDoodlesPage`, the `ai` / `upload` / `draw` / `preset` / `tarot` branches are pure `.eq`/`.is`/`.not`/`.like` chains — append `.eq("copy_idx", 0)` to each. Example for the `draw` branch:

```ts
  } else if (source === "draw") {
    query = query.eq("doodle_source", "user").eq("copy_idx", 0);
  }
```

Apply the same `.eq("copy_idx", 0)` to the `ai`, `upload`, `preset`, and `tarot` branches.

In `getCupDoodlesCounts`, add `.eq("copy_idx", 0)` to the shared `head()` builder so every count inherits it:

```ts
  const head = () =>
    sb
      .from("cup_label_jobs")
      .select("id", { count: "exact", head: true })
      .eq("copy_idx", 0);
```

- [ ] **Step 4: Rewrite the "all" branch `.or()` to AND `copy_idx = 0` (avoid the `.or()`+`.eq()` landmine)**

The `else` ("all") branch combines `.or()` with the rest; this codebase has a documented prod bug when `.or()` is combined with a sibling `.eq()` under `count=exact` + embeds. So do NOT add a sibling `.eq("copy_idx", 0)` there — instead fold `copy_idx.eq.0` into each disjunct of the `.or()` using PostgREST nested `and(...)`:

```ts
  } else {
    // "all" — keep a single .or() (no sibling .eq, which has returned empty
    // in prod under count=exact). AND copy_idx.eq.0 into each disjunct so
    // keepsake copies (copy_idx=1) are excluded.
    query = query.or(
      "and(original_image_path.not.is.null,copy_idx.eq.0),and(doodle_source.eq.user,copy_idx.eq.0)",
    );
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/cup-doodles.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep cup-doodles || echo "no tsc errors in cup-doodles"`
Expected: `no tsc errors in cup-doodles`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cup-doodles.ts src/lib/cup-doodles.test.ts
git commit -m "fix(cup-doodles): exclude keepsake copies (copy_idx=0) from gallery + counts"
```

---

## Final verification (after all tasks)

- [ ] **Web full suite green**

```bash
cd ~/Github/mandys_bubble_tea && npx vitest run
```
Expected: all tests pass (baseline 424 + new keepsake/render/enqueue/payment/cart tests).

- [ ] **Web type-check on touched files clean**

```bash
cd ~/Github/mandys_bubble_tea && npx tsc --noEmit 2>&1 | grep -E "cup-label|checkout/page|store/cart|api/payment" || echo "clean"
```
Expected: `clean` (repo has pre-existing tsc noise in leaflet/playwright/scripts — those are unrelated).

- [ ] **Admin suite green**

```bash
cd ~/Github/mandys_bubble_tea_admin && npx vitest run src/lib/cup-doodles.test.ts
```
Expected: pass.

- [ ] **Merge + push (per repo, after review)**

Web: ff-merge `feat/checkout-keepsake-cup-label` → `main`, push. Admin: ff-merge `feat/cup-doodles-exclude-keepsake` → `main`, push. (Migration was already applied to prod in Task 1.)

- [ ] **Known gaps for /tester**
  - Real-line: place an order with a customized cup + toggle on → confirm an extra drink-less label prints for that cup only; tarot-only cups print no extra.
  - Logged-in checkout toggle visibility/forwarding (local auth may block the live walk).

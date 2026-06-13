# POS In-Store Tier Discount (Gold/Diamond 5%) — Design

**Date:** 2026-06-13
**Scope:** Web repo only (setup script + webhook sync). No UI changes, no RN app changes, no Supabase migration.
**Decision locked by Stan:** Gold and Diamond both get 5% off, unified online + in-store. Diamond monthly free toppings stay online-only. Approach A: Square customer groups + catalog pricing rule, synced from the existing loyalty webhook.

## Problem

The 5% tier discount (shipped 2026-06-12, PR #24) is computed server-side in `/api/orders`, so it only applies to online orders (web + app). In-store, scanning the member QR identifies the customer for star accrual but triggers no discount. The original spec descoped POS with "Square has no per-customer always-on percentage discount" — that turned out to be wrong: Square supports **automatic discounts via customer groups** (CatalogPricingRule with `customer_group_ids_any`), which apply at POS whenever a matched customer is attached to the sale.

## Architecture

Three pieces, all in `mandys_bubble_tea` (web repo):

1. **One-time Square setup** (`scripts/setup-tier-pos-discount.mjs`) — creates 2 customer groups + the discount/product-set/pricing-rule triple. Idempotent.
2. **Runtime sync** (`src/lib/tier-group-sync.ts` + hook in `/api/webhooks/square`) — keeps group membership in line with derived tier, near-real-time on `loyalty.account.updated`.
3. **Backfill/reconcile script** (`scripts/backfill-tier-groups.mjs`) — pages through all loyalty accounts and syncs groups. Run once at rollout; rerunnable any time to heal drift.

Tier remains **derived, never stored** (`tierFor(lifetimePoints)` from `src/lib/membership-tier.ts`). Group membership is a *projection* of tier into Square — the backfill script is the authority for repairing it.

### 1. Square resources (setup script)

`scripts/setup-tier-pos-discount.mjs` (local script, untracked-style like other ops scripts is NOT acceptable here — this one is committed, since it defines prod resources):

- **Customer groups:** `Tier: Gold`, `Tier: Diamond` (names are staff-visible on the POS customer profile — doubles as tier visibility for staff).
- **Catalog objects** (one batch upsert):
  - `CatalogDiscount` — name `Member 5%`, `discount_type: FIXED_PERCENTAGE`, `percentage: "5.0"`, `modify_tax_basis: MODIFY_TAX_BASIS`.
  - `CatalogProductSet` — `all_products: true`.
  - `CatalogPricingRule` — `discount_id` → the discount, `match_products_id` → the product set, `customer_group_ids_any: [goldGroupId, diamondGroupId]`. No time window (always on).
- **Idempotency:** before creating, search groups by exact name (`customers.groups.list` + filter) and catalog objects by name (`catalog.searchObjects`). If found, reuse; never duplicate. Safe to rerun.
- **Output:** prints `SQUARE_TIER_GROUP_GOLD_ID` / `SQUARE_TIER_GROUP_DIAMOND_ID` for Vercel env + `.env.local`.
- Uses `SQUARE_ACCESS_TOKEN` + `SQUARE_ENVIRONMENT` from env, same as existing scripts.

### 2. Runtime sync (`src/lib/tier-group-sync.ts`)

Pure planning function (unit-testable, no I/O):

```ts
type TierGroupIds = { gold: string; diamond: string };
type GroupPlan = { add: string[]; remove: string[] };

// currentGroupIds: the customer's existing group IDs (only the two tier groups matter)
export function tierGroupPlan(
  lifetimePoints: number,
  currentGroupIds: string[],
  ids: TierGroupIds,
): GroupPlan;
```

Rules:
- silver → in neither group (add: [], remove: any tier group present)
- gold → in `Tier: Gold` only (remove diamond if present — only reachable via data repair, tier never demotes organically)
- diamond → in `Tier: Diamond` only (remove gold on promotion, so staff see one unambiguous label)
- Already-correct membership → empty plan (idempotent, no API calls)

Executor `syncTierGroups(customerId, lifetimePoints)`:
- Reads group env IDs; if either env var is missing, **no-op with one console.warn** (feature off until env configured — keeps deploy order flexible).
- Fetches the customer (`customers.get`) to read `group_ids`, computes the plan, then calls `customers.addGroupToCustomer` / `customers.removeGroupFromCustomer` per entry.
- All errors are caught and logged by the caller; never throws past the webhook boundary.

Webhook hook: inside the existing `loyalty.account.updated` block in `src/app/api/webhooks/square/route.ts` (next to `handleLoyaltyBalanceUpdate`), in its own try/catch so a sync failure cannot break wallet-pass updates or return 5xx. The event payload carries the loyalty account's `customer_id` and `lifetime_points`; if `lifetime_points` is absent from the payload, fetch the loyalty account before planning.

### 3. Backfill / reconcile (`scripts/backfill-tier-groups.mjs`)

- Pages `loyalty.accounts.search` (existing pagination pattern in `scripts/backfill-loyalty-safe.mjs`), computes tier per account, applies `tierGroupPlan`, executes adds/removes.
- Dry-run by default (`--apply` to execute), prints a summary table: N gold added, N diamond added, N already correct, N removed.
- Rate-limit friendly: sequential with small delay, same as existing backfill scripts.
- This script is also the repair path after admin customer merges (merged accounts change lifetime points outside the webhook's view).

## Double-discount safety

- `/api/orders` does **not** set `pricing_options.auto_apply_discounts` (verified), so the pricing rule does not touch online orders; the existing server-side `tier-discount` line remains the only online discount.
- Acceptance includes a live check: place a real online order with a gold/diamond account and confirm exactly one 5% line.
- POS reward redemptions (free drink, $0 line) get 5% of $0 — harmless.
- The 5% at POS applies per itemized product (whole sale, since the product set is all-products) and stacks with nothing else we configure.

## Rollout order

1. Merge code (webhook sync is a no-op until env vars exist).
2. Run setup script against prod Square → get group IDs.
3. Set Vercel env vars + redeploy.
4. Run backfill with `--apply`; spot-check Stan's account is in `Tier: Diamond`.
5. In-store smoke (Stan/staff): attach a diamond customer to a POS sale → 5% appears automatically.
6. Online double-discount check (step above).
7. Tell staff the SOP change: scan QR → search phone → **add customer to sale** → discount is automatic; silver members attach fine but get no discount (not in any group).

## Error handling

- Webhook sync failures: log with `[tier-group-sync]` prefix, never 5xx (matches existing handler pattern); drift heals on the next loyalty event or backfill rerun.
- Setup script: aborts on any Square error; rerunnable because all creates are find-or-create.
- Missing env vars in prod: warn-and-skip (explicitly logged so it's visible in Vercel logs).

## Testing

- **vitest** (new file `src/lib/tier-group-sync.test.ts`):
  - `tierGroupPlan` boundaries: 0/29/30/79/80 points; promotion gold→diamond removes gold; idempotent when already correct; silver cleanup.
  - `syncTierGroups`: mocked Square client — missing env no-op, plan executed, errors propagate to caller for logging.
  - Webhook route: `loyalty.account.updated` event triggers sync; sync throwing does not fail the response (mock).
- **Live (rollout):** backfill spot-check, POS smoke, online double-discount check.
- **Known gap for /tester:** real POS attach → 5% (needs the physical register; cannot be automated — flagged per /tester rules).

## Out of scope

- Diamond monthly free toppings in-store (stays online-only; revisit if Stan wants the semi-automatic comp flow).
- Any UI change (account page already says discount applies; card UI untouched).
- POS star-accrual SOP itself (already exists; only the attach-customer step is added).

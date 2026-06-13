# Apple Wallet pass — tier unification with web member card v2

**Date:** 2026-06-13
**Status:** Design — approved direction, pending spec review
**Related:** `2026-06-12-tier-card-v2-design.md` (web LoyaltyCard v2), `2026-06-12-membership-tiers-design.md`

## Goal

Make the Apple Wallet member pass visually + informationally consistent with the
web member card v2 (`src/components/account/LoyaltyCard.tsx`): tier-aware
(Silver / Gold / Diamond), dark-luxe per-tier colors, a metallic strip, and
wording aligned to the web card — **within PassKit's hard limits**.

Today the pass is a single flat brown (`#8D5524`) storeCard with no tier concept.

## Hard constraint — what PassKit can and cannot do

The web card's premium feel comes from CSS gradients, GSAP animation, gyroscope
3D, holo rotation and a metallic rim. **None of these exist in a `.pkpass`.**
A storeCard gives us only:

- **Solid** `backgroundColor` / `foregroundColor` / `labelColor` (no gradients, no animation)
- PNG images: `logo`, `icon`, and one **strip** band
- Text fields (header / secondary / auxiliary / back)

So "unify" lands on the four things that ARE achievable:

1. **Tier-aware** — the pass changes by Silver / Gold / Diamond (today it is static)
2. **Per-tier solid background** — a dark tone close to each web tier's base
3. **Metallic feel baked into the strip PNG** — the only place rich visuals can live
4. **Wording / field parity** — tier badge, "stars to a free drink", "stars to next tier"

## Tier derivation (no new storage, no new push wiring)

- Tier is derived live from Square loyalty `lifetimePoints` via the existing
  `tierFor` / `tierProgress` (`src/lib/membership-tier.ts`; Gold = 30, Diamond = 80).
  Never stored — recomputed every `buildPass`, exactly like the web card.
- `fetchCustomerPassData` already fetches the loyalty account; add
  `lifetimePoints: Number(account?.lifetimePoints ?? balance)` to `CustomerPassData`.
- **Cross-tier updates are already free.** The `loyalty.account.updated` Square
  webhook already enqueues a Wallet push (bump `updated_at` → APNs → device
  re-fetches the pass). Because tier is computed at build time, the same accrual
  event that crosses 30/80 re-renders the card into the new tier. No new code.

## Visual design

### Per-tier solid colors (PassKit `pass.json`)

Mid-tone of each web tier's base gradient, dark enough for white text, chosen to
sit flush under the strip's dark bottom edge (tune bg to the strip's bottom-edge
average so there's no visible seam):

| Tier    | backgroundColor      | foregroundColor | labelColor (tier accent) |
|---------|----------------------|-----------------|--------------------------|
| Silver  | `rgb(58,64,78)`      | white           | `rgb(205,212,224)` (#cdd4e0) |
| Gold    | `rgb(74,56,18)`      | white           | `rgb(240,212,137)` (#f0d489) |
| Diamond | `rgb(10,12,22)`      | white           | `rgb(157,184,255)` (#9db8ff) |

Tinting field labels to the tier accent (vs flat white) is the one subtle premium
cue PassKit allows. Values stay white for legibility.

### Strip (per tier) — approved prototype

`renderStrip` becomes tier-aware. Per tier, baked into the PNG:

- **Metallic diagonal gradient** taken from the web `TIER_VISUALS[*].cardStyle`
  base linear-gradient stops (silver steel / dark gold / near-black diamond)
- **Soft top sheen** (key light, top → 40%) + **bottom vignette** (depth)
- **9 cups** (existing geometry from `StarCupsRow`), filled count = current cycle
  progress; tier-tinted fill — Silver `#cdd4e0`, Gold `#f0d489`, Diamond `#9db8ff`
  (matches each tier's web `progressFill` light stop); filled vs empty stroke alpha

Restraint over decoration (per the premium-aesthetic rule): one sheen, one
vignette, tier-tinted cups — no extra glints.

### Field layout (`pass.json`, mirrors web priorities)

Web face shows: tier badge, balance/goal, progress, "X stars until a free drink",
"X stars to next tier" / diamond perk. Mapped to storeCard:

- **headerFields**: `tier` — label `TIER`, value `GOLD` (tier label), right-aligned
  → mirrors the web top-right tier badge
- **strip**: metallic + cups (above)
- **secondaryFields**:
  - `member` — label `MEMBER`, value member name (Wallet UX norm)
  - `progress` — label `STARS`, value `${currentStars}/${goal}`, right-aligned
- **auxiliaryFields**:
  - `reward` — label `NEXT REWARD`, value `reached ? "Ready to redeem!" : "${toGo} stars to go"`
  - `status` — Silver/Gold: label `NEXT TIER`, value `${starsToNext} to ${NextTier}`;
    Diamond: label `STATUS`, value `Top tier member` (static — matches web's own
    top-tier fallback string), right-aligned
- **backFields** (existing terms/store/phone/hours/website **unchanged**) plus:
  - `id` — `Member ID` → member number (moved off the face to reduce clutter)
  - `since` — `Member since` → memberSince
  - `perks` — `Diamond perks` → `5% off all orders + free toppings each month`
    (only added when tier === diamond; surfaces the benefit without a volatile count)

Progress semantics align to web: `currentStars = balance % goal`, cups =
currentStars, `toGo = goal - currentStars`. (Fixes today's odd `${balance}/9`
header when balance > 9.)

## Files

- `src/lib/wallet/constants.ts` — per-tier color tokens + strip art tokens (gradient stops, sheen, cup fill/stroke)
- `src/lib/wallet/strip.ts` — `renderStrip({ tier, stars, scale })` tier-aware
- `src/lib/wallet/customer.ts` — add `lifetimePoints` to `CustomerPassData`
- `src/lib/wallet/pass.ts` — `BuildPassInput += lifetimePoints`; derive tier; tier-aware colors, fields, strip calls
- `src/app/api/wallet/pass/route.ts` + `src/app/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts` — thread `lifetimePoints`
- **delete** `scripts/_proto-tier-strip.ts` (throwaway prototype)

## Testing

- **Unit (vitest):**
  - `tierFor` mapping → correct background/label/strip tokens per tier boundary (29/30/79/80)
  - `renderStrip` produces a valid PNG for each tier × representative star counts; rejects out-of-range stars (existing guard kept)
  - `buildPass` → `pass.json` carries correct tier label, colors, and field values for Silver / Gold / Diamond and for `reached` / not-reached states; back fields include perks only for diamond
  - `fetchCustomerPassData` maps `lifetimePoints` (and falls back to balance when missing)
- **Known-gap (manual, can't automate):**
  - Real-device render of the `.pkpass` per tier (Wallet rendering isn't scriptable)
  - Live tier-change push on a real accrual crossing 30/80

## Out of scope (YAGNI)

- No animation / holo / tilt / metallic rim (PassKit can't)
- No live "free toppings left this month" count (volatile + not push-backed)
- No full-bleed background image (storeCard doesn't support it)
- No new webhook / push wiring (existing `loyalty.account.updated` path covers it)
- Back fields otherwise unchanged

# Apple Wallet pass — tier unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Apple Wallet member pass tier-aware (Silver/Gold/Diamond) with dark-luxe per-tier colors, a metallic strip, and wording aligned to the web member card v2.

**Architecture:** Tier is derived live from Square loyalty `lifetimePoints` (Gold=30, Diamond=80) via the existing `tierFor`/`tierProgress`. Per-tier color + strip-art tokens live in `constants.ts`; `renderStrip` and `buildPass` consume them. No new storage and no new push wiring — the existing `loyalty.account.updated` webhook already re-pushes the pass, which re-renders into the new tier at build time.

**Tech Stack:** TypeScript, Next.js App Router, `passkit-generator`, `@napi-rs/canvas`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-wallet-tier-unify-design.md`

**Test runner:** `npx vitest run <file>` (single file), `npm test` (full suite). Type check: `npx tsc --noEmit`.

---

## File Structure

- `src/lib/wallet/constants.ts` — **modify**: add `MembershipTier`-keyed `TIER_PASS` map (background/foreground/label colors + strip art tokens). Single source of truth for per-tier visuals.
- `src/lib/wallet/strip.ts` — **modify**: `renderStrip` accepts `tier`; paints the per-tier metallic gradient + sheen + vignette + tier-tinted cups.
- `src/lib/wallet/customer.ts` — **modify**: add `lifetimePoints` to `CustomerPassData`.
- `src/lib/wallet/pass.ts` — **modify**: `BuildPassInput` gains `lifetimePoints`; derive tier; tier-aware colors, fields, and strip calls.
- `src/app/api/wallet/pass/route.ts` — **modify**: thread `lifetimePoints`.
- `src/app/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts` — **modify**: thread `lifetimePoints`.
- `scripts/_proto-tier-strip.ts` — **delete** (throwaway prototype).
- Tests: `strip.test.ts`, `pass.test.ts`, `customer.test.ts` — **modify** (update changed assertions + add tier cases).

---

### Task 1: Per-tier visual tokens in constants.ts

**Files:**
- Modify: `src/lib/wallet/constants.ts`
- Test: `src/lib/wallet/constants.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/wallet/constants.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TIER_PASS } from './constants'

describe('TIER_PASS', () => {
  it('defines all three tiers', () => {
    expect(Object.keys(TIER_PASS).sort()).toEqual(['diamond', 'gold', 'silver'])
  })

  it('each tier has solid rgb colors and strip art', () => {
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      const t = TIER_PASS[tier]
      expect(t.label).toMatch(/^(SILVER|GOLD|DIAMOND)$/)
      expect(t.backgroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(t.foregroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(t.labelColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(t.strip.metal.length).toBeGreaterThanOrEqual(3)
      expect(t.strip.cupFill).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/wallet/constants.test.ts`
Expected: FAIL — `TIER_PASS` is not exported.

- [ ] **Step 3: Add the tokens**

Append to `src/lib/wallet/constants.ts`:

```ts
import type { MembershipTier } from "@/lib/membership-tier"

export interface TierStripArt {
  /** Diagonal metal gradient stops: [offset 0..1, css color]. From web TIER_VISUALS base. */
  metal: [number, string][]
  /** Soft top sheen color (rgba). */
  topHighlight: string
  /** Filled-cup fill color (matches web progressFill light stop). */
  cupFill: string
  cupStrokeFilled: string
  cupStrokeEmpty: string
}

export interface TierPassVisual {
  label: "SILVER" | "GOLD" | "DIAMOND"
  backgroundColor: string
  foregroundColor: string
  labelColor: string
  strip: TierStripArt
}

// PassKit accepts only solid rgb()/#hex (no gradients). Background = mid-tone of
// each web tier's base gradient; labelColor = tier accent; strip carries the metal.
export const TIER_PASS: Record<MembershipTier, TierPassVisual> = {
  silver: {
    label: "SILVER",
    backgroundColor: "rgb(58, 64, 78)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(205, 212, 224)",
    strip: {
      metal: [[0, "#2c313d"], [0.3, "#485064"], [0.52, "#707a8c"], [0.76, "#414958"], [1, "#2d3340"]],
      topHighlight: "rgba(255,255,255,0.16)",
      cupFill: "#cdd4e0",
      cupStrokeFilled: "rgba(255,255,255,0.95)",
      cupStrokeEmpty: "rgba(255,255,255,0.45)",
    },
  },
  gold: {
    label: "GOLD",
    backgroundColor: "rgb(74, 56, 18)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(240, 212, 137)",
    strip: {
      metal: [[0, "#392a0d"], [0.3, "#654c16"], [0.52, "#c2a045"], [0.76, "#574012"], [1, "#322307"]],
      topHighlight: "rgba(255,240,200,0.18)",
      cupFill: "#f0d489",
      cupStrokeFilled: "rgba(255,248,224,0.95)",
      cupStrokeEmpty: "rgba(255,240,200,0.42)",
    },
  },
  diamond: {
    label: "DIAMOND",
    backgroundColor: "rgb(10, 12, 22)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(157, 184, 255)",
    strip: {
      metal: [[0, "#04050a"], [0.48, "#10121d"], [1, "#04050a"]],
      topHighlight: "rgba(170,200,255,0.12)",
      cupFill: "#9db8ff",
      cupStrokeFilled: "rgba(210,225,255,0.95)",
      cupStrokeEmpty: "rgba(160,185,235,0.40)",
    },
  },
}
```

> Leave the existing `PASS_BRAND`, `PASS_BG_RGB`, `STORE_INFO`, `PASS_TERMS` exports in place — `PASS_BG_RGB`/`PASS_FG_RGB`/`PASS_LABEL_RGB` will be removed in Task 4 once `pass.ts` stops importing them. `PASS_BRAND` is still referenced by the old `strip.ts` until Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/wallet/constants.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet/constants.ts src/lib/wallet/constants.test.ts
git commit -m "feat(wallet): per-tier pass color + strip-art tokens"
```

---

### Task 2: Tier-aware renderStrip

**Files:**
- Modify: `src/lib/wallet/strip.ts`
- Test: `src/lib/wallet/strip.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe('renderStrip', ...)` in `src/lib/wallet/strip.test.ts`:

```ts
  it('renders a valid PNG for every tier', async () => {
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      const buf = await renderStrip({ tier, stars: 5, scale: 1 })
      expect(buf.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(buf.length).toBeGreaterThan(1000)
    }
  })

  it('produces different PNGs per tier (metal differs)', async () => {
    const silver = await renderStrip({ tier: 'silver', stars: 5, scale: 1 })
    const gold = await renderStrip({ tier: 'gold', stars: 5, scale: 1 })
    const diamond = await renderStrip({ tier: 'diamond', stars: 5, scale: 1 })
    expect(silver.equals(gold)).toBe(false)
    expect(gold.equals(diamond)).toBe(false)
  })

  it('still rejects invalid star counts', async () => {
    await expect(renderStrip({ tier: 'silver', stars: 10, scale: 1 })).rejects.toThrow()
  })
```

Update the three EXISTING cases to pass `tier` (they currently call `renderStrip({ stars, scale })`): change each call to include `tier: 'silver'`, e.g. `renderStrip({ tier: 'silver', stars: 0, scale: 1 })`. Keep the existing size assertion (`1020x369` at @3x) — dimensions don't change.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/wallet/strip.test.ts`
Expected: FAIL — `tier` is not a valid property / type error.

- [ ] **Step 3: Rewrite strip.ts to be tier-aware**

Replace the full contents of `src/lib/wallet/strip.ts`:

```ts
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import type { MembershipTier } from '@/lib/membership-tier'
import { TIER_PASS, type TierStripArt } from './constants'

export interface StripOptions {
  tier: MembershipTier
  stars: number        // 0..9 inclusive
  scale?: 1 | 2 | 3    // 1x, 2x, 3x
}

const BASE_W = 340  // pt
const BASE_H = 123  // pt

// Cup design mirrors components/brand/StarCupsRow.tsx (viewBox 22x28).
const CUP_VB_W = 22
const CUP_VB_H = 28

function drawCup(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filled: boolean,
  art: TierStripArt,
) {
  const sx = w / CUP_VB_W
  const sy = h / CUP_VB_H
  const strokeColor = filled ? art.cupStrokeFilled : art.cupStrokeEmpty
  const strokeVb = 1.2 / Math.min(sx, sy)

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(sx, sy)

  // Straw
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(2, 5, 18, 2.6, 1)
  } else {
    ctx.rect(2, 5, 18, 2.6)
  }
  if (filled) { ctx.fillStyle = art.cupFill; ctx.fill() }
  ctx.lineWidth = strokeVb
  ctx.strokeStyle = strokeColor
  ctx.stroke()

  // Cup body — tapered trapezoid with rounded bottom corners
  ctx.beginPath()
  ctx.moveTo(3.4, 8)
  ctx.lineTo(18.6, 8)
  ctx.lineTo(17, 24)
  ctx.quadraticCurveTo(17, 26, 15, 26)
  ctx.lineTo(7, 26)
  ctx.quadraticCurveTo(5, 26, 5, 24)
  ctx.closePath()
  if (filled) { ctx.fillStyle = art.cupFill; ctx.fill() }
  ctx.lineJoin = 'round'
  ctx.lineWidth = strokeVb
  ctx.strokeStyle = strokeColor
  ctx.stroke()

  ctx.restore()
}

export async function renderStrip(opts: StripOptions): Promise<Buffer> {
  if (!Number.isInteger(opts.stars) || opts.stars < 0 || opts.stars > 9) {
    throw new Error(`renderStrip: stars must be integer in [0,9], got ${opts.stars}`)
  }
  const art = TIER_PASS[opts.tier].strip
  const scale = opts.scale ?? 3
  const w = BASE_W * scale
  const h = BASE_H * scale

  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')

  // Base metal — diagonal gradient
  const metal = ctx.createLinearGradient(0, 0, w, h)
  for (const [off, col] of art.metal) metal.addColorStop(off, col)
  ctx.fillStyle = metal
  ctx.fillRect(0, 0, w, h)

  // Soft top sheen (key light from the top)
  const sheen = ctx.createLinearGradient(0, 0, 0, h)
  sheen.addColorStop(0, art.topHighlight)
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, w, h)

  // Bottom vignette for depth (and so the solid card bg sits flush below)
  const vig = ctx.createLinearGradient(0, h * 0.5, 0, h)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  // Layout: 9 cups across, evenly distributed.
  const count = 9
  const edgePad = 14 * scale
  const totalGap = w - edgePad * 2
  const slot = totalGap / count
  const cupW = Math.min(slot - 6 * scale, (h - 24 * scale) * (CUP_VB_W / CUP_VB_H))
  const cupH = cupW * (CUP_VB_H / CUP_VB_W)
  const cyTop = (h - cupH) / 2

  for (let i = 0; i < count; i++) {
    const cxLeft = edgePad + i * slot + (slot - cupW) / 2
    drawCup(ctx, cxLeft, cyTop, cupW, cupH, i < opts.stars, art)
  }

  return Buffer.from(c.toBuffer('image/png'))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/wallet/strip.test.ts`
Expected: PASS (all original + 3 new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet/strip.ts src/lib/wallet/strip.test.ts
git commit -m "feat(wallet): tier-aware metallic strip (silver/gold/diamond)"
```

---

### Task 3: Add lifetimePoints to CustomerPassData

**Files:**
- Modify: `src/lib/wallet/customer.ts`
- Test: `src/lib/wallet/customer.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `src/lib/wallet/customer.test.ts` (reuses the mocks already at the top of the file):

```ts
describe("fetchCustomerPassData lifetimePoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCustomerGet.mockResolvedValue({
      customer: { givenName: "Stan", phoneNumber: "+61404978238", createdAt: "2026-01-01T00:00:00Z" },
    });
  });

  it("maps lifetimePoints from the loyalty account", async () => {
    mockAccountsSearch.mockResolvedValue({ loyaltyAccounts: [{ balance: 3, lifetimePoints: 71 }] });
    const data = await fetchCustomerPassData("CUST1");
    expect(data.lifetimePoints).toBe(71);
  });

  it("falls back to balance when lifetimePoints is missing", async () => {
    mockAccountsSearch.mockResolvedValue({ loyaltyAccounts: [{ balance: 5 }] });
    const data = await fetchCustomerPassData("CUST2");
    expect(data.lifetimePoints).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/wallet/customer.test.ts`
Expected: FAIL — `data.lifetimePoints` is `undefined`.

- [ ] **Step 3: Add the field**

In `src/lib/wallet/customer.ts`, add to the `CustomerPassData` interface (after `totalStars`):

```ts
  lifetimePoints: number    // cumulative earned stars — drives membership tier
```

Then in `fetchCustomerPassData`, after `const balance = Number(account?.balance ?? 0)`, add:

```ts
  const lifetimePoints = Number(account?.lifetimePoints ?? balance)
```

And add `lifetimePoints,` to the returned object (after `totalStars: balance,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/wallet/customer.test.ts`
Expected: PASS (existing phone tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet/customer.ts src/lib/wallet/customer.test.ts
git commit -m "feat(wallet): expose lifetimePoints for tier derivation"
```

---

### Task 4: Tier-aware buildPass (colors + fields + strip)

**Files:**
- Modify: `src/lib/wallet/pass.ts`
- Modify: `src/lib/wallet/constants.ts` (remove now-unused exports)
- Test: `src/lib/wallet/pass.test.ts`

- [ ] **Step 1: Update existing tests + add tier tests**

In `src/lib/wallet/pass.test.ts`:

(a) Add `lifetimePoints: 71,` to `baseInput` (after `totalStars: 71,`).

(b) REPLACE the existing `'headerFields shows total lifetime stars as "N/9"'` test with:

```ts
  it('headerFields shows the tier label', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 30 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const tierField = passJson.storeCard.headerFields.find((f: any) => f.key === 'tier')
    expect(tierField.value).toBe('GOLD')
  })
```

(c) REPLACE the existing `'secondaryFields reward says "Ready to redeem!"'` test with (reward now lives in auxiliaryFields):

```ts
  it('auxiliary reward says "Ready to redeem!" when availableRewards > 0', async () => {
    const buf = await buildPass({ ...baseInput, availableRewards: 1 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const reward = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'reward')
    expect(reward.value).toBe('Ready to redeem!')
  })

  it('auxiliary reward counts remaining stars when none ready', async () => {
    // balance 7, goal 9 -> 2 to go
    const buf = await buildPass({ ...baseInput, stars: 7, availableRewards: 0 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const reward = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'reward')
    expect(reward.value).toBe('2 stars to go')
  })
```

(d) Add per-tier color + field tests:

```ts
  it('silver tier: background + label colors + NEXT TIER countdown', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 5 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.backgroundColor).toBe('rgb(58, 64, 78)')
    expect(passJson.labelColor).toBe('rgb(205, 212, 224)')
    expect(passJson.storeCard.headerFields.find((f: any) => f.key === 'tier').value).toBe('SILVER')
    const status = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'status')
    expect(status.label).toBe('NEXT TIER')
    expect(status.value).toBe('25 to Gold') // 30 - 5
  })

  it('gold tier: 50 to Diamond', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 30 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.backgroundColor).toBe('rgb(74, 56, 18)')
    const status = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'status')
    expect(status.value).toBe('50 to Diamond') // 80 - 30
  })

  it('diamond tier: static status + perks back field', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 80 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.backgroundColor).toBe('rgb(10, 12, 22)')
    const status = passJson.storeCard.auxiliaryFields.find((f: any) => f.key === 'status')
    expect(status.label).toBe('STATUS')
    expect(status.value).toBe('Top tier member')
    const perks = passJson.storeCard.backFields.find((f: any) => f.key === 'perks')
    expect(perks.value).toBe('5% off all orders + free toppings each month')
  })

  it('non-diamond tiers have no perks back field', async () => {
    const buf = await buildPass({ ...baseInput, lifetimePoints: 5 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    expect(passJson.storeCard.backFields.find((f: any) => f.key === 'perks')).toBeUndefined()
  })

  it('progress field shows current-cycle stars as currentStars/goal', async () => {
    // stars input is already balance % goal in production; assert it renders N/9
    const buf = await buildPass({ ...baseInput, stars: 4 })
    const zip = new AdmZip(buf)
    const passJson = JSON.parse(zip.readAsText('pass.json'))
    const progress = passJson.storeCard.secondaryFields.find((f: any) => f.key === 'progress')
    expect(progress.value).toBe('4/9')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/wallet/pass.test.ts`
Expected: FAIL — `lifetimePoints` not in type / fields not present.

- [ ] **Step 3: Rewrite pass.ts**

Replace the full contents of `src/lib/wallet/pass.ts`:

```ts
import "server-only"
import fs from "node:fs/promises"
import path from "node:path"
import { PKPass } from "passkit-generator"
import { tierProgress } from "@/lib/membership-tier"
import { walletEnv } from "./env"
import { renderStrip } from "./strip"
import { TIER_PASS, PASS_TERMS, STORE_INFO } from "./constants"

export interface BuildPassInput {
  serialNumber: string
  authToken: string
  memberNumber: string
  memberName: string
  memberSince: string
  phoneE164: string      // QR payload — matches app/web so POS reads any card
  stars: number          // current cycle progress (drives strip), = balance % goal
  totalStars: number     // current loyalty balance
  lifetimePoints: number // cumulative earned — drives membership tier
  availableRewards: number
}

const ASSETS_DIR = path.join(process.cwd(), 'assets', 'wallet')
const GOAL = 9

async function readAsset(name: string): Promise<Buffer> {
  return fs.readFile(path.join(ASSETS_DIR, name))
}

/** PEM strings from env vars have literal \n — convert to real newlines */
function decodePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}

export async function buildPass(input: BuildPassInput): Promise<Buffer> {
  const env = walletEnv()
  const { tier, nextTier, starsToNext } = tierProgress(input.lifetimePoints)
  const visual = TIER_PASS[tier]

  // Fetch all buffers concurrently
  const [icon, icon2x, icon3x, logo, logo2x, logo3x, strip, strip2x, strip3x] =
    await Promise.all([
      readAsset('icon.png'),
      readAsset('icon@2x.png'),
      readAsset('icon@3x.png'),
      readAsset('logo.png'),
      readAsset('logo@2x.png'),
      readAsset('logo@3x.png'),
      renderStrip({ tier, stars: input.stars, scale: 1 }),
      renderStrip({ tier, stars: input.stars, scale: 2 }),
      renderStrip({ tier, stars: input.stars, scale: 3 }),
    ])

  const certs = {
    wwdr: decodePem(env.wwdrPem),
    signerCert: decodePem(env.certPem),
    signerKey: decodePem(env.keyPem),
    signerKeyPassphrase: env.keyPassphrase,
  }

  // Pass type must be set before pass.json is added (addBuffer triggers import).
  const pass = new PKPass({}, certs)
  pass.type = 'storeCard'

  pass.addBuffer('pass.json', Buffer.from(JSON.stringify(buildPassJson(input, env, { tier, nextTier, starsToNext, visual }))))
  pass.addBuffer('icon.png', icon)
  pass.addBuffer('icon@2x.png', icon2x)
  pass.addBuffer('icon@3x.png', icon3x)
  pass.addBuffer('logo.png', logo)
  pass.addBuffer('logo@2x.png', logo2x)
  pass.addBuffer('logo@3x.png', logo3x)
  pass.addBuffer('strip.png', strip)
  pass.addBuffer('strip@2x.png', strip2x)
  pass.addBuffer('strip@3x.png', strip3x)

  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: input.phoneE164,
    messageEncoding: 'iso-8859-1',
    altText: input.memberNumber,
  })

  return pass.getAsBuffer()
}

type TierCtx = {
  tier: ReturnType<typeof tierProgress>["tier"]
  nextTier: ReturnType<typeof tierProgress>["nextTier"]
  starsToNext: ReturnType<typeof tierProgress>["starsToNext"]
  visual: (typeof TIER_PASS)[keyof typeof TIER_PASS]
}

function titleCase(t: "gold" | "diamond"): string {
  return t === "gold" ? "Gold" : "Diamond"
}

function buildPassJson(
  i: BuildPassInput,
  env: ReturnType<typeof walletEnv>,
  ctx: TierCtx,
) {
  const currentStars = ((i.stars % GOAL) + GOAL) % GOAL
  const toGo = Math.max(0, GOAL - currentStars)
  const rewardText = i.availableRewards > 0 ? 'Ready to redeem!' : `${toGo} stars to go`

  // Status line: silver/gold count toward the next tier; diamond is static.
  const statusField =
    ctx.tier === 'diamond' || ctx.nextTier == null || ctx.starsToNext == null
      ? { key: 'status', label: 'STATUS', value: 'Top tier member', textAlignment: 'PKTextAlignmentRight' }
      : { key: 'status', label: 'NEXT TIER', value: `${ctx.starsToNext} to ${titleCase(ctx.nextTier)}`, textAlignment: 'PKTextAlignmentRight' }

  const backFields: Record<string, unknown>[] = [
    { key: 'terms', label: 'Terms', value: PASS_TERMS },
    { key: 'store', label: 'Store', value: STORE_INFO.address },
    { key: 'phone', label: 'Phone', value: STORE_INFO.phone },
    { key: 'hours', label: 'Hours', value: STORE_INFO.hours },
    { key: 'website', label: 'Website', value: STORE_INFO.website },
    { key: 'id', label: 'Member ID', value: i.memberNumber },
    { key: 'since', label: 'Member since', value: i.memberSince },
  ]
  if (ctx.tier === 'diamond') {
    backFields.push({ key: 'perks', label: 'Diamond perks', value: '5% off all orders + free toppings each month' })
  }

  return {
    formatVersion: 1,
    passTypeIdentifier: env.passTypeId,
    serialNumber: i.serialNumber,
    teamIdentifier: env.teamId,
    organizationName: "Mandy's Bubble Tea",
    description: "Mandy's Member Card",
    webServiceURL: env.webServiceUrl,
    authenticationToken: i.authToken,
    backgroundColor: ctx.visual.backgroundColor,
    foregroundColor: ctx.visual.foregroundColor,
    labelColor: ctx.visual.labelColor,
    storeCard: {
      headerFields: [
        { key: 'tier', label: 'TIER', value: ctx.visual.label, textAlignment: 'PKTextAlignmentRight' },
      ],
      primaryFields: [],
      secondaryFields: [
        { key: 'member', label: 'MEMBER', value: i.memberName },
        { key: 'progress', label: 'STARS', value: `${currentStars}/${GOAL}`, textAlignment: 'PKTextAlignmentRight' },
      ],
      auxiliaryFields: [
        { key: 'reward', label: 'NEXT REWARD', value: rewardText },
        statusField,
      ],
      backFields,
    },
  }
}
```

- [ ] **Step 2b: Remove now-unused color exports from constants.ts**

In `src/lib/wallet/constants.ts`, delete the three lines `export const PASS_BG_RGB`, `export const PASS_FG_RGB`, `export const PASS_LABEL_RGB` (and the comment above them about PassKit colors). Keep `PASS_BRAND` only if `strip.ts` no longer imports it — after Task 2 it doesn't, so `PASS_BRAND` is now unused too; remove `PASS_BRAND` and `LOYALTY_REWARD_THRESHOLD` only if `git grep` shows no other importers (run `git grep -n "PASS_BRAND\|LOYALTY_REWARD_THRESHOLD\|PASS_BG_RGB\|PASS_FG_RGB\|PASS_LABEL_RGB" src` first; delete only the ones with zero remaining references outside their own definition).

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/wallet/pass.test.ts`
Expected: PASS (all updated + new tier tests).

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors in `src/lib/wallet/*`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wallet/pass.ts src/lib/wallet/pass.test.ts src/lib/wallet/constants.ts
git commit -m "feat(wallet): tier-aware pass.json — colors, tier badge, web-aligned wording"
```

---

### Task 5: Thread lifetimePoints through the pass routes

**Files:**
- Modify: `src/app/api/wallet/pass/route.ts`
- Modify: `src/app/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts`

- [ ] **Step 1: Add lifetimePoints to both buildPass calls**

In `src/app/api/wallet/pass/route.ts`, inside the `buildPass({ ... })` call, add after `totalStars: data.totalStars,`:

```ts
    lifetimePoints: data.lifetimePoints,
```

In `src/app/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts`, inside its `buildPass({ ... })` call, add after `totalStars: data.totalStars,`:

```ts
    lifetimePoints: data.lifetimePoints,
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors (both callsites now satisfy `BuildPassInput`).

- [ ] **Step 3: Run the wallet route + lib tests**

Run: `npx vitest run src/app/api/wallet src/lib/wallet`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/wallet/pass/route.ts" "src/app/api/wallet/v1/passes/[passTypeIdentifier]/[serialNumber]/route.ts"
git commit -m "feat(wallet): thread lifetimePoints into pass build routes"
```

---

### Task 6: Cleanup + full verification

**Files:**
- Delete: `scripts/_proto-tier-strip.ts`

- [ ] **Step 1: Delete the throwaway prototype**

```bash
git rm -f --ignore-unmatch scripts/_proto-tier-strip.ts
rm -f scripts/_proto-tier-strip.ts
```

(If it was never tracked, `git rm` is a no-op; the `rm -f` removes the working-tree file.)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS — same baseline as before plus the new wallet tests. The only acceptable failures are the **pre-existing** `widget-data` date-assertion failures noted in the dev queue (confirm the count matches the clean baseline; no NEW failures).

- [ ] **Step 3: Full type check**

Run: `npx tsc --noEmit`
Expected: 0 errors in `src/`.

- [ ] **Step 4: Render a real pkpass strip sanity check (optional, local)**

If you want eyes-on confirmation the strips render, the Task-2 vitest already exercises `renderStrip` for all tiers. No extra script needed — do NOT recreate the deleted prototype.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(wallet): remove tier-strip prototype script"
```

---

## Self-Review

**Spec coverage:**
- Tier-aware (silver/gold/diamond) → Tasks 1, 2, 4 ✓
- Per-tier solid background/foreground/label → Task 1 tokens, Task 4 applies ✓
- Metallic strip baked per tier → Task 2 ✓
- Wording/field parity (tier badge, "stars to go", "X to next tier", diamond static) → Task 4 ✓
- lifetimePoints derivation, no new storage → Task 3 + Task 4 (`tierProgress`) ✓
- No new push wiring → nothing to do (existing webhook); not a task by design ✓
- Delete prototype → Task 6 ✓
- Tests (tier mapping, strip per tier, pass.json per tier, lifetimePoints map) → Tasks 1–4 ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `renderStrip({ tier, stars, scale })` consistent across Tasks 2/4. `CustomerPassData.lifetimePoints` (Task 3) → `BuildPassInput.lifetimePoints` (Task 4) → route threading (Task 5). `TIER_PASS` / `TierStripArt` / `TierPassVisual` names consistent across Tasks 1/2/4. Field keys (`tier`, `member`, `progress`, `reward`, `status`, `perks`, `id`, `since`) consistent between Task 4 implementation and its tests.

**Known gaps (manual, documented in spec):** real-device pkpass render per tier; live tier-change push on a real accrual crossing 30/80 — both un-automatable, hand off to /tester as known-gaps.

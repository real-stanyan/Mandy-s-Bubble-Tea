# Mandy's Tester P3 Web e2e + Visual + ZPL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Playwright e2e for mandybubbletea.com critical paths + visual regression for 5 routes × breakpoints × themes + ZPL render diff against goldens. After P3, the web side is fully automated.

**Architecture:** Playwright + Vercel preview deploy as target. Visual via Playwright screenshot + `odiff` lib. ZPL via Labelary HTTP → PNG → `odiff` vs `fixtures/zpl-goldens/`. Uses lib-sandbox.square-toggle for sold-out flows. seedBaseline from P1 runs before each suite.

**Tech Stack:** Playwright 1.45+, odiff-bin, Labelary HTTP, sharp

**Spec reference:** `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md`

---

## Prerequisites
- P0 + P1 + P2 done
- Web preview URL accessible from `WEB_PREVIEW_URL` env var
- staging seeded (`mandys-tester seed`)

## File Structure (P3 endstate)

```
mandys-tester/
├── suites/
│   ├── e2e-web/
│   │   ├── package.json
│   │   ├── playwright.config.ts
│   │   ├── tsconfig.json
│   │   └── tests/
│   │       ├── checkout-loyalty-stack.spec.ts
│   │       ├── checkout-welcome-stack.spec.ts
│   │       ├── checkout-ig-follow.spec.ts
│   │       ├── account-401-retry.spec.ts
│   │       ├── account-signin-pill.spec.ts
│   │       ├── account-delete-rejoin.spec.ts
│   │       ├── sold-out-detail.spec.ts
│   │       └── order-cutoff.spec.ts
│   ├── visual/
│   │   ├── package.json
│   │   ├── playwright.config.ts
│   │   └── tests/
│   │       └── web-routes.spec.ts
│   └── hardware-zpl/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── render.ts            # Labelary HTTP wrapper
│           ├── diff.ts              # odiff wrapper
│           └── render-zpl.test.ts
└── fixtures/
    ├── visual-goldens/web/          # ~120 PNG (managed via git-lfs)
    └── zpl-goldens/                 # ~30 PNG (git-lfs)
```

## Tasks

### Task 1: e2e-web Scaffolding + First Smoke

- [ ] **Step 1:** `pnpm -F @mandys-tester/suite-e2e-web add -D @playwright/test odiff-bin`
- [ ] **Step 2:** Write `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  retries: 2,
  use: {
    baseURL: process.env.WEB_PREVIEW_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
});
```

- [ ] **Step 3:** Write first smoke `tests/_smoke.spec.ts` hitting `/` and asserting 200 + brand mark present
- [ ] **Step 4:** Run `pnpm -F @mandys-tester/suite-e2e-web exec playwright test` → expect PASS

### Task 2: Checkout — Multi Loyalty Reward Stack

**Files:** `tests/checkout-loyalty-stack.spec.ts`

- [ ] **Step 1:** Use `makeCustomer({ overrides: { loyaltyStars: 18 } })` + `makeOrder` skip (manual cart through UI)
- [ ] **Step 2:** UI flow: login → add 3 cups → cart → loyalty stepper → assert max=2 → select 2 → checkout → assert order total = subtotal − 2 cheapest cup prices − card surcharge
- [ ] **Step 3:** Tag describe with `["@p1"]`
- [ ] **Step 4:** Run + commit

### Task 3-7: 5 More e2e Tests (welcome stack / IG follow / 401 retry / signin pill / sold-out detail / order cutoff)

For each:
- [ ] Write spec covering the scenario from `DEV_QUEUE-mandys.md`/`TESTER_QUEUE-mandys.md` test backlog
- [ ] Use `square-toggle.setSoldOut` for sold-out tests
- [ ] Use Supabase admin client to forcibly expire JWT for 401 retry scenario
- [ ] Commit per test

Specifically:
- **Welcome stack** (`@p1`): create customer with welcome — verify Welcome 30% Off line in Square Order
- **IG follow** (`@p1`): IG follow + welcome same cart → only welcome applies (mutually exclusive per `a3b8853`)
- **401 retry** (`@p1`): authed customer → forcibly revoke session via Supabase admin → retry web fetch → expect transparent refresh + 200
- **Signin pill** (`@p1`): authed user with no profile → /account should not show "Sign in to see your order history" pill
- **Sold-out detail** (`@p1`): toggle catalog item soldOut via `setSoldOut(itemId, true)` → /menu/[cat]/[item] should show (Sold Out) without page refresh
- **Order cutoff** (`@p2`): freeze clock to 22:14 → /checkout active; 22:15 → disabled + "Orders closed" message

### Task 8: Visual Suite — Playwright + odiff

**Files:** `suites/visual/playwright.config.ts` + `tests/web-routes.spec.ts`

- [ ] **Step 1:** Add `odiff-bin` for image diff
- [ ] **Step 2:** Write spec iterating routes × breakpoints × themes:

```ts
import { test, expect } from "@playwright/test";
import { runOdiff } from "../../hardware-zpl/src/diff.js";

const ROUTES = ["/", "/menu", "/menu/milk-tea", "/cart", "/checkout", "/account"];
const BREAKPOINTS = [{ name: "mobile", w: 375 }, { name: "tablet", w: 768 }, { name: "desktop", w: 1280 }];
const THEMES = ["light", "dark"];

for (const route of ROUTES) for (const bp of BREAKPOINTS) for (const theme of THEMES) {
  test(`[P2] visual ${route} ${bp.name} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: bp.w, height: 800 });
    await page.emulateMedia({ colorScheme: theme as any });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const screenshotPath = `fixtures/visual-goldens/web/${route.replace(/\//g, "_")}-${bp.name}-${theme}.png`;
    if (!await fileExists(screenshotPath)) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      test.skip();
    }
    const tempPath = `runs/${Date.now()}-${bp.name}-${theme}.png`;
    await page.screenshot({ path: tempPath, fullPage: true });
    const { match, diffCount } = await runOdiff(screenshotPath, tempPath);
    expect(diffCount).toBeLessThanOrEqual(0.01 * screenshotSizeFor(bp));  // 1% threshold
  });
}
```

- [ ] **Step 3:** Run once → first run captures goldens (skip), second run diffs
- [ ] **Step 4:** Commit goldens to git-lfs

### Task 9: hardware-zpl — Labelary Render + Diff

**Files:** `suites/hardware-zpl/src/{render,diff}.ts` + tests

- [ ] **Step 1:** Write `render.ts`:

```ts
export async function renderZplToPng(zpl: string, opts: { dpmm?: number; widthIn?: number; heightIn?: number } = {}): Promise<Buffer> {
  const url = `${process.env.LABELARY_API_URL}/v1/printers/${opts.dpmm ?? 8}dpmm/labels/${opts.widthIn ?? 4}x${opts.heightIn ?? 3}/0/`;
  const res = await fetch(url, { method: "POST", headers: { Accept: "image/png" }, body: zpl });
  if (!res.ok) throw new Error(`Labelary ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 2:** Write `diff.ts` wrapping `odiff-bin`:

```ts
import { execFileSync } from "node:child_process";
import odiffBin from "odiff-bin";
export async function runOdiff(a: string, b: string): Promise<{ match: boolean; diffCount: number }> {
  const result = await odiffBin.compare(a, b, "/tmp/diff.png", { failOnLayoutDiff: false });
  if (result.match) return { match: true, diffCount: 0 };
  return { match: false, diffCount: result.diffCount };
}
```

- [ ] **Step 3:** Capture 30 ZPL goldens — generate via existing `mandys_bubble_tea/printer-client/src/zpl.ts` render fns for 5 templates × 6 states each, store under `fixtures/zpl-goldens/<template>-<state>.png` via Labelary
- [ ] **Step 4:** Write `render-zpl.test.ts` iterating 30 goldens and asserting renderZplToPng() matches:

```ts
import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { renderZplToPng } from "../src/render.js";
import { runOdiff } from "../src/diff.js";

describe("[P1] zpl golden diff", () => {
  const goldenDir = "../../../fixtures/zpl-goldens";
  const list = await readdir(goldenDir);
  for (const file of list) {
    it(`golden ${file} renders within 1% diff`, async () => {
      const expected = await readFile(`${goldenDir}/${file}`);
      const zpl = await readFile(`${goldenDir}/${file.replace(".png", ".zpl")}`, "utf8");
      const rendered = await renderZplToPng(zpl);
      // write rendered to temp, diff
      // ...
    });
  }
});
```

- [ ] **Step 5:** Run, commit

### Task 10: Wire ZPL Helpers Into e2e-web cup-label Flow

**Files:** New test `tests/cup-label-flow.spec.ts`

- [ ] **Step 1:** Use UI to place order with custom cup-label (AI doodle / upload / fortune) → wait for `cup_label_jobs` row → fetch row.zpl_body → render via Labelary → odiff vs expected golden
- [ ] **Step 2:** Commit

### Task 11: git-lfs Setup

- [ ] **Step 1:** `git lfs install` + create `.gitattributes`:

```
fixtures/visual-goldens/**/*.png filter=lfs diff=lfs merge=lfs -text
fixtures/zpl-goldens/**/*.png filter=lfs diff=lfs merge=lfs -text
fixtures/audio-goldens/**/*.wav filter=lfs diff=lfs merge=lfs -text
```

- [ ] **Step 2:** Migrate existing PNGs: `git lfs migrate import --include="fixtures/visual-goldens/**,fixtures/zpl-goldens/**"`
- [ ] **Step 3:** Verify: `git lfs ls-files | wc -l` ≈ 150

### Task 12: P3 Push + Done Check

- [ ] Push
- [ ] Update TESTER leaf

## Done Checklist (P3)

- [ ] 8+ e2e-web tests covering checkout / loyalty / welcome / IG / 401 / signin / sold-out / cutoff
- [ ] Visual suite running across 6 routes × 3 breakpoints × 2 themes = 36 screens
- [ ] 30 ZPL goldens diffed
- [ ] git-lfs configured + golden refresh workflow tested

## Self-Review Notes

- Visual goldens are deeply tied to UI; refresh PRs must link to triggering prod-repo PR per spec.
- Threshold 1% chosen empirically; tune per route if flakey (`runOdiff` opts).

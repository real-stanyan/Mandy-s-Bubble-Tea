# Mandy's Tester P5 App e2e (Detox + Expo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `suites/e2e-app` driving RN/Expo app via Detox + iOS simulator; cover 4 P1 scenarios (loyalty stack / free redeem / welcome stack / 401 retry). Add 1-line `apple-pay-cents` hidden testID to prod RN code + Twilio Verify base URL injection.

**Architecture:** Detox launches Expo dev client iOS sim built from `mandys_bubble_tea_app`. Twilio Verify base URL points to local mock from P1 lib-sandbox. Apple Pay sheet amount validated via hidden testID + server-side payment payload assertion (sheet itself not introspected). Google Sign-In flow mocked via Detox mockServerHostname for OAuth redirect.

**Tech Stack:** Detox 20.x, Expo SDK 51+ dev client, iOS 18 simulator, Sandbox Apple ID, StoreKit Test, fastlane snapshot (sim boot)

**Spec reference:** `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md`

---

## Prerequisites
- P0-P4 done
- Xcode 16 installed on dev machine; Sandbox Apple ID created (Task 1)
- mandys_bubble_tea_app repo accessible; `expo prebuild` capable
- Twilio mock from P1 confirmed working

## File Structure (P5 endstate)

```
mandys-tester/
└── suites/e2e-app/
    ├── package.json
    ├── tsconfig.json
    ├── .detoxrc.js
    ├── jest.config.js
    └── tests/
        ├── login-otp.spec.ts
        ├── checkout-loyalty-stack.spec.ts
        ├── checkout-free-redeem.spec.ts
        ├── checkout-welcome-stack.spec.ts
        └── api-401-retry.spec.ts

mandys_bubble_tea_app/                     # prod repo, 2 minimal changes
├── app/checkout.tsx                       # add <View testID="apple-pay-cents">
└── lib/api.ts                             # accept TWILIO_VERIFY_BASE_URL env (or wrap)
```

## Tasks

### Task 1: Create Sandbox Apple ID (manual)

- [ ] **Step 1:** App Store Connect → Users and Access → Sandbox → Test Accounts → "+"
- [ ] **Step 2:** Email `tester+sandbox@mandybubbletea.com` (or use catch-all alias); region Australia
- [ ] **Step 3:** Save credentials to `.env.local` as `SANDBOX_APPLE_ID` + `SANDBOX_APPLE_ID_PASSWORD`
- [ ] **Step 4:** Sign into iOS sim with this Apple ID (Settings → Wallet → Add Card → use Apple's StoreKit Test test card 4111-1111-1111-1111)

### Task 2: Detox + Expo Dev Client Prep (in app prod repo via /dev coordination)

**Files:** Modify `mandys_bubble_tea_app/package.json` + `eas.json` + add `e2e/` dir

- [ ] **Step 1:** Note: changes to prod repo go through /dev (this is a coordination task). Open PR in `mandys_bubble_tea_app` adding:
  - `pnpm add -D detox @types/detox jest-circus`
  - Add `e2e/init.js`, `e2e/jest.config.js` per Detox + Expo guide (https://wix.github.io/Detox/)
- [ ] **Step 2:** EAS preview profile `eas.json` add `e2e` channel:

```json
{
  "build": {
    "e2e": {
      "extends": "preview",
      "ios": { "buildConfiguration": "Release", "simulator": true }
    }
  }
}
```

- [ ] **Step 3:** Verify locally: `cd ~/Github/mandys_bubble_tea_app && eas build --profile e2e --platform ios --local` produces a `.app` bundle in `build/`
- [ ] **Step 4:** Merge PR in app repo

### Task 3: Add `apple-pay-cents` Hidden testID + Twilio Base URL Hook

**Files:** Modify `mandys_bubble_tea_app/app/checkout.tsx` + `mandys_bubble_tea_app/lib/api.ts`

- [ ] **Step 1:** In `checkout.tsx`, before calling Apple Pay `paymentRequest.show()`, render:

```tsx
{__DEV__ || process.env.EXPO_PUBLIC_E2E_HOOKS === "1" ? (
  <View testID="apple-pay-cents" style={{ position: "absolute", opacity: 0, height: 0 }}>
    <Text>{computedAmountCents}</Text>
  </View>
) : null}
```

- [ ] **Step 2:** In `lib/twilio-verify.ts` (or wherever Twilio Verify is called), accept env-overridable base URL:

```ts
const BASE_URL = process.env.EXPO_PUBLIC_TWILIO_VERIFY_BASE_URL ?? "https://verify.twilio.com";
// ... use BASE_URL in fetch
```

- [ ] **Step 3:** Open PR via /dev with these 2 minimal hooks; merge
- [ ] **Step 4:** Build new EAS e2e binary including the hooks: `eas build --profile e2e --platform ios --local`

### Task 4: e2e-app Scaffolding

**Files:** `suites/e2e-app/{package.json,jest.config.js,.detoxrc.js,tsconfig.json}`

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "@mandys-tester/suite-e2e-app",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "detox test --configuration ios.sim.release",
    "build": "detox build --configuration ios.sim.release"
  },
  "devDependencies": {
    "detox": "^20.25.0",
    "@types/detox": "^18.1.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2:** Write `.detoxrc.js`:

```js
module.exports = {
  testRunner: { args: { config: "jest.config.js" } },
  apps: {
    "ios.release": {
      type: "ios.app",
      // Path to EAS e2e binary built in Task 3 step 4
      binaryPath: process.env.APP_E2E_BINARY ?? "../../../../mandys_bubble_tea_app/build/MandysBubbleTea.app",
    },
  },
  devices: {
    simulator: { type: "ios.simulator", device: { type: "iPhone 15", os: "iOS 18.0" } },
  },
  configurations: {
    "ios.sim.release": { device: "simulator", app: "ios.release" },
  },
};
```

- [ ] **Step 3:** Write `jest.config.js`:

```js
module.exports = {
  rootDir: "tests",
  testMatch: ["<rootDir>/**/*.spec.ts"],
  preset: "ts-jest",
  testTimeout: 180_000,
  reporters: ["default"],
  globalSetup: "detox/runners/jest/globalSetup",
  globalTeardown: "detox/runners/jest/globalTeardown",
  testEnvironment: "detox/runners/jest/testEnvironment",
};
```

- [ ] **Step 4:** Commit scaffolding

### Task 5: Twilio Mock Spin-up Helper (orchestrator-side)

**Files:** Modify `suites/e2e-app/tests/_setup.ts`

- [ ] **Step 1:** Before all tests, start Twilio mock from lib-sandbox + set `EXPO_PUBLIC_TWILIO_VERIFY_BASE_URL` in app's launchArgs:

```ts
import { startTwilioMock } from "@mandys-tester/lib-sandbox";
import { beforeAll, afterAll } from "@jest/globals";

let mock: { server: any };
beforeAll(async () => {
  mock = startTwilioMock(3399);
  await device.launchApp({
    launchArgs: { TWILIO_VERIFY_BASE_URL: "http://localhost:3399" },
  });
});
afterAll(async () => {
  mock.server.close();
});
```

- [ ] **Step 2:** Commit

### Task 6: Test — Login + OTP (sentinel code 000000)

**Files:** `tests/login-otp.spec.ts`

- [ ] **Step 1:** Write:

```ts
import { device, element, by, expect as detoxExpect } from "detox";
import { makeCustomer } from "@mandys-tester/lib-sandbox";
import { newUser } from "@mandys-tester/fixtures";

describe("[P1] login + OTP via mock", () => {
  let cleanup: () => Promise<void>;

  it("phone OTP login flow completes", async () => {
    const c = await makeCustomer({ persona: newUser });
    cleanup = c.cleanup;
    await device.reloadReactNative();
    await element(by.id("phone-input")).typeText(c.seed.phoneE164);
    await element(by.id("send-otp")).tap();
    await element(by.id("otp-input")).typeText("000000");
    await element(by.id("verify-otp")).tap();
    await detoxExpect(element(by.id("tabs"))).toBeVisible();
  });

  afterEach(async () => { await cleanup(); });
});
```

- [ ] **Step 2:** Run via `pnpm -F @mandys-tester/suite-e2e-app test --testPathPattern=login-otp`
- [ ] **Step 3:** Commit

### Task 7: Test — Multi Loyalty Reward Stack

**Files:** `tests/checkout-loyalty-stack.spec.ts`

- [ ] **Step 1:** Seed customer with `loyaltyStars=18` via factory + Square loyalty adjust
- [ ] **Step 2:** Detox flow: launch → login → menu → add 3 cups → cart → loyalty stepper → assert max=2 → tap +1 +1 → checkout button → read `apple-pay-cents` testID → assert value = subtotal − 2 cheapest cup prices − surcharge
- [ ] **Step 3:** Optionally proceed to Apple Pay sheet & abort (don't actually pay); record successful pre-sheet computation
- [ ] **Step 4:** Tag `["@p1"]` via describe
- [ ] **Step 5:** Run, commit

### Task 8: Test — Free Redeem (3 cups all redeemed)

**Files:** `tests/checkout-free-redeem.spec.ts`

- [ ] **Step 1:** Seed customer with `loyaltyStars=27` + add 3 cups
- [ ] **Step 2:** Detox flow: cart → stepper max=3 → tap +1 +1 +1 → checkout
- [ ] **Step 3:** Assert: Apple Pay sheet does NOT appear (free redeem path); place order direct → success screen
- [ ] **Step 4:** Verify in Square sandbox: order created with totalMoney = $0 or surcharge-only
- [ ] **Step 5:** Tag `["@p1"]`
- [ ] **Step 6:** Commit

### Task 9: Test — Welcome + Loyalty Cooperative

**Files:** `tests/checkout-welcome-stack.spec.ts`

- [ ] **Step 1:** Seed customer with `loyaltyStars=18` + welcome discount + 3 cups
- [ ] **Step 2:** Detox flow: cart → loyalty stepper select 2 → assert third cup has Welcome 30% off applied
- [ ] **Step 3:** Read `apple-pay-cents` testID; assert = subtotal − 2 cheapest − 30% of remaining 1 cup − surcharge
- [ ] **Step 4:** Tag `["@p1"]`
- [ ] **Step 5:** Commit

### Task 10: Test — 401 Retry With Refresh

**Files:** `tests/api-401-retry.spec.ts`

- [ ] **Step 1:** Seed customer, login, navigate to /(tabs)
- [ ] **Step 2:** Use Supabase admin client to `auth.admin.signOut(userId)` revoking session server-side
- [ ] **Step 3:** Tap "place order" (or any authed action)
- [ ] **Step 4:** Assert: no "Payment failed" alert; request transparently refreshed + success
- [ ] **Step 5:** Tag `["@p1"]`
- [ ] **Step 6:** Commit

### Task 11: Detox CI on `macos-14` (deferred to P6 but document)

**Files:** Note in `suites/e2e-app/README.md`

- [ ] **Step 1:** Write doc noting CI runner uses `macos-14` GH Actions; local run uses Stan MacBook
- [ ] **Step 2:** Document expected wall time per test (~60-90s per scenario; full suite ~10min)

### Task 12: P5 Push + Done Check

- [ ] Verify all 4 P1 scenarios + login pass
- [ ] Push
- [ ] Update TESTER leaf

## Done Checklist (P5)

- [ ] Sandbox Apple ID created + StoreKit Test ready
- [ ] App e2e binary built from EAS local with 2 prod hooks
- [ ] Detox + Twilio mock launching app correctly
- [ ] 4 P1 scenarios + login OTP test pass
- [ ] Apple Pay sheet hidden testID approach validated

## Self-Review Notes

- `apple-pay-cents` testID is **always gated** by `__DEV__` or `EXPO_PUBLIC_E2E_HOOKS=1`. Verify production build does NOT include it.
- Twilio Verify base URL env hook ALSO must be checked: prod build env should NOT have `EXPO_PUBLIC_TWILIO_VERIFY_BASE_URL` set; mock URL only set in e2e channel build.
- Google Sign-In (mocked via Detox mockServerHostname) is a separate scenario; document but defer to v2 if it bloats P5 scope.
- All 4 P1 scenarios map directly to DEV_QUEUE-mandys.md L28+L57+L58 backlog items.

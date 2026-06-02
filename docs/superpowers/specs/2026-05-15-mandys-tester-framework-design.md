# Mandy's Tester Framework — Design

**Date**: 2026-05-15
**Status**: design approved, awaiting writing-plans
**Domain**: /tester (sibling of /dev)
**Scope**: 4 git repos × 5 logical surfaces — `mandys_bubble_tea` (web + printer-client monorepo) · `mandys_bubble_tea_app` (RN) · `mandys_bubble_tea_admin` · `mandys_bubble_tea_widget`

## Goal

Build `mandys-tester`, a dedicated test automation repo that covers Mandy's 4 production repos (5 logical surfaces — printer-client is a sub-package of the web monorepo) with 6 test layers (unit / integration / e2e / contract / security / visual) plus 3 hard-automation suites (ZPL print / iOS Apple Pay / Soundbar audio). 100% automated — no manual walk steps. Sibling-coordinated with /dev via `~/system/` leaf sections.

## Non-Goals

- Modify production code (only 2 minimal test hooks: RN Apple Pay testID + Twilio Verify base URL env)
- Migrate existing unit/integration tests out of prod repos (they stay where they are)
- Cron nightly real-line prod smoke (excluded by user; trigger set is /dev session-end + /tester command + PR CI only)
- Replace Mise eval framework or any other /dev project's tests (scope limited to Mandy's)

## Hard Constraints

1. **100% automation**, including iOS Apple Pay sheet, ZD410 physical print, Soundbar audio, Square Dashboard toggles. Items that truly cannot be automated are flagged as `known-gap` with documented reason.
2. **Environment**: Square Sandbox + dedicated Supabase staging Free-tier project. No prod-mutating tests. No real Twilio (mock).
3. **Sibling protocol**: /dev session-end pushes ship entries to `TESTER_QUEUE-{project}.md` "Pending QA from /dev"; /tester writes bugs to BOTH `TESTER_QUEUE-{project}.md` "Open Bugs" AND `DEV_QUEUE-{project}.md` "Bugs from /tester".
4. **Triggers**: (a) `/tester` slash command, (b) /dev session-end (file-protocol, not hook), (c) GitHub PR via `repository_dispatch`. **No cron.**
5. **CI does not write to `~/system/`** — failures from CI surface only as PR comment + status check. Only local /tester runs invoke `bug-writer`.

## Architecture

### Repo layout

New repo: `~/Github/mandys-tester/` (pnpm workspace).

```
mandys-tester/
├── packages/
│   ├── fixtures/             # personas + factories + golden binaries + api-snapshots
│   ├── lib-sandbox/          # Square sandbox + Supabase staging + Twilio mock + Mac mini agent clients
│   ├── lib-orchestrator/     # runner / reporter / bug-writer
│   └── lib-contract-types/   # SDK shape pins (Square v44 / Supabase v2 / Resend v6 / Twilio Verify)
├── suites/
│   ├── e2e-web/              # Playwright
│   ├── e2e-app/              # Detox + Maestro fallback
│   ├── e2e-admin/            # Playwright
│   ├── contract/             # vitest + snapshot
│   ├── security/             # vitest + RLS harness
│   ├── visual/               # Playwright screenshots + odiff + Maestro recordings
│   ├── hardware-zpl/         # Labelary HTTP + golden PNG diff
│   ├── hardware-audio/       # Mac mini agent client
│   └── hardware-square-toggle/  # helpers consumed by other suites
├── apps/
│   ├── cli/                  # `mandys-tester` CLI binary
│   └── mac-mini-agent/       # daemon on Mac mini, exposes /capture HTTP via Tailscale
├── .github/workflows/
│   ├── pr-dispatch.yml       # repository_dispatch from 5 prod repos
│   ├── on-demand.yml         # workflow_dispatch
│   └── tester-self.yml       # tester repo PR
├── .testermap.yml            # path → suite mapping
├── docs/
│   ├── runbooks/             # per-suite SOP + known-gap reasons
│   └── env-setup.md
└── runs/                     # gitignored — local test artifacts (screenshots/videos/audio)
```

Production repos receive **one** 7-line workflow file (`.github/workflows/test.yml`) that emits `repository_dispatch` to `mandys-tester`. No other prod-repo changes (except 2 noted test hooks: RN `apple-pay-cents` hidden testID + Twilio Verify base URL env injection).

### Test layer mapping

| Layer | Lives | Tooling | Invocation |
|-------|-------|---------|-----------|
| unit | each prod repo | vitest (web/printer) / jest (app) / new for admin+widget | each repo's own CI (NOT mandys-tester) |
| integration | each prod repo | vitest + `SUPABASE_URL=staging` | each repo's own CI |
| e2e | mandys-tester suites/ | Playwright + Detox + Maestro + Expo dev client iOS sim | orchestrator + PR dispatch |
| contract | mandys-tester suites/ | vitest + JSON snapshot + ts-jest type assertion | orchestrator + SDK upgrade trigger |
| security | mandys-tester suites/ | vitest + Supabase admin + curl | orchestrator + PR mandatory |
| visual | mandys-tester suites/ | Playwright screenshot + odiff + Maestro recordings | orchestrator + PR mandatory |
| hardware-zpl | mandys-tester suites/ | sharp + Labelary HTTP + golden PNG | invoked by e2e-web cup-label |
| hardware-audio | mac-mini-agent + suites/ | BlackHole + Core Audio + RMS/FFT analysis | invoked by e2e-web new-order |
| hardware-square-toggle | packages/lib-sandbox/ | Square Sandbox SDK | invoked by other suites |

mandys-tester explicitly **does not run prod-repo unit/integration tests**. Each prod repo CI runs its own. mandys-tester covers everything that crosses a repo boundary or needs cross-cutting infrastructure.

### Hard-automation paths

1. **iOS Apple Pay sheet amount** — hidden RN element `<View testID="apple-pay-cents">{cents}</View>` in app prod code; Detox reads value and asserts against server payment payload. Real Apple Pay merchant flow remains a `known-gap`.
2. **RN App auth/order flow** — Detox + Expo dev client + iOS 18 sim + Sandbox Apple ID + StoreKit Test config. Twilio Verify mocked to `000000`. Google Sign-In requires Detox mockServerHostname for OAuth redirect.
3. **Square Dashboard toggles** — `lib-sandbox/square-toggle.ts` wraps Square Sandbox SDK with 5 helpers: `setSoldOut`, `deleteCustomer`, `adjustLoyaltyPoints`, `simulateCustomerDeletedWebhook`, `resetSandbox`.
4. **ZD410 print alignment** — two layers: (a) render-time ZPL → Labelary PNG → `odiff` vs `fixtures/zpl-goldens/<template>-<state>.png` threshold < 1%; (b) runtime fake-libusb captures bulk write bytes → assert ZPL envelope fields. Physical paper ratio (1.57×1.18) calibrated once and locked as `printer-client/src/ui/server.ts` constant; not regression-tested.
5. **OL Soundbar audio** — Mac mini agent on Tailscale 100.123.132.52:9001 records BlackHole loopback for 3s, returns WAV + RMS dB + peak Hz. Test asserts RMS > -30 dB + peak ∈ [200, 500 Hz] + duration ~1.5s. Physical Soundbar volume = manual calibration once, not regression-tested.

### Environment

Four clusters, ~$0/month marginal cost on v1:

- **Square Sandbox**: existing developer account, separate tokens.
- **Supabase Staging Project**: new Sydney-region Free-tier project; schema mirrors prod via `pg_dump --schema-only` snapshot in `fixtures/schema-snapshot.sql`; ongoing sync via `supabase db push` on every prod migration. Upgrade to Pro if connection cap (50) hit.
- **Mac mini Agent**: BlackHole 2ch driver + Multi-Output device (TYPE C HDMI + BlackHole). Agent installed via launchd plist, listens on Tailscale.
- **GitHub Actions CI**: `ubuntu-latest` for most suites, `macos-14` for Detox iOS, self-hosted Mac mini runner for hardware-audio only.

13 secret keys defined; managed via `.env.local` (gitignored) for local + GitHub Actions secrets for CI + per-machine `.env` for Mac mini agent. `.env.example` checked in with placeholders.

Full list:
- `SQUARE_SANDBOX_ACCESS_TOKEN`
- `SQUARE_SANDBOX_LOCATION_ID`
- `SQUARE_SANDBOX_APPLICATION_ID`
- `SUPABASE_STAGING_URL`
- `SUPABASE_STAGING_ANON_KEY`
- `SUPABASE_STAGING_SERVICE_KEY`
- `RESEND_TEST_WEBHOOK_SECRET`
- `MAC_MINI_AGENT_URL` (default `http://100.123.132.52:9001`)
- `MAC_MINI_AGENT_TOKEN`
- `SANDBOX_APPLE_ID`
- `SANDBOX_APPLE_ID_PASSWORD`
- `LABELARY_API_URL` (default `https://api.labelary.com`)
- `TWILIO_VERIFY_MOCK_URL` (orchestrator-local Express server)

### Fixture / shared lib strategy

`packages/fixtures/` holds 8 categories: factories (parameterized data builders, double-write Supabase + Square sandbox), personas (5 named templates: new-user / loyalty-mid / vip / lottery-winner / zombie / apple-pay), zpl-goldens (~30 PNG, git lfs), visual-goldens (~140 PNG, git lfs), audio-goldens (~5 WAV), api-snapshots (JSON), webhook-payloads (Square + Resend simulated bodies), schema-snapshot.sql.

`packages/lib-contract-types/` pins 4 SDK shapes. Contract suite asserts at runtime + type-level; SDK upgrade triggers mandatory contract review.

Factory composition pattern returns `{ handles, cleanup }`; test must call cleanup in `finally` block. Goldens refreshed via `mandys-tester approve-goldens` which generates new images + commits to tester repo. Golden refresh PRs MUST link to the triggering prod-repo PR in description.

Total fixture storage ~30 MB, well within GitHub LFS Free quota.

### Orchestrator + entry points

Core CLI: `mandys-tester` binary with 8 commands (`run-pending-qa`, `run-all`, `run --suite=`, `run --since=`, `approve-goldens`, `verify-schema`, `seed`, `report`).

`.testermap.yml` (in tester repo) maps prod-repo path globs to suite names. `mandys-tester run --since=<sha>` does `git diff` across affected prod repos, matches paths to suites, runs the union.

Test annotation determines bug severity:

```ts
test.describe('checkout flow', { tag: ['@p0'] }, () => { ... })
```

- `@p0` → P0 bug + session does not close + macOS notification
- `@p1` → P1 bug entry
- `@p2` / `@p3` → corresponding bug entry, no interrupt
- `@known-gap` → skipped, counted in report
- `@flaky` → still runs but does not block PR; report only
- `@quarantine` → not run

`bug-writer.ts` (only invoked locally, never CI) appends to TESTER leaf Open Bugs + DEV leaf Bugs from /tester; updates TESTER_HANDOFF.md for P0/P1. Bug-id format `bug-YYYY-MM-DD-NN`.

### Failure handling

| Failure type | Detection | Action |
|------|------|---------|
| Assertion | `expect` throw | bug-writer per `@pN` |
| Timeout | suite timeout (e2e 90s / unit 10s / hardware 30s) | retry ×2; persistent → bug + `@timeout-risk` |
| Infrastructure | sandbox / staging / agent unreachable | NOT a bug; `[P1] infra: <component> offline` to handoff; session BLOCKED |
| Flaky | retry success or 5-run history 20-80% fail rate | auto-tag `@flaky` via PR to tester repo; report-only |
| Skipped / known-gap | `.skip` or `@known-gap` | counted, no fail |

Retry: e2e / visual / hardware ×2 automatic; unit / integration / contract / security 0 retry (must be deterministic).

Bug dedup hash = `sha1(suite + test_path + error_class)[0:8]`. Existing bug with same hash → append occurrence line. New hash → new bug entry.

Bug close lifecycle: /dev appends `→ FIXED in <commit>` to DEV leaf bug line; next /tester run-pending-qa re-runs the bug's suite; PASS → move TESTER entry to Recently Closed Bugs + remove DEV leaf line; FAIL → reopen with new evidence.

Evidence paths: `runs/<run-id>/{screenshots,videos,traces,logs,audio,zpl,summary.md}` — local-gitignored; 14-day local retention; 30-day GitHub artifact retention for CI runs.

### CI integration

Each prod repo gets a 7-line `.github/workflows/test.yml` that emits `repository_dispatch` event to mandys-tester. mandys-tester `.github/workflows/pr-dispatch.yml` consumes the event, checks out tester repo + target prod repo at the dispatched sha, runs `orchestrator run --since=<sha>` across matrix:

- `ubuntu-latest`: web / admin / contract / security / visual / hardware-zpl / hardware-square-toggle
- `macos-14`: e2e-app (Detox)
- `self-hosted (mac-mini)`: hardware-audio only

Results posted back via `peter-evans/create-or-update-comment` (PR comment) + Octokit `check-runs` API (PR status check). Cross-repo write access via GitHub App `mandys-tester-bot` (preferred) or fine-grained PAT (fallback if App install permission unavailable).

## Rollout (6 phases, ~4-6 weeks)

| Phase | Week | Deliverable | Independently usable |
|-------|------|------|---------------|
| 0 Bootstrap | 0 (½ day) | repo skeleton + secrets + Supabase staging + Sandbox config + GitHub App | no (infra) |
| 1 Fixtures + Sandbox lib | 1 | fixtures + lib-sandbox + lib-contract-types + factories + seed cmd | yes |
| 2 Contract + Security | 2 | contract suite (6 contracts) + security suite + admin/widget unit baseline | yes (PR gating) |
| 3 Web e2e + Visual + ZPL | 3 | e2e-web (8 flows) + visual-web + hardware-zpl + hardware-square-toggle | yes (web fully covered) |
| 4 Admin e2e + Audio agent | 4 | e2e-admin + visual-admin + Mac mini agent + hardware-audio | yes (admin + OL audio) |
| 5 App e2e (Detox) | 5 | e2e-app + Detox + Apple Pay testID + Twilio mock | yes (app 4 P1 scenarios) |
| 6 CI lifecycle | 6 | pr-dispatch.yml matrix + bug-writer + flaky/dedup + lifecycle wiring + .testermap.yml | v1 ship |

## Risks

- **Detox Apple Pay sheet uncertainty** — Apple StoreKit may prevent inspecting the system sheet; fallback is testID pre-sheet + server-side contract.
- **Supabase staging Free-tier connection cap** — Phase 1 monitors; upgrade to Pro $25/mo if needed.
- **GitHub Actions `macos-14` minutes** — 10× Linux cost; Phase 5 budget checked; self-hosted runner on Stan MacBook as fallback.
- **Mac mini BlackHole installation** — requires sudo + reboot on-site; Phase 4 must coordinate.
- **GitHub App install permission** — falls back to PAT if `mandybubbletea` org App install unavailable.

## V2 candidates (not in v1)

- Port framework to Mise / other /dev projects (reuse lib-contract-types pattern)
- Cron nightly real-line prod smoke
- Lighthouse / Core Web Vitals (performance layer)
- Formal load testing (beyond existing sandbox stress-test branch)
- Mutation testing (Stryker)

## Open items (resolved during brainstorming)

- Workspace vs multi-repo: chose single pnpm workspace.
- bug-writer scope: local-only `~/system/` writes; CI never writes.
- Layer organization: 5 directory categories (packages / suites / apps / .github / docs).
- testermap.yml ownership: tester repo single source of truth.
- Test annotation severity: per-test, not per-suite.
- Persona file pattern: persona + factory both kept.
- Golden refresh: requires prod PR link in description.
- Schema sync: schema-snapshot.sql in tester + `supabase db push` for ongoing drift.
- GitHub App vs PAT: App preferred, PAT fallback.

## Cross-references

- `~/system/TESTER.md` — Sibling Pair section (Leaf Schema authoritative)
- `~/system/CLAUDE.md` — Domains table + Sibling Pair note
- `~/.claude/commands/tester.md` — /tester command spec
- `~/.claude/commands/dev.md` — /dev sibling block + session-end protocol
- `~/.claude/projects/-Users-stanyan/memory/feedback_tester_full_automation.md` — automation hard-rule

## Next step

Invoke `superpowers:writing-plans` to produce the implementation plan covering the 6 rollout phases.

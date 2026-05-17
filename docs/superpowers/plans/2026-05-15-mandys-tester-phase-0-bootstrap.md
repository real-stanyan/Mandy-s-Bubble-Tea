# Mandy's Tester P0 Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap `~/Github/mandys-tester/` pnpm workspace repo with skeleton dirs, secrets template, and provisioned external resources (Supabase staging, Square Sandbox, GitHub App) — ready for Phase 1 to land code.

**Architecture:** Empty pnpm workspace + 5 top-level dirs per spec (packages/ suites/ apps/ .github/ docs/) with `.gitkeep`s. External resources provisioned via Supabase Dashboard + Square Developer Dashboard + GitHub App registration. All secrets land in `.env.local` (gitignored); `.env.example` lists keys with placeholders.

**Tech Stack:** pnpm 9, Node 20 LTS, TypeScript 5, dotenv, Supabase Free tier, Square Sandbox API, GitHub Apps

**Spec reference:** `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md`

---

## Prerequisites
- GitHub account with create-repo permission on `real-stanyan` (personal) — Stan's pattern
- Existing Square Developer account with at least one Sandbox app
- Existing Supabase account
- `brew install pnpm` (target version 9.x) + Node 20 via nvm

## File Structure (P0 endstate)

```
~/Github/mandys-tester/
├── .env.example                # checked in, 13 placeholder keys
├── .env.local                  # gitignored, real values
├── .gitignore
├── README.md
├── package.json                # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .testermap.yml              # empty + schema comments
├── packages/.gitkeep
├── suites/.gitkeep
├── apps/.gitkeep
├── .github/workflows/.gitkeep
├── fixtures/.gitkeep
├── runs/.gitkeep               # also in .gitignore
└── docs/
    ├── env-setup.md
    └── runbooks/.gitkeep
```

## Tasks

### Task 1: Provision Supabase Staging Project (manual)

**Files:** none (external resource)

- [ ] **Step 1:** Open https://supabase.com/dashboard → New project → name `mandys-staging` → region `Asia Southeast (Sydney)` → plan **Free** → strong password (save to 1Password)
- [ ] **Step 2:** Wait for project ready (~2 min). Capture from Settings → API:
  - Project URL → save as `SUPABASE_STAGING_URL`
  - `anon` public key → `SUPABASE_STAGING_ANON_KEY`
  - `service_role` secret → `SUPABASE_STAGING_SERVICE_KEY`
- [ ] **Step 3:** Settings → Database → Connection string → mode `Session` → port 5432 → save as `SUPABASE_STAGING_DB_URL` (used by `pg_dump` for schema sync in P1)
- [ ] **Step 4:** Verify with curl: `curl -H "apikey: $SUPABASE_STAGING_ANON_KEY" "$SUPABASE_STAGING_URL/rest/v1/" → expect 200 OpenAPI`

### Task 2: Capture Square Sandbox Credentials (manual)

**Files:** none

- [ ] **Step 1:** Open https://developer.squareup.com/apps → choose existing `mandybubbletea` app (or create new "Mandy's Tester Sandbox" app if none)
- [ ] **Step 2:** Switch toggle top-right from `Production` to `Sandbox`
- [ ] **Step 3:** Save:
  - Application ID → `SQUARE_SANDBOX_APPLICATION_ID`
  - Access token → `SQUARE_SANDBOX_ACCESS_TOKEN`
- [ ] **Step 4:** Sandbox test accounts → use `bd3ddecb-6887-49d0-95c9-086d7d539103` (existing per DEV_QUEUE-mandys.md L57) → location ID → `SQUARE_SANDBOX_LOCATION_ID`
- [ ] **Step 5:** Verify: `curl -H "Square-Version: 2024-04-17" -H "Authorization: Bearer $SQUARE_SANDBOX_ACCESS_TOKEN" https://connect.squareupsandbox.com/v2/locations → expect 200 + locations list`

### Task 3: Register GitHub App `mandys-tester-bot` (manual)

**Files:** none

- [ ] **Step 1:** Open https://github.com/settings/apps/new
- [ ] **Step 2:** App name: `mandys-tester-bot`; Homepage: `https://github.com/real-stanyan/mandys-tester`; Webhook: **disable**
- [ ] **Step 3:** Permissions (Repository): Checks `read & write`, Pull requests `read & write`, Contents `read`, Metadata `read`
- [ ] **Step 4:** Where can this be installed: **Only on this account**
- [ ] **Step 5:** Generate private key (.pem) → save to 1Password
- [ ] **Step 6:** Note App ID → `GITHUB_APP_ID`
- [ ] **Step 7:** After create, click `Install App` → install on: `mandys_bubble_tea` / `mandys_bubble_tea_app` / `mandys_bubble_tea_admin` / `mandys_bubble_tea_widget` (4 repos) → save Installation ID → `GITHUB_APP_INSTALLATION_ID`

### Task 4: Create GitHub Repo `mandys-tester`

**Files:** none locally yet

- [ ] **Step 1:** `gh repo create real-stanyan/mandys-tester --private --description "Mandy's testing framework — sibling of /dev" --clone`
- [ ] **Step 2:** Verify: `cd ~/Github/mandys-tester && git remote -v` expect `origin git@github.com:real-stanyan/mandys-tester.git`

### Task 5: pnpm Workspace + Root package.json

**Files:**
- Create: `~/Github/mandys-tester/package.json`
- Create: `~/Github/mandys-tester/pnpm-workspace.yaml`

- [ ] **Step 1:** Write `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "suites/*"
  - "apps/*"
```

- [ ] **Step 2:** Write `package.json`:

```json
{
  "name": "mandys-tester",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.0.0",
    "dotenv": "^16.4.5",
    "tsx": "^4.19.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

- [ ] **Step 3:** Run `pnpm install` → expect creates `pnpm-lock.yaml` + `node_modules/`

### Task 6: Shared TypeScript Config

**Files:**
- Create: `~/Github/mandys-tester/tsconfig.base.json`

- [ ] **Step 1:** Write:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

### Task 7: Secret Template + .gitignore

**Files:**
- Create: `~/Github/mandys-tester/.env.example`
- Create: `~/Github/mandys-tester/.gitignore`

- [ ] **Step 1:** Write `.env.example`:

```bash
# Square Sandbox (Task 2)
SQUARE_SANDBOX_ACCESS_TOKEN=
SQUARE_SANDBOX_APPLICATION_ID=
SQUARE_SANDBOX_LOCATION_ID=

# Supabase Staging (Task 1)
SUPABASE_STAGING_URL=
SUPABASE_STAGING_ANON_KEY=
SUPABASE_STAGING_SERVICE_KEY=
SUPABASE_STAGING_DB_URL=

# Resend test (Phase 2 — used by webhook contract suite)
RESEND_TEST_WEBHOOK_SECRET=

# Mac mini agent (Phase 4)
MAC_MINI_AGENT_URL=http://100.123.132.52:9001
MAC_MINI_AGENT_TOKEN=

# Apple sandbox (Phase 5 — Detox StoreKit Test)
SANDBOX_APPLE_ID=
SANDBOX_APPLE_ID_PASSWORD=

# Labelary (Phase 3 — ZPL rendering)
LABELARY_API_URL=https://api.labelary.com

# Twilio Verify mock (Phase 5 — local-only)
TWILIO_VERIFY_MOCK_URL=http://localhost:3399

# GitHub App (Task 3)
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY_PATH=./secrets/mandys-tester-bot.private-key.pem
```

- [ ] **Step 2:** Write `.gitignore`:

```
node_modules/
dist/
.env
.env.local
.env.*.local
*.log
runs/
secrets/
.DS_Store
.turbo/
.pnpm-store/
```

- [ ] **Step 3:** Copy `cp .env.example .env.local` and **manually fill in real values** captured in Tasks 1-3 (use editor, never echo to terminal history)

### Task 8: .testermap.yml + Skeleton Dirs

**Files:**
- Create: `~/Github/mandys-tester/.testermap.yml`
- Create: 9 `.gitkeep` files in skeleton dirs

- [ ] **Step 1:** Write `.testermap.yml`:

```yaml
# .testermap.yml — path glob → suite name mapping
# Read by `mandys-tester run --since=<sha>` to select affected suites
#
# Schema:
# - pattern: <prod-repo>/path/glob/**
#   suites: [suite-name, ...]
#
# Suites filled in Phase 2-6 as suites become live.

rules: []
```

- [ ] **Step 2:** Create all skeleton dirs:

```bash
cd ~/Github/mandys-tester
mkdir -p packages suites apps .github/workflows fixtures runs docs/runbooks
touch packages/.gitkeep suites/.gitkeep apps/.gitkeep .github/workflows/.gitkeep fixtures/.gitkeep runs/.gitkeep docs/runbooks/.gitkeep
```

### Task 9: README + env-setup runbook

**Files:**
- Create: `~/Github/mandys-tester/README.md`
- Create: `~/Github/mandys-tester/docs/env-setup.md`

- [ ] **Step 1:** Write `README.md`:

```markdown
# mandys-tester

Dedicated testing framework for Mandy's Bubble Tea ecosystem. Sibling of `/dev` domain.

**Status:** Phase 0 (bootstrap). See `docs/superpowers/plans/` in `mandys_bubble_tea` repo for roadmap.

## Quick start
1. Read `docs/env-setup.md` for one-time provisioning
2. `cp .env.example .env.local` and fill in real values
3. `pnpm install`
4. Phases 1-6 land code in `packages/`, `suites/`, `apps/`

## Layout
- `packages/` — shared libs (fixtures, sandbox client, contract types, orchestrator)
- `suites/` — test suites by layer (e2e-{web,app,admin}, contract, security, visual, hardware-*)
- `apps/` — CLI binary + Mac mini agent
- `.github/workflows/` — CI dispatch from prod repos
- `.testermap.yml` — path → suite mapping
- `runs/` — gitignored test artifacts (screenshots, logs, audio)

## Coordination
This repo coordinates with prod repos via `~/system/` leaf files (`TESTER_QUEUE-mandys.md` / `DEV_QUEUE-mandys.md`) and `~/.claude/commands/{tester,dev}.md`. See `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md` in `mandys_bubble_tea` repo.
```

- [ ] **Step 2:** Write `docs/env-setup.md` covering Tasks 1-3 in checklist form (copy from this plan)

### Task 10: First Commit + Push

**Files:** all P0 artifacts

- [ ] **Step 1:** Verify `.env.local` is NOT staged: `git -C ~/Github/mandys-tester status` → expect no `.env.local` listed
- [ ] **Step 2:** Stage + commit:

```bash
cd ~/Github/mandys-tester
git add .
git status   # final inspection
git commit -m "chore(p0): bootstrap pnpm workspace + skeleton + secret template"
```

- [ ] **Step 3:** Push: `git push -u origin main`
- [ ] **Step 4:** Verify on GitHub: visit `https://github.com/real-stanyan/mandys-tester` → expect 1 commit, repo listed as Private

## Done Checklist (P0)

- [ ] Supabase staging project live + 3 keys captured
- [ ] Square Sandbox 3 keys captured + 200 response verified
- [ ] GitHub App `mandys-tester-bot` installed on 4 prod repos + IDs captured
- [ ] `mandys-tester` GitHub repo created (private) + cloned
- [ ] pnpm workspace inits + `pnpm install` succeeds
- [ ] `.env.example` has 13 keys, `.env.local` has real values, `.env.local` NOT in git
- [ ] First commit + push live on GitHub
- [ ] Ready for Phase 1 to land `packages/fixtures` + `packages/lib-sandbox`

## Self-Review Notes

- No code, no tests yet (skeleton only). TDD starts in Phase 1.
- Secrets handled via `.env.local` (gitignored) + `.env.example` (placeholders in git). GitHub App private key lives in `secrets/` (gitignored), not in env vars.
- No Mac mini work in P0 (deferred to P4).
- No prod-repo touches in P0 (deferred to P6 when CI dispatch wires up).

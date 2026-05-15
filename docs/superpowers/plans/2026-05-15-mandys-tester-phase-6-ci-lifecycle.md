# Mandy's Tester P6 CI + Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up cross-repo CI via `repository_dispatch` + bug-writer module + flaky/dedup/close lifecycle + complete `.testermap.yml`. After P6, v1 ships: /dev session-end → /tester picks up automatically; any PR on any of 4 prod repos triggers full relevant suite.

**Architecture:** GitHub App `mandys-tester-bot` (installed P0) authenticates cross-repo writes. Each prod repo gets 7-line `.github/workflows/test.yml`. mandys-tester has `pr-dispatch.yml` matrix runner. `lib-orchestrator/bug-writer` writes to `~/system/` only locally; CI surfaces failures via PR comment + status check via GH App.

**Tech Stack:** GitHub Actions, `peter-evans/repository-dispatch@v3`, `octokit`, GitHub App JWT auth (`@octokit/auth-app`), local Node fs for `~/system/` writes

**Spec reference:** `docs/superpowers/specs/2026-05-15-mandys-tester-framework-design.md`

---

## Prerequisites
- P0-P5 all done; all suites green locally
- GitHub App `mandys-tester-bot` installed on 4 prod repos

## File Structure (P6 endstate)

```
mandys-tester/
├── packages/lib-orchestrator/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── bug-writer.ts          # writes ~/system/ leaves
│       ├── flaky-detect.ts        # 5-run history + auto-tag
│       ├── dedup.ts               # sha1 hash
│       ├── runner.ts              # invokes pnpm -F <suite> test programmatically
│       ├── since.ts               # git diff → .testermap.yml lookup
│       └── reporter.ts            # GH status check + PR comment via octokit
├── apps/cli/
│   └── src/index.ts               # add run / run-pending-qa / run-since commands
├── .testermap.yml                 # filled with all 6-phase suite mappings
└── .github/workflows/
    ├── pr-dispatch.yml            # consumes repository_dispatch
    ├── on-demand.yml              # workflow_dispatch
    └── tester-self.yml            # tester repo PR CI

# In each of 4 prod repos:
.github/workflows/test.yml         # 7-line dispatcher
```

## Tasks

### Task 1: `packages/lib-orchestrator` Scaffold

**Files:** `packages/lib-orchestrator/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1:** Write `package.json`:

```json
{
  "name": "@mandys-tester/lib-orchestrator",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@octokit/auth-app": "^7.0.0",
    "@octokit/rest": "^21.0.0",
    "@mandys-tester/fixtures": "workspace:*",
    "@mandys-tester/lib-sandbox": "workspace:*",
    "yaml": "^2.5.0"
  },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.5.0" }
}
```

- [ ] **Step 2:** Commit scaffold

### Task 2: `dedup.ts` — sha1 Hash

**Files:** `src/dedup.ts` + tests

- [ ] **Step 1:** Write:

```ts
import { createHash } from "node:crypto";

export function bugHash(input: { suite: string; testPath: string; errorClass: string }): string {
  return createHash("sha1").update(`${input.suite}::${input.testPath}::${input.errorClass}`).digest("hex").slice(0, 8);
}
```

- [ ] **Step 2:** Write test asserting same inputs → same hash; different error_class → different hash
- [ ] **Step 3:** Commit

### Task 3: `bug-writer.ts` — Write to `~/system/`

**Files:** `src/bug-writer.ts` + tests

- [ ] **Step 1:** Write (test-mode supports overriding `~/system/` path via env):

```ts
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { bugHash } from "./dedup.js";

export type FailureRecord = {
  suite: string;
  testPath: string;
  testName: string;
  severity: "p0" | "p1" | "p2" | "p3";
  errorClass: string;
  errorMessage: string;
  reproSteps: string;
  evidencePaths: string[];
  project: "mandys" | "mise" | "other";  // for now hardcoded mandys
};

const SYSTEM_ROOT = process.env.MANDYS_TESTER_SYSTEM_ROOT ?? `${process.env.HOME}/system`;

export async function writeBug(record: FailureRecord): Promise<{ bugId: string; deduped: boolean }> {
  const hash = bugHash({ suite: record.suite, testPath: record.testPath, errorClass: record.errorClass });
  const testerLeaf = `${SYSTEM_ROOT}/TESTER_QUEUE-${record.project}.md`;
  const devLeaf = `${SYSTEM_ROOT}/DEV_QUEUE-${record.project}.md`;

  const existing = await readFile(testerLeaf, "utf-8");
  if (existing.includes(`dedup-hash: ${hash}`)) {
    await appendFile(testerLeaf, `\n  - occurrence at ${new Date().toISOString()}`);
    return { bugId: hash, deduped: true };
  }

  const today = new Date().toISOString().slice(0, 10);
  // Count today's NN
  const todayCount = (existing.match(new RegExp(`bug-${today}-\\d{2}`, "g")) ?? []).length + 1;
  const bugId = `bug-${today}-${String(todayCount).padStart(2, "0")}`;

  const entry = [
    ``,
    `### ${bugId}  [P${record.severity.slice(1)}] ${record.testName}`,
    `- 复现：${record.reproSteps}`,
    `- 期望：test passes`,
    `- 实际：${record.errorClass}: ${record.errorMessage}`,
    `- 发现 ${today} / 分配给 /dev`,
    `- evidence: ${record.evidencePaths.join(", ")}`,
    `- dedup-hash: ${hash}`,
    ``,
  ].join("\n");

  // Insert under "## Open Bugs" section
  const updated = existing.replace(/(## Open Bugs[^\n]*\n)/, `$1${entry}`);
  await writeFile(testerLeaf, updated);

  // Also write to DEV leaf
  const devEntry = `\n- [P${record.severity.slice(1)}] ${record.testName} — TESTER_QUEUE-${record.project}.md#${bugId} — 发现 ${today}\n`;
  const devText = await readFile(devLeaf, "utf-8");
  const devUpdated = devText.replace(/(## Bugs from \/tester[^\n]*\n)/, `$1${devEntry}`);
  await writeFile(devLeaf, devUpdated);

  // P0/P1 → also update HANDOFF
  if (record.severity === "p0" || record.severity === "p1") {
    const handoff = `${SYSTEM_ROOT}/TESTER_HANDOFF.md`;
    const txt = await readFile(handoff, "utf-8");
    const updatedHandoff = txt.replace(/(## Open P0\/P1 Bugs[^\n]*\n)/, `$1- [${record.severity.toUpperCase()}] ${record.testName} (${bugId})\n`);
    await writeFile(handoff, updatedHandoff);
  }

  return { bugId, deduped: false };
}
```

- [ ] **Step 2:** Write test using temp fixtures dir as `MANDYS_TESTER_SYSTEM_ROOT`
- [ ] **Step 3:** Commit

### Task 4: `flaky-detect.ts` — 5-Run History

**Files:** `src/flaky-detect.ts` + state file in `runs/.flaky-history.json`

- [ ] **Step 1:** Write tracker:

```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";

const STATE = `${process.cwd()}/runs/.flaky-history.json`;
type History = Record<string, ("pass" | "fail")[]>;

export async function recordRun(testKey: string, outcome: "pass" | "fail"): Promise<{ isFlaky: boolean }> {
  await mkdir(`${process.cwd()}/runs`, { recursive: true });
  let history: History = {};
  try { history = JSON.parse(await readFile(STATE, "utf-8")); } catch {}
  const arr = (history[testKey] ?? []).slice(-4);
  arr.push(outcome);
  history[testKey] = arr;
  await writeFile(STATE, JSON.stringify(history));
  if (arr.length < 5) return { isFlaky: false };
  const fails = arr.filter(x => x === "fail").length;
  return { isFlaky: fails > 0 && fails < arr.length };  // 20-80% fail rate
}
```

- [ ] **Step 2:** Test with synthetic histories
- [ ] **Step 3:** Commit

### Task 5: `since.ts` — git diff → suite Selection

**Files:** `src/since.ts` + tests

- [ ] **Step 1:** Write:

```ts
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { minimatch } from "minimatch";

export async function suitesSince(commit: string, repo: string): Promise<string[]> {
  const diff = execFileSync("git", ["-C", `${process.env.HOME}/Github/${repo}`, "diff", "--name-only", `${commit}~1`, commit]).toString().split("\n").filter(Boolean);
  const map = parse(await readFile(".testermap.yml", "utf-8")) as { rules: { pattern: string; suites: string[] }[] };
  const matched = new Set<string>();
  for (const rule of map.rules) {
    for (const file of diff) {
      if (minimatch(`${repo}/${file}`, rule.pattern)) {
        rule.suites.forEach(s => matched.add(s));
      }
    }
  }
  return [...matched];
}
```

- [ ] **Step 2:** Test with mock map and synthetic diff
- [ ] **Step 3:** Add `minimatch` + `yaml` deps to lib-orchestrator
- [ ] **Step 4:** Commit

### Task 6: `runner.ts` — Programmatic Suite Invocation

**Files:** `src/runner.ts`

- [ ] **Step 1:** Write:

```ts
import { execFileSync, spawnSync } from "node:child_process";

export type SuiteResult = {
  suite: string;
  passed: boolean;
  failures: Array<{ testName: string; testPath: string; errorClass: string; errorMessage: string }>;
  duration_ms: number;
};

export async function runSuite(suite: string): Promise<SuiteResult> {
  const start = Date.now();
  const r = spawnSync("pnpm", ["-F", `@mandys-tester/suite-${suite}`, "test", "--", "--reporter=json"], { encoding: "utf-8" });
  const duration_ms = Date.now() - start;
  if (r.status === 0) return { suite, passed: true, failures: [], duration_ms };
  // parse vitest/playwright JSON reporter
  const out = JSON.parse(r.stdout);
  const failures = parseFailures(out);
  return { suite, passed: false, failures, duration_ms };
}

function parseFailures(json: any): SuiteResult["failures"] {
  // adapt to reporter
  const list: SuiteResult["failures"] = [];
  for (const test of json.testResults ?? []) {
    if (test.status === "failed") {
      list.push({
        testName: test.name ?? test.fullName,
        testPath: test.testFilePath ?? test.path,
        errorClass: test.failureMessages?.[0]?.split(":")[0] ?? "AssertionError",
        errorMessage: test.failureMessages?.[0] ?? "",
      });
    }
  }
  return list;
}
```

- [ ] **Step 2:** Test with synthetic reporter output
- [ ] **Step 3:** Commit

### Task 7: `reporter.ts` — GH Comment + Status Check

**Files:** `src/reporter.ts`

- [ ] **Step 1:** Write:

```ts
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { readFile } from "node:fs/promises";

export async function postPrComment(args: { owner: string; repo: string; prNumber: number; body: string }): Promise<void> {
  const octokit = await ghAppOctokit();
  await octokit.issues.createComment({ owner: args.owner, repo: args.repo, issue_number: args.prNumber, body: args.body });
}

export async function postStatusCheck(args: { owner: string; repo: string; sha: string; status: "success" | "failure" | "pending"; description: string }): Promise<void> {
  const octokit = await ghAppOctokit();
  await octokit.repos.createCommitStatus({
    owner: args.owner, repo: args.repo, sha: args.sha,
    state: args.status, context: "mandys-tester",
    description: args.description.slice(0, 140),
  });
}

async function ghAppOctokit(): Promise<Octokit> {
  const privateKey = await readFile(process.env.GITHUB_APP_PRIVATE_KEY_PATH!, "utf-8");
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey,
      installationId: process.env.GITHUB_APP_INSTALLATION_ID!,
    },
  });
}
```

- [ ] **Step 2:** Test against a real test PR (create throwaway PR in a sandbox repo, verify comment + status appear)
- [ ] **Step 3:** Commit

### Task 8: CLI Wire — `run`, `run-pending-qa`, `run-since`

**Files:** Modify `apps/cli/src/index.ts`

- [ ] **Step 1:** Add commands:

```ts
import { runSuite } from "@mandys-tester/lib-orchestrator";
import { suitesSince } from "@mandys-tester/lib-orchestrator";
import { writeBug } from "@mandys-tester/lib-orchestrator";
import { recordRun } from "@mandys-tester/lib-orchestrator";

program.command("run")
  .description("Run one or more suites")
  .option("--suite <name>", "specific suite")
  .option("--since <sha>", "git diff-driven selection")
  .option("--repo <name>", "prod repo name for --since", "mandys_bubble_tea")
  .action(async opts => {
    let suites = opts.suite ? [opts.suite] : opts.since ? await suitesSince(opts.since, opts.repo) : ["all"];
    for (const suite of suites) {
      const result = await runSuite(suite);
      for (const fail of result.failures) {
        const sev = fail.testName.includes("[P0]") ? "p0" : fail.testName.includes("[P1]") ? "p1" : "p2";
        await recordRun(`${suite}:${fail.testPath}:${fail.testName}`, "fail");
        if (process.env.SKIP_BUG_WRITE !== "1") {
          await writeBug({
            suite, testPath: fail.testPath, testName: fail.testName,
            severity: sev as any, errorClass: fail.errorClass, errorMessage: fail.errorMessage,
            reproSteps: "see CI evidence", evidencePaths: [],
            project: "mandys",
          });
        }
      }
    }
  });

program.command("run-pending-qa")
  .description("Read TESTER_QUEUE-mandys.md Pending QA section, run mapped suites per entry")
  .action(async () => {
    const leafPath = `${process.env.HOME}/system/TESTER_QUEUE-mandys.md`;
    const leaf = await readFile(leafPath, "utf-8");

    // Extract entries between "## Pending QA from /dev" and the next "##"
    const section = leaf.match(/## Pending QA from \/dev\n([\s\S]*?)(?=\n## )/)?.[1] ?? "";
    const entries = section.split("\n").filter(l => l.match(/^- \d{4}-\d{2}-\d{2} — `[^`]+` .* — STATUS: pending$/));

    for (const line of entries) {
      const sha = line.match(/`([^`]+)`/)![1];
      const suites = await suitesSince(sha, "mandys_bubble_tea");
      let allPassed = true;
      let bugId: string | undefined;

      for (const suite of suites) {
        const result = await runSuite(suite);
        if (!result.passed) {
          allPassed = false;
          for (const fail of result.failures) {
            const sev = fail.testName.includes("[P0]") ? "p0" : fail.testName.includes("[P1]") ? "p1" : "p2";
            const written = await writeBug({
              suite, testPath: fail.testPath, testName: fail.testName,
              severity: sev, errorClass: fail.errorClass, errorMessage: fail.errorMessage,
              reproSteps: `triggered by Pending QA entry ${sha}`,
              evidencePaths: [],
              project: "mandys",
            });
            bugId ??= written.bugId;
          }
        }
      }

      const status = allPassed ? `tested ✓ ${new Date().toISOString().slice(0, 10)}` : `bug-${bugId}`;
      const updated = leaf.replace(line, line.replace(/STATUS: pending$/, `STATUS: ${status}`));
      await writeFile(leafPath, updated);
    }
  });
```

- [ ] **Step 2:** Test command end-to-end
- [ ] **Step 3:** Commit

### Task 9: `.testermap.yml` — Fill in All Rules

**Files:** `mandys-tester/.testermap.yml`

- [ ] **Step 1:** Write rules per spec:

```yaml
rules:
  - pattern: "mandys_bubble_tea/src/lib/loyalty/**"
    suites: [e2e-web, contract]
  - pattern: "mandys_bubble_tea/src/app/api/payment/**"
    suites: [contract, e2e-web, e2e-app, security]
  - pattern: "mandys_bubble_tea/src/app/api/orders/**"
    suites: [contract, e2e-web, security]
  - pattern: "mandys_bubble_tea/src/app/account/**"
    suites: [e2e-web]
  - pattern: "mandys_bubble_tea/printer-client/**"
    suites: [hardware-zpl, contract]
  - pattern: "mandys_bubble_tea/migrations/**"
    suites: [security]
  - pattern: "mandys_bubble_tea_app/app/**"
    suites: [e2e-app]
  - pattern: "mandys_bubble_tea_app/lib/doodle/**"
    suites: [e2e-app, hardware-zpl]
  - pattern: "mandys_bubble_tea_admin/**"
    suites: [e2e-admin, visual]
  - pattern: "mandys_bubble_tea_widget/**"
    suites: []  # widget no e2e in v1
```

- [ ] **Step 2:** Commit

### Task 10: `pr-dispatch.yml` — Tester-side CI Workflow

**Files:** `mandys-tester/.github/workflows/pr-dispatch.yml`

- [ ] **Step 1:** Write:

```yaml
name: PR Dispatch
on:
  repository_dispatch:
    types: [tester-dispatch]

jobs:
  run:
    strategy:
      fail-fast: false
      matrix:
        runner:
          - { os: ubuntu-latest, suites: "e2e-web e2e-admin contract security visual hardware-zpl" }
          - { os: macos-14, suites: "e2e-app" }
          - { os: [self-hosted, mac-mini], suites: "hardware-audio" }
    runs-on: ${{ matrix.runner.os }}
    env:
      DISPATCH_REPO: ${{ github.event.client_payload.repo }}
      DISPATCH_SHA: ${{ github.event.client_payload.sha }}
      DISPATCH_PR: ${{ github.event.client_payload.pr_number }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: real-stanyan/${{ env.DISPATCH_REPO }}
          ref: ${{ env.DISPATCH_SHA }}
          path: prod-repo
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm -F @mandys-tester/cli build
      - name: Run suites
        env:
          SKIP_BUG_WRITE: "1"
          SQUARE_SANDBOX_ACCESS_TOKEN: ${{ secrets.SQUARE_SANDBOX_ACCESS_TOKEN }}
          SUPABASE_STAGING_URL: ${{ secrets.SUPABASE_STAGING_URL }}
          SUPABASE_STAGING_SERVICE_KEY: ${{ secrets.SUPABASE_STAGING_SERVICE_KEY }}
          # ... all 13 secrets from .env.example
        run: |
          for s in ${{ matrix.runner.suites }}; do
            pnpm -F "@mandys-tester/suite-$s" test
          done
      - name: Post PR comment + status (GH App)
        if: always()
        env:
          GITHUB_APP_ID: ${{ secrets.MANDYS_TESTER_APP_ID }}
          GITHUB_APP_PRIVATE_KEY: ${{ secrets.MANDYS_TESTER_APP_PRIVATE_KEY }}
          GITHUB_APP_INSTALLATION_ID: ${{ secrets.MANDYS_TESTER_APP_INSTALLATION_ID }}
        run: |
          # invoke node script that constructs ghAppOctokit + posts to DISPATCH_REPO PR
          node scripts/post-results.mjs --status "${{ job.status }}" --pr "$DISPATCH_PR"
```

- [ ] **Step 2:** Write `scripts/post-results.mjs` calling `lib-orchestrator/reporter.ts` exports
- [ ] **Step 3:** Set GitHub Secrets in mandys-tester repo for all 13 env keys + GitHub App creds
- [ ] **Step 4:** Commit

### Task 11: Per-Prod-Repo Dispatcher Workflow

**Files:** Add `.github/workflows/test.yml` to each of 4 prod repos via /dev coordination

- [ ] **Step 1:** Write template:

```yaml
name: Tester Dispatch
on:
  pull_request:
  push: { branches: [main] }

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/repository-dispatch@v3
        with:
          token: ${{ secrets.MANDYS_TESTER_TOKEN }}  # PAT scoped to mandys-tester repo
          repository: real-stanyan/mandys-tester
          event-type: tester-dispatch
          client-payload: |
            {
              "repo": "${{ github.event.repository.name }}",
              "sha": "${{ github.sha }}",
              "pr_number": "${{ github.event.pull_request.number }}"
            }
```

- [ ] **Step 2:** Open 4 PRs (one per prod repo) via /dev — adds 1 file, no other changes
- [ ] **Step 3:** Merge after CI green
- [ ] **Step 4:** Smoke test: open a noop PR on `mandys_bubble_tea` → expect status check + comment from `mandys-tester-bot` within ~10 min

### Task 12: P6 Push + v1 Ship

- [ ] **Step 1:** Final `pnpm typecheck && pnpm test` across mandys-tester all green
- [ ] **Step 2:** Push
- [ ] **Step 3:** Tag `v1.0.0`: `git tag v1.0.0 && git push --tags`
- [ ] **Step 4:** Update `~/system/TESTER_QUEUE.md` Recently Completed: **"v1 ship"** entry
- [ ] **Step 5:** Update `~/system/CLAUDE.md`/`TESTER.md` if any conventions diverge from spec

## Done Checklist (P6)

- [ ] lib-orchestrator complete: bug-writer, flaky-detect, dedup, runner, since, reporter
- [ ] CLI extended: `run`, `run-since`, `run-pending-qa`
- [ ] `.testermap.yml` covers all 10 prod-path patterns
- [ ] `pr-dispatch.yml` matrix runs 3 runner classes
- [ ] 4 prod repos have dispatcher workflow merged
- [ ] First end-to-end smoke: noop PR triggers comment + status from tester-bot
- [ ] /tester `run-pending-qa` reads sibling-protocol section and runs mapped suites end-to-end
- [ ] v1.0.0 tagged

## Self-Review Notes

- GitHub App private key handling: keep in `secrets/` locally (gitignored), inject via GitHub Secrets in CI. Never inline in workflow yaml.
- `SKIP_BUG_WRITE=1` env keeps CI from touching `~/system/` (CI has no such filesystem). Local `mandys-tester run` writes bugs normally.
- Self-hosted Mac mini runner: register via `gh actions add-runner` from Mac mini SSH session; coordinate with Stan for sudo.
- Flaky auto-tag PR creation deferred to v2 (just report flaky in v1; manual tagging by Stan).
- Per Task 11, the prod-repo dispatcher uses a PAT, not the GH App, because outbound dispatch from prod-repo to tester-repo needs an actor token with repo:write on tester-repo. GH App is for inbound write (tester-bot → prod-repo PR). Two separate auth flows.

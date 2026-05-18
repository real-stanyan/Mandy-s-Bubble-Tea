#!/usr/bin/env tsx
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const TESTBASELINE = resolve(
  process.env.HOME ?? '',
  'Obsidian/mandys-vault/TestBaseline.md',
)
const RESULTS_FILE = resolve(process.cwd(), 'test-results-contract.json')

interface VitestTest {
  status: 'pass' | 'fail' | 'todo' | 'skip'
  name: string
  fullName: string
  failureMessages?: string[]
}

interface VitestSuite {
  name: string
  status: string
  message?: string
  assertionResults: VitestTest[]
}

interface VitestRoot {
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  testResults: VitestSuite[]
}

interface BaselineUpdate {
  id: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
  ts: string
}

function extractBaselineId(testText: string | undefined): string | undefined {
  if (!testText) return undefined
  const m = testText.match(/TestBaseline:\s*([A-K]\d+)/)
  if (m) return m[1]
  return undefined
}

function inferBaselineFromFile(file: string, _testName: string | undefined): string | undefined {
  const map: Array<[RegExp, string]> = [
    [/public\/api-get-catalog\.test/, 'K1'],
    [/public\/api-get-catalog-id/, 'K2'],
    [/public\/api-get-locations/, 'K3'],
    [/auth\/api-get-me-unauth/, 'K4'],
    [/auth\/api-get-orders-history-unauth/, 'K5'],
    [/auth\/api-get-loyalty-account-unauth/, 'K6'],
    [/auth\/api-get-loyalty-events-unauth/, 'K7'],
    [/auth\/api-get-welcome-discount-unauth/, 'K8'],
    [/auth\/api-get-ig-follow-status-unauth/, 'K9'],
    [/auth\/api-get-orders-orderid-status/, 'K10'],
    [/auth\/api-get-orders-orderid-complaint-status/, 'K11'],
  ]
  for (const [re, id] of map) {
    if (re.test(file)) return id
  }
  return undefined
}

function collectUpdates(root: VitestRoot): Map<string, BaselineUpdate> {
  const updates = new Map<string, BaselineUpdate>()
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ')

  for (const suite of root.testResults) {
    for (const t of suite.assertionResults) {
      const fromName = extractBaselineId(t.fullName) ?? extractBaselineId(t.name)
      const fromFile = fromName ?? inferBaselineFromFile(suite.name, t.fullName)
      if (!fromFile) continue
      const id = fromFile

      const existing = updates.get(id)
      const raw = t.status as string
      const status: BaselineUpdate['status'] =
        raw === 'pass' || raw === 'passed'
          ? 'pass'
          : raw === 'fail' || raw === 'failed'
            ? 'fail'
            : 'skip'

      if (existing) {
        if (existing.status === 'pass') continue
        if (status === 'pass') {
          updates.set(id, { id, status, detail: t.fullName ?? id, ts })
          continue
        }
        if (existing.status === 'skip' && status === 'fail') {
          updates.set(id, { id, status, detail: t.failureMessages?.[0]?.split('\n')[0] ?? 'fail', ts })
        }
        continue
      }
      updates.set(id, {
        id,
        status,
        detail:
          status === 'fail'
            ? t.failureMessages?.[0]?.split('\n')[0] ?? 'fail'
            : status === 'skip'
              ? 'known-gap'
              : t.fullName,
        ts,
      })
    }
  }
  return updates
}

function patchBaseline(updates: Map<string, BaselineUpdate>): { changed: number; lines: number } {
  if (!existsSync(TESTBASELINE)) {
    console.error(`TestBaseline.md not found at ${TESTBASELINE}`)
    process.exit(1)
  }
  const raw = readFileSync(TESTBASELINE, 'utf-8')
  const lines = raw.split('\n')
  let changed = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(/^(\s*-\s*)\[[ x~]\](\s+)([A-K]\d+)(\s.*)$/)
    if (!m) continue
    const [, prefix, sp, id, rest] = m
    const u = updates.get(id)
    if (!u) continue

    const cleanRest = rest.replace(/\s*\((passed|failed|known-gap)[^)]*\)\s*$/, '').replace(/\s*❌\s*$/, '')

    let newLine: string
    if (u.status === 'pass') {
      newLine = `${prefix}[x]${sp}${id}${cleanRest} (passed ${u.ts})`
    } else if (u.status === 'fail') {
      newLine = `${prefix}[ ]${sp}${id}${cleanRest} ❌ (failed: ${u.detail.slice(0, 80)})`
    } else {
      newLine = `${prefix}[~]${sp}${id}${cleanRest} (known-gap: ${u.detail.slice(0, 80)})`
    }

    if (lines[i] !== newLine) {
      lines[i] = newLine
      changed++
    }
  }

  writeFileSync(TESTBASELINE, lines.join('\n'))
  return { changed, lines: lines.length }
}

function main() {
  if (!existsSync(RESULTS_FILE)) {
    console.error(`test-results-contract.json not found. Run vitest with --reporter=json first.`)
    process.exit(1)
  }
  const root: VitestRoot = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'))
  const updates = collectUpdates(root)

  console.log('\n=== TestBaseline patch summary ===')
  console.log(
    `Total: ${root.numTotalTests} | pass: ${root.numPassedTests} | fail: ${root.numFailedTests} | skip: ${root.numPendingTests}`,
  )
  console.log(`Mapped to baseline IDs: ${updates.size}`)
  for (const u of updates.values()) {
    const icon = u.status === 'pass' ? '✅' : u.status === 'fail' ? '❌' : '⏭️ '
    console.log(`  ${icon} ${u.id} — ${u.detail.slice(0, 70)}`)
  }

  const { changed } = patchBaseline(updates)
  console.log(`\nPatched ${changed} line(s) in TestBaseline.md`)
}

main()

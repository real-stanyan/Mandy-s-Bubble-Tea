import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

// /api/cup-label/ai-submit lives on feat/cup-label-zebra-zd410 PR #9, not main.
// On main this returns 404. Even after merge, happy path needs DOUBAO_API_KEY
// in .env.local + valid 1920²+ pixel input (Doubao Seedream 4.5 floor).
describe('POST /api/cup-label/ai-submit [not-on-main yet]', () => {
  it('endpoint returns 404 until cup-label PR #9 merges to main [TestBaseline:G1]', async () => {
    const res = await apiCall('/api/cup-label/ai-submit', {
      method: 'POST',
      body: { prompt: 'test' },
    })
    expect([404, 401]).toContain(res.status)
  })

  it.skip('Doubao Seedream returns image URL [TestBaseline:G1 known-gap: needs DOUBAO_API_KEY in .env.local + 1920² pixel floor + PR #9 merged]', () => {})
  it.skip('rate-limits same user [TestBaseline:G1 known-gap]', () => {})
})

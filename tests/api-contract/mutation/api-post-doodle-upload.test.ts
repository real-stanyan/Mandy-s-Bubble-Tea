import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

// NOTE: /api/doodle/upload is not yet merged to main — exists only on
// `feat/cup-label-zebra-zd410` PR #9 (cup-label ship train). On main this
// returns 404. Keep test pointing at the eventual contract for forward
// compat — will activate when PR #9 merges.
describe('POST /api/doodle/upload [not-on-main yet]', () => {
  it('endpoint returns 404 until cup-label PR #9 merges to main [TestBaseline:G2]', async () => {
    const res = await apiCall('/api/doodle/upload', {
      method: 'POST',
      body: { image: 'data:image/png;base64,' },
    })
    // After PR #9 merge this should become 401 (auth gate) — update test then.
    expect([404, 401]).toContain(res.status)
  })

  it.skip('uploads image and returns persistent URL [TestBaseline:G2 known-gap: route on feat/cup-label-zebra-zd410 not main]', () => {})
})

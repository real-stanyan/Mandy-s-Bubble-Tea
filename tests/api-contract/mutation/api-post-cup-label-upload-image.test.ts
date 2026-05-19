import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

// /api/cup-label/upload-image lives on feat/cup-label-zebra-zd410 PR #9, not main.
describe('POST /api/cup-label/upload-image [not-on-main yet]', () => {
  it('endpoint returns 404 until cup-label PR #9 merges to main [TestBaseline:G2]', async () => {
    const res = await apiCall('/api/cup-label/upload-image', {
      method: 'POST',
      body: { image: 'data:image/png;base64,' },
    })
    expect([404, 401]).toContain(res.status)
  })

  it.skip('uploads custom image and queues print job [TestBaseline:G2, G3 known-gap: route on feat/cup-label-zebra-zd410 not main]', () => {})
})

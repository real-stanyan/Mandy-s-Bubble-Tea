import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/promotions/ig-follow/status [auth gate]', () => {
  it('returns available:false without session', async () => {
    const res = await apiCall('/api/promotions/ig-follow/status')
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; available: boolean; claimedAt: string | null }
    expect(body.ok).toBe(true)
    expect(body.available).toBe(false)
    expect(body.claimedAt).toBeNull()
  })
})

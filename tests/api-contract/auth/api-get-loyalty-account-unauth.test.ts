import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/loyalty/account [auth gate]', () => {
  it('returns null account without session', async () => {
    const res = await apiCall('/api/loyalty/account')
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; account: unknown; starsPerReward: number }
    expect(body.ok).toBe(true)
    expect(body.account).toBeNull()
    expect(body.starsPerReward).toBe(9)
  })
})

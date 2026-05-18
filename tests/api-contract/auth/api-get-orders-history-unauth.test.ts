import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/orders/history [auth gate]', () => {
  it('returns 401 without session', async () => {
    const res = await apiCall('/api/orders/history')
    expect(res.status).toBe(401)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/sign in/i)
  })
})

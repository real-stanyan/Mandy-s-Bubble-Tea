import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/orders/[orderId]/complaint-status [auth gate]', () => {
  it('returns 401 NOT_AUTHENTICATED without session', async () => {
    const res = await apiCall('/api/orders/NONEXISTENT_ID/complaint-status')
    expect(res.status).toBe(401)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('NOT_AUTHENTICATED')
  })
})

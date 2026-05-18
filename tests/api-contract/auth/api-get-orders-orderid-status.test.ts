import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/orders/[orderId]/status', () => {
  it('returns Square 404 error for non-existent order', async () => {
    const res = await apiCall('/api/orders/NONEXISTENT_ORDER_XYZ_123/status')
    expect([502, 404, 400]).toContain(res.status)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/NOT_FOUND|404/i)
  })

  it('orders/[orderId]/wait same shape', async () => {
    const res = await apiCall('/api/orders/NONEXISTENT_ORDER_XYZ_123/wait')
    expect([502, 404, 400]).toContain(res.status)
  })
})
